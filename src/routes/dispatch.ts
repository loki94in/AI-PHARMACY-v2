// Dispatch & Support API
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { notificationService } from '../services/notificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// ─── DISPATCH ORDERS ────────────────────────────────────────────────────────

// GET all dispatch orders (with delivery boy name joined)
router.get('/orders', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const orders = await db.all(`
      SELECT d.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone
      FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id
      ORDER BY d.created_at DESC
    `);
        res.json(orders);
  } catch (err) {
    console.error('Dispatch orders fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch dispatch orders' });
  }
});

// POST create dispatch order
router.post('/orders', async (req, res) => {
  const { patient_name, patient_phone, address, items, notes, delivery_boy_id, invoice_no } = req.body;
  if (!patient_name) return res.status(400).json({ error: 'patient_name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      `INSERT INTO dispatch_orders (patient_name, patient_phone, address, items, notes, delivery_boy_id, invoice_no)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patient_name, patient_phone || '', address || '', items || '', notes || '', delivery_boy_id || null, invoice_no || '']
    );
    const newOrder = await db.get(`
      SELECT d.*, db.name as delivery_boy_name FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id WHERE d.id = ?`, result.lastID);

    if (invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (create order):', err);
      });
    }

    res.status(201).json(newOrder);
  } catch (err) {
    console.error('Create dispatch order error:', err);
    res.status(500).json({ error: 'Failed to create dispatch order' });
  }
});

// PUT update dispatch order status / fields
router.put('/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status, delivery_boy_id, notes, address, patient_phone } = req.body;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM dispatch_orders WHERE id = ?', id);
    if (!existing) {  return res.status(404).json({ error: 'Order not found' }); }

    const newStatus = status ?? existing.status;
    const newBoy = delivery_boy_id ?? existing.delivery_boy_id;
    const deliveredAt = newStatus === 'Delivered' && existing.status !== 'Delivered'
      ? new Date().toISOString() : existing.delivered_at;

    await db.run(
      `UPDATE dispatch_orders SET status=?, delivery_boy_id=?, notes=?, address=?, patient_phone=?, delivered_at=? WHERE id=?`,
      [newStatus, newBoy, notes ?? existing.notes, address ?? existing.address,
       patient_phone ?? existing.patient_phone, deliveredAt, id]
    );
    const updated = await db.get(`
      SELECT d.*, db.name as delivery_boy_name FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id WHERE d.id = ?`, id);

    if (existing && existing.invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(existing.invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (update order):', err);
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update dispatch order error:', err);
    res.status(500).json({ error: 'Failed to update dispatch order' });
  }
});

// DELETE dispatch order
router.delete('/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const result = await db.run('DELETE FROM dispatch_orders WHERE id = ?', id);
        if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete dispatch order error:', err);
    res.status(500).json({ error: 'Failed to delete dispatch order' });
  }
});

// ─── DELIVERY BOYS ────────────────────────────────────────────────────────────

// GET /api/dispatch/delivery-boys
router.get('/delivery-boys', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const boys = await db.all('SELECT * FROM delivery_boys ORDER BY name');
        res.json(boys);
  } catch (error) {
    console.error('Fetch delivery boys error:', error);
    res.status(500).json({ error: 'Failed to fetch delivery boys' });
  }
});

// POST /api/dispatch/delivery-boys
router.post('/delivery-boys', async (req, res) => {
  const { name, whatsapp_number, telegram_chat_id, is_active } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      'INSERT INTO delivery_boys (name, whatsapp_number, telegram_chat_id, is_active) VALUES (?, ?, ?, ?)',
      [name, whatsapp_number || null, telegram_chat_id || null, is_active !== undefined ? is_active : 1]
    );
    const newBoy = await db.get('SELECT * FROM delivery_boys WHERE id = ?', result.lastID);
        res.status(201).json(newBoy);
  } catch (error) {
    console.error('Add delivery boy error:', error);
    res.status(500).json({ error: 'Failed to add delivery boy' });
  }
});

// PUT /api/dispatch/delivery-boys/:id
router.put('/delivery-boys/:id', async (req, res) => {
  const { id } = req.params;
  const { name, whatsapp_number, telegram_chat_id, is_active } = req.body;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM delivery_boys WHERE id = ?', id);
    if (!existing) {  return res.status(404).json({ error: 'Delivery boy not found' }); }
    await db.run(
      `UPDATE delivery_boys SET name=?, whatsapp_number=?, telegram_chat_id=?, is_active=? WHERE id=?`,
      [name ?? existing.name, whatsapp_number ?? existing.whatsapp_number,
       telegram_chat_id ?? existing.telegram_chat_id, is_active ?? existing.is_active, id]
    );
    const updated = await db.get('SELECT * FROM delivery_boys WHERE id = ?', id);
        res.json(updated);
  } catch (error) {
    console.error('Update delivery boy error:', error);
    res.status(500).json({ error: 'Failed to update delivery boy' });
  }
});

// DELETE /api/dispatch/delivery-boys/:id
router.delete('/delivery-boys/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const result = await db.run('DELETE FROM delivery_boys WHERE id = ?', id);
        if (result.changes === 0) return res.status(404).json({ error: 'Delivery boy not found' });
    res.json({ success: true, message: 'Delivery boy deleted' });
  } catch (error) {
    console.error('Delete delivery boy error:', error);
    res.status(500).json({ error: 'Failed to delete delivery boy' });
  }
});

// Legacy support route
router.post('/', async (req, res) => {
  const { type, description } = req.body;
  if (!type || !description) return res.status(400).json({ error: 'type and description required' });
  try {
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['DISPATCH', `${type}: ${description}`]);
        res.json({ success: true, message: 'Dispatch logged' });
  } catch (error) {
    console.error('Dispatch error:', error);
    res.status(500).json({ error: 'Failed to log dispatch' });
  }
});

export default router;

