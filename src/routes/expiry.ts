import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Get items nearing expiry / already expired
router.get('/', async (req, res) => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT im.id, m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.mrp, im.rack_location
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE date(im.expiry_date) <= date('now', '+' || ? || ' days')
      AND im.quantity > 0
      ORDER BY im.expiry_date ASC
    `, [days]);
        res.json(rows);
  } catch (err) {
    console.error('Expiry fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger daily summary WhatsApp notification
router.post('/send-alerts', async (req, res) => {
  const { phone, days } = req.body;
  const targetDays = days ? parseInt(days, 10) : 90;

  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE date(im.expiry_date) <= date('now', '+' || ? || ' days')
      AND im.quantity > 0
      ORDER BY im.expiry_date ASC
      LIMIT 10
    `, [targetDays]);

    let medicalName = 'AI Pharmacy';
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    let targetPhone = phone;
    if (!targetPhone) {
      const phoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_phone'");
      if (phoneRow && phoneRow.value) targetPhone = phoneRow.value;
    }
    
    if (nameRow && nameRow.value) {
      medicalName = nameRow.value;
    }
    
    if (!targetPhone) {
            return res.status(400).json({ error: 'Recipient phone number is required (configure owner_phone in settings or pass phone in body).' });
    }

    if (rows.length === 0) {
            return res.json({ success: true, message: 'No expiring items found to report.' });
    }

    const { sendMessage } = await import('../whatsappClient.js');
    const cleanPhone = targetPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    // Construct nice list message
    let msg = `📋 *${medicalName} - Expiry Alert Report*\n`;
    msg += `Nearing expiry (within ${targetDays} days):\n\n`;
    
    rows.forEach((r, index) => {
      const expDate = new Date(r.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' });
      msg += `${index + 1}. *${r.medicine_name}* (Batch: ${r.batch_no}) | Exp: ${expDate} | Qty: ${r.quantity}\n`;
    });
    
    if (rows.length >= 10) {
      msg += `\n...and others. Please view the dashboard Expiry Monitor for the full report.`;
    }

    await sendMessage(formattedPhone, undefined, msg);
        res.json({ success: true, message: `Alert summary successfully sent to ${targetPhone}` });
  } catch (error) {
    console.error('Trigger expiry alert error:', error);
    res.status(500).json({ error: 'Failed to send summary report alerts via WhatsApp' });
  }
});

export default router;
