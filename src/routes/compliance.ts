import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Compliance check placeholder – returns basic info
router.get('/', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    // Example: ensure no expired inventory items remain unsold
    const expiredCount = await db.get(`
      SELECT COUNT(*) as cnt FROM inventory_master 
      WHERE expiry_date IS NOT NULL AND 
      CASE 
        WHEN length(expiry_date) = 5 THEN ('20' || substr(expiry_date, 4, 2) || '-' || substr(expiry_date, 1, 2))
        WHEN length(expiry_date) = 7 THEN (substr(expiry_date, 4, 4) || '-' || substr(expiry_date, 1, 2))
        WHEN expiry_date LIKE '____-__%' THEN substr(expiry_date, 1, 7)
        ELSE expiry_date 
      END < strftime('%Y-%m', 'now')
    `);
    res.json({ expiredItems: expiredCount.cnt, status: expiredCount.cnt === 0 ? 'compliant' : 'non-compliant' });
  } catch (err) {
    console.error('Compliance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/add', async (req, res) => {
  const { date, product, patient_id, doctor_id, license_no, qty, bill_no } = req.body;
  if (!date || !product) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [date, product, patient_id, doctor_id, license_no, qty, bill_no, 'general']
    );
        res.json({ success: true, message: 'Compliance entry added' });
  } catch (err) {
    console.error('Add compliance entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New route for Schedule H1 dispensing events
router.post('/add-schedule-h1', async (req, res) => {
  const { drug_name, patient_name, doctor_name, date, license_no, qty, bill_no } = req.body;
  if (!drug_name || !patient_name || !doctor_name) {
    return res.status(400).json({ error: 'Missing required fields: drug_name, patient_name, doctor_name' });
  }
  try {
    const db = await dbManager.getConnection();
    // Use provided date or default to today
    const finalDate = date || new Date().toISOString().split('T')[0];
    // Insert a record indicating a Schedule H1 dispensing event occurred
    await db.run(
      'INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [finalDate, drug_name, patient_name, doctor_name, license_no || null, qty || null, bill_no || null, 'H1']
    );
        res.json({ success: true, message: 'Schedule H1 dispensing event logged' });
  } catch (err) {
    console.error('Add Schedule H1 compliance entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/h1-register', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    // Try querying compliance_logs table
    const rows = await db.all('SELECT * FROM compliance_logs ORDER BY id DESC');
        res.json(rows);
  } catch (err) {
    console.error('Fetch Schedule H1 register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
