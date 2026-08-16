import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Compliance summary: counts inventory items past their expiry date
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

    // Sanitise any historical compliance records that carry the fake 'REG-NA' placeholder.
    // These were written by old code; mark them missing_license=1 and NULL the fake value so
    // they surface in the Compliance page for operator review instead of passing as legitimate.
    await db.run(
      `UPDATE compliance_logs
       SET license_no = NULL, missing_license = 1
       WHERE license_no = 'REG-NA'`
    );

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

// Dashboard aggregated metrics for Schedule H1 / H / X compliance
router.get('/dashboard', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    
    const todayStr = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = todayStr.substring(0, 7) + '-01';

    const todayCountRow = await db.get(`
      SELECT COUNT(*) as count FROM compliance_logs 
      WHERE (schedule_type IN ('H1', 'H', 'X', 'Schedule H1') OR schedule_type LIKE '%H1%')
      AND date >= ?
    `, [todayStr]);

    const monthCountRow = await db.get(`
      SELECT COUNT(*) as count FROM compliance_logs 
      WHERE (schedule_type IN ('H1', 'H', 'X', 'Schedule H1') OR schedule_type LIKE '%H1%')
      AND date >= ?
    `, [firstDayOfMonth]);

    const pendingDoctorRow = await db.get(`
      SELECT COUNT(*) as count FROM compliance_logs
      WHERE (schedule_type IN ('H1', 'H', 'X', 'Schedule H1') OR schedule_type LIKE '%H1%')
      AND (
        doctor_name IS NULL OR doctor_name = ''
        OR doctor_name LIKE '%Self%'
        OR doctor_name LIKE '%Pending%'
        OR missing_license = 1
        OR license_no = 'REG-NA'
      )
    `);

    const totalLogsRow = await db.get(`SELECT COUNT(*) as count FROM compliance_logs`);

    res.json({
      success: true,
      todayH1Sales: todayCountRow?.count || 0,
      monthlyH1Sales: monthCountRow?.count || 0,
      pendingDoctorAssignments: pendingDoctorRow?.count || 0,
      totalComplianceLogs: totalLogsRow?.count || 0
    });
  } catch (err: any) {
    console.error('Compliance dashboard error:', err);
    res.status(500).json({ error: 'Failed to load compliance dashboard metrics' });
  }
});

// Enhanced Schedule H1/H/X Filterable Register
router.get('/h1-register', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { startDate, endDate, search, doctor, scheduleType } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    if (startDate) {
      conditions.push('date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('date <= ?');
      params.push(endDate);
    }
    if (search) {
      conditions.push('(drug_name LIKE ? OR patient_name LIKE ? OR bill_no LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (doctor) {
      conditions.push('doctor_name LIKE ?');
      params.push(`%${doctor}%`);
    }
    if (scheduleType && scheduleType !== 'ALL') {
      conditions.push('schedule_type = ?');
      params.push(scheduleType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(`SELECT * FROM compliance_logs ${whereClause} ORDER BY id DESC LIMIT 500`, params);

    res.json(rows);
  } catch (err: any) {
    console.error('Fetch Schedule H1 register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Doctor Name on Compliance Entry
router.put('/:id/doctor', async (req, res) => {
  const { id } = req.params;
  const { doctor_name, license_no } = req.body;
  if (!doctor_name) {
    return res.status(400).json({ error: 'doctor_name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'UPDATE compliance_logs SET doctor_name = ?, license_no = COALESCE(?, license_no) WHERE id = ?',
      [doctor_name, license_no || null, id]
    );
    res.json({ success: true, message: 'Doctor details updated successfully' });
  } catch (err: any) {
    console.error('Update compliance doctor error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export CSV for Statutory Inspector Audits
router.get('/export', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type FROM compliance_logs ORDER BY id DESC');

    const headers = ['Date', 'Drug Name', 'Patient Name', 'Prescribing Doctor', 'Doctor Reg/License No', 'Qty Sold', 'Invoice Bill No', 'Schedule Type'];
    const csvLines = [headers.join(',')];

    for (const r of rows) {
      const line = [
        `"${r.date || ''}"`,
        `"${(r.drug_name || '').replace(/"/g, '""')}"`,
        `"${(r.patient_name || '').replace(/"/g, '""')}"`,
        `"${(r.doctor_name || '').replace(/"/g, '""')}"`,
        `"${(r.license_no || '').replace(/"/g, '""')}"`,
        r.qty || 0,
        `"${(r.bill_no || '').replace(/"/g, '""')}"`,
        `"${(r.schedule_type || '').replace(/"/g, '""')}"`
      ];
      csvLines.push(line.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="Schedule_H1_Register_Export.csv"');
    res.send(csvLines.join('\n'));
  } catch (err: any) {
    console.error('Compliance CSV Export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
