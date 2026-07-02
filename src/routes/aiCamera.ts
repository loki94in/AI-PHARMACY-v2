import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { aiCameraService } from '../services/aiCameraService.js';
import { productNameFilterService } from '../services/productNameFilterService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const AUDIT_QUEUE_PATH = path.resolve(__dirname, '..', '..', 'data', 'audit_queue.json');

const router = express.Router();

// Retrieve all pending audits
router.get('/audit/queue', async (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_QUEUE_PATH)) {
      return res.json([]);
    }
    const data = await fs.promises.readFile(AUDIT_QUEUE_PATH, 'utf8');
    const queue = JSON.parse(data || '[]');
    // Filter pending items
    const pending = queue.filter((item: any) => item.status === 'pending_human_review');
    res.json(pending);
  } catch (err: any) {
    console.error('Failed to read audit queue:', err);
    res.status(500).json({ error: 'Failed to read audit queue' });
  }
});

// Submit a pharmacist correction (human audit resolution)
router.post('/audit/resolve', async (req, res) => {
  const { id, name, strength, batchNumber, expiryDate, mrp, action } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Queue entry ID is required' });
  }

  try {
    // 1. Read audit queue
    if (!fs.existsSync(AUDIT_QUEUE_PATH)) {
      return res.status(404).json({ error: 'Audit queue not found' });
    }
    const data = await fs.promises.readFile(AUDIT_QUEUE_PATH, 'utf8');
    const queue = JSON.parse(data || '[]');
    const index = queue.findIndex((item: any) => item.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    if (action === 'add_to_db') {
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Medicine name is required for registration' });
      }

      // 2. Open DB and insert medicine
      const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
      const adjustedName = normalizeMedicineName(name.trim());
      const db = await dbManager.getConnection();

      // Check if medicine already exists
      let med = await db.get('SELECT id FROM medicines WHERE name = ?', [adjustedName]);
      let medicineId: number;

      if (!med) {
        const result = await db.run(
          `INSERT INTO medicines (name, mrp) VALUES (?, ?)`,
          [adjustedName, mrp || 0]
        );
        medicineId = result.lastID!;
      } else {
        medicineId = med.id;
      }

      // Insert batch/inventory if batch number provided
      if (batchNumber && batchNumber.trim() !== '') {
        await db.run(
          `INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity) VALUES (?, ?, ?, ?)`,
          [medicineId, batchNumber.trim(), expiryDate || null, 0]
        );
      }

      
      // NEW: Learn from this correction for future OCR recognition
      // We need to get the original OCR text from the audit entry to learn from it
      try {
        if (fs.existsSync(AUDIT_QUEUE_PATH)) {
          const auditData = await fs.promises.readFile(AUDIT_QUEUE_PATH, 'utf8');
          const auditQueue = JSON.parse(auditData || '[]');
          const auditEntry = auditQueue.find((item: any) => item.id === id);

          if (auditEntry && auditEntry.rawOcrText) {
            // Learn from the correction: OCR text -> correct medicine name
            productNameFilterService.learnFromCorrection(
              auditEntry.rawOcrText,
              name.trim()
            );
            console.log(`Learned from audit correction: ID ${id}`);
          }
        }
      } catch (learnError) {
        console.warn('Failed to learn from audit correction:', learnError);
        // Don't fail the whole operation if learning fails
      }
    }

    // 3. Mark queue entry as resolved/dismissed
    queue[index].status = action === 'dismiss' ? 'dismissed' : 'resolved';
    queue[index].resolvedAt = new Date().toISOString();
    queue[index].resolvedWith = name || '';

    await fs.promises.writeFile(AUDIT_QUEUE_PATH, JSON.stringify(queue, null, 2));

    res.json({
      success: true,
      message: `Queue entry ${id} successfully ${queue[index].status}`
    });
  } catch (err: any) {
    console.error('Failed to resolve audit item:', err);
    res.status(500).json({ error: `Failed to resolve audit item: ${err.message}` });
  }
});

// Delete a queue entry completely
router.delete('/audit/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (!fs.existsSync(AUDIT_QUEUE_PATH)) {
      return res.status(404).json({ error: 'Audit queue not found' });
    }
    const data = await fs.promises.readFile(AUDIT_QUEUE_PATH, 'utf8');
    let queue = JSON.parse(data || '[]');
    
    const initialLen = queue.length;
    queue = queue.filter((item: any) => item.id !== id);

    if (queue.length === initialLen) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }

    await fs.promises.writeFile(AUDIT_QUEUE_PATH, JSON.stringify(queue, null, 2));
    res.json({ success: true, message: `Queue entry ${id} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// Analyze base64 image from camera stream
router.post('/analyze', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Image data (base64 string) is required' });
  }
  try {
    const result = await aiCameraService.processImage(image);
    res.json(result);
  } catch (error: any) {
    console.error('OCR Camera scan processing failed:', error);
    res.status(500).json({ error: `OCR Camera scan processing failed: ${error.message}` });
  }
});

// Submit a pharmacist correction dynamically
router.post('/learn', async (req, res) => {
  const { ocrText, correctName } = req.body;
  if (!ocrText || !correctName) {
    return res.status(400).json({ error: 'ocrText and correctName are required' });
  }
  try {
    productNameFilterService.learnFromCorrection(ocrText.trim(), correctName.trim());
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to register scan correction:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
