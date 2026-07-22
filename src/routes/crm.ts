import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendDailyDoctorReports } from '../services/doctorReportingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Get patients
router.get('/patients', async (req, res) => {
  const { q, limit } = req.query;
  try {
    const db = await dbManager.getConnection();
    let query = 'SELECT * FROM customers';
    const params = [];
    
    if (q) {
      query += ' WHERE name LIKE ? OR phone LIKE ?';
      params.push(`%${q}%`, `%${q}%`);
    }
    
    query += ' ORDER BY id DESC';
    
    if (limit) {
      const limitVal = parseInt(limit as string, 10);
      if (!isNaN(limitVal)) {
        query += ' LIMIT ?';
        params.push(limitVal);
      }
    }
    
    const patients = await db.all(query, params);
    res.json(patients);
  } catch (error) {
    console.error('Failed to fetch patients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create patient
router.post('/patients', async (req, res) => {
  const { name, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      'INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)',
      [name, phone || '', address || '', notes || '']
    );
    const newPatient = await db.get('SELECT * FROM customers WHERE id = ?', result.lastID);
        res.status(201).json(newPatient);
  } catch (error) {
    console.error('Failed to create patient:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update patient
router.put('/patients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, address, notes } = req.body;
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'UPDATE customers SET name=?, phone=?, address=?, notes=? WHERE id=?',
      [name, phone || '', address || '', notes || '', id]
    );
    const updated = await db.get('SELECT * FROM customers WHERE id = ?', id);
        res.json(updated);
  } catch (error) {
    console.error('Failed to update patient:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete patient
router.delete('/patients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM customers WHERE id = ?', id);
        res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete patient:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get customers (legacy alias)
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const customers = await db.all('SELECT * FROM customers ORDER BY id DESC');
        res.json(customers);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get customer history
router.get('/:id/history', async (req, res) => {
  const customerId = req.params.id;
  try {
    const db = await dbManager.getConnection();
    // Agent 1 manages sales_invoices, we can safely read it here
    const history = await db.all(
      'SELECT * FROM sales_invoices WHERE customer_id = ? ORDER BY date DESC',
      [customerId]
    );
        res.json(history);
  } catch (error) {
    console.error('Failed to fetch history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get doctors list
router.get('/doctors', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const doctors = await db.all('SELECT * FROM doctors ORDER BY name ASC');
        res.json(doctors);
  } catch (error) {
    console.error('Failed to fetch doctors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a doctor
router.post('/doctors', async (req, res) => {
  const { name, speciality, phone, hospital, degree, reg_no, send_daily_summary } = req.body;
  if (!name) return res.status(400).json({ error: 'Doctor name is required' });
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO doctors (name, speciality, phone, hospital, degree, reg_no, send_daily_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, speciality || '', phone || '', hospital || '', degree || '', reg_no || '', send_daily_summary ? 1 : 0]
    );
    res.json({ success: true, message: 'Doctor added successfully' });
  } catch (error) {
    console.error('Failed to add doctor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a doctor
router.put('/doctors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, speciality, phone, hospital, degree, reg_no, send_daily_summary } = req.body;
  if (!name) return res.status(400).json({ error: 'Doctor name is required' });
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE doctors 
       SET name = ?, speciality = ?, phone = ?, hospital = ?, degree = ?, reg_no = ?, send_daily_summary = ?
       WHERE id = ?`,
      [name, speciality || '', phone || '', hospital || '', degree || '', reg_no || '', send_daily_summary ? 1 : 0, id]
    );
    const updated = await db.get('SELECT * FROM doctors WHERE id = ?', id);
    res.json({ success: true, doctor: updated });
  } catch (error) {
    console.error('Failed to update doctor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a doctor
router.delete('/doctors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM doctors WHERE id = ?', id);
    res.json({ success: true, message: 'Doctor deleted successfully' });
  } catch (error) {
    console.error('Failed to delete doctor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger daily doctor WhatsApp reports manually for testing
router.post('/doctors/send-daily-reports', async (req, res) => {
  const { date } = req.body; // e.g. "2026-06-22", optional
  try {
    const result = await sendDailyDoctorReports(date);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to manually trigger doctor reports:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Get suggestions for a doctor
router.get('/doctors/:id/suggestions', async (req, res) => {
  const doctorId = req.params.id;
  const limit = parseInt(req.query.limit as string, 10) || 25;
  try {
    const db = await dbManager.getConnection();
    // Fetch top most frequently prescribed medicines by this doctor, including last qty
    const suggestions = await db.all(
      `SELECT m.id, m.name, COUNT(*) as frequency,
        (SELECT si.quantity FROM sale_items si
         JOIN inventory_master im2 ON si.inventory_id = im2.id
         WHERE im2.medicine_id = m.id
           AND si.invoice_id IN (SELECT id FROM sales_invoices WHERE doctor_id = ?)
         ORDER BY si.id DESC LIMIT 1) as last_qty
       FROM sale_items si
       JOIN sales_invoices s ON si.invoice_id = s.id
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE s.doctor_id = ?
       GROUP BY m.id ORDER BY frequency DESC LIMIT ?`,
      [doctorId, doctorId, limit]
    );
    await dbManager.close();
    res.json(suggestions);
  } catch (error: any) {
    await dbManager.close();
    console.error('Failed to fetch doctor suggestions:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Get medicine combinations for a doctor and a specific medicine
router.get('/doctors/:id/combinations/:medicineId', async (req, res) => {
  const doctorId = req.params.id;
  const medicineId = req.params.medicineId;
  try {
    const db = await dbManager.getConnection();
    const combinations = await db.all(
      `SELECT m.id, m.name, COUNT(*) as co_count,
        (SELECT si2.quantity FROM sale_items si2
         JOIN inventory_master im3 ON si2.inventory_id = im3.id
         WHERE im3.medicine_id = m.id
           AND si2.invoice_id IN (SELECT s2.id FROM sales_invoices s2 WHERE s2.doctor_id = ?)
         ORDER BY si2.id DESC LIMIT 1) as last_qty
       FROM sale_items a
       JOIN sale_items b ON a.invoice_id = b.invoice_id AND a.inventory_id != b.inventory_id
       JOIN sales_invoices s ON s.id = a.invoice_id
       JOIN inventory_master im ON im.id = b.inventory_id
       JOIN medicines m ON m.id = im.medicine_id
       JOIN inventory_master im_a ON im_a.id = a.inventory_id
       WHERE s.doctor_id = ? AND im_a.medicine_id = ?
       GROUP BY m.id ORDER BY co_count DESC LIMIT 10`,
      [doctorId, doctorId, medicineId]
    );
    await dbManager.close();
    res.json(combinations);
  } catch (error: any) {
    await dbManager.close();
    console.error('Failed to fetch doctor combinations:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Pay ledger balance
router.post('/ledger/pay', async (req, res) => {
  const { customer_id, amount } = req.body;
  if (!customer_id || !amount) {
    return res.status(400).json({ error: 'Customer ID and amount are required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'UPDATE customers SET credit_balance = MAX(0, credit_balance - ?) WHERE id = ?',
      [amount, customer_id]
    );
    res.json({ success: true, message: `Paid ₹${amount} successfully` });
  } catch (error) {
    console.error('Failed to pay ledger:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

