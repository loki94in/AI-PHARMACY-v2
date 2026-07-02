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
    const expiredCount = await db.get(`SELECT COUNT(*) as cnt FROM inventory_master WHERE date(expiry_date) < date('now')`);
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
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['COMPLIANCE_ENTRY', `Date: ${date} | Product: ${product} | Patient: ${patient_id} | Doctor: ${doctor_id} | Lic: ${license_no} | Qty: ${qty} | Bill: ${bill_no}`]
    );
        res.json({ success: true, message: 'Compliance entry added' });
  } catch (err) {
    console.error('Add compliance entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New route for Schedule H1 dispensing events
router.post('/add-schedule-h1', async (req, res) => {
  const { drug_name, patient_name, doctor_name } = req.body;
  if (!drug_name || !patient_name || !doctor_name) {
    return res.status(400).json({ error: 'Missing required fields: drug_name, patient_name, doctor_name' });
  }
  try {
    const db = await dbManager.getConnection();
    // Insert a record indicating a Schedule H1 dispensing event occurred
    // We'll map the fields to the action_logs table: drug_name -> product, patient_name -> patient_id, doctor_name -> doctor_id
    // For license_no, qty, bill_no we'll use placeholder values to indicate Schedule H1 dispensing
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['SCHEDULE_H1_DISPENSE', `Drug: ${drug_name} | Patient: ${patient_name} | Doctor: ${doctor_name} | Schedule: H1`]
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
