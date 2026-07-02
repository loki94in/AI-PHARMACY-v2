// Telegram Prescription Routes for cart management
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { telegramPrescriptionService } from '../services/telegramPrescriptionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Get cart for a Telegram chat
router.get('/cart/:chatId', async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId, 10);
    if (isNaN(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    const cartItems = telegramPrescriptionService.getCartItems(chatId);
    const { subtotal, tax, total } = telegramPrescriptionService.calculateCartTotal(chatId);

    res.json({
      chatId,
      items: cartItems,
      subtotal,
      tax,
      total,
      itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0)
    });
  } catch (error) {
    console.error('Error getting cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add item to cart
router.post('/cart/add', async (req, res) => {
  try {
    const { chatId, medicineName, quantity } = req.body;

    if (!chatId || !medicineName) {
      return res.status(400).json({ error: 'Chat ID and medicine name are required' });
    }

    const parsedChatId = parseInt(chatId, 10);
    const parsedQuantity = quantity ? parseInt(quantity, 10) : 1;

    if (isNaN(parsedChatId)) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    const success = await telegramPrescriptionService.addItemToCart(
      parsedChatId,
      medicineName.trim(),
      parsedQuantity
    );

    if (success) {
      const { subtotal, tax, total } = telegramPrescriptionService.calculateCartTotal(parsedChatId);
      res.json({
        success: true,
        message: 'Item added to cart',
        cart: {
          subtotal,
          tax,
          total,
          itemCount: telegramPrescriptionService.getCartItems(parsedChatId).reduce((sum, item) => sum + item.quantity, 0)
        }
      });
    } else {
      res.status(400).json({ error: 'Failed to add item to cart' });
    }
  } catch (error) {
    console.error('Error adding item to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear cart
router.delete('/cart/:chatId', async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId, 10);
    if (isNaN(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    telegramPrescriptionService.clearCart(chatId);
    res.json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate bill from cart
router.post('/bill/generate', async (req, res) => {
  let db;
  try {
    const { chatId, patient_id, doctor_id, discount = 0, payment_medium } = req.body;

    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' });
    }

    const parsedChatId = parseInt(chatId, 10);
    if (isNaN(parsedChatId)) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    // Get cart items
    const cartItems = telegramPrescriptionService.getCartItems(parsedChatId);
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Prepare items for sale creation
    const items = cartItems.map(item => ({
      inventory_id: item.inventory_id,
      quantity: item.quantity,
      unit_price: item.unit_price
    }));

    db = await dbManager.getConnection();

    // Link customer to telegram chatId if patient_id is not passed
    let finalPatientId = patient_id;
    if (!finalPatientId) {
      const customer = await db.get("SELECT id FROM customers WHERE notes LIKE ?", [`%tg:${parsedChatId}%`]);
      if (!customer) {
        const custRes = await db.run(
          "INSERT INTO customers (name, notes, credit_enabled) VALUES (?, ?, 1)",
          [`Telegram User ${parsedChatId}`, `tg:${parsedChatId}`, 1]
        );
        finalPatientId = custRes.lastID;
      } else {
        finalPatientId = customer.id;
      }
    }

    // Generate invoice number
    const year = new Date().getFullYear();
    const prefix = `S-${year}-`;
    const row = await db.get('SELECT invoice_no FROM sales_invoices WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1', `${prefix}%`);
    let nextNum = 1;
    if (row && row.invoice_no) {
      const parts = row.invoice_no.split('-');
      const numPart = parts[2];
      nextNum = parseInt(numPart, 10) + 1;
    }
    const padded = String(nextNum).padStart(4, '0');
    const invoice_no = `${prefix}${padded}`;

    // Compute totals
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.quantity * item.unit_price;
    }

    const taxRate = 0.05; // 5% tax
    const total = Math.round(subtotal - discount);
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

    const paymentMedium = payment_medium || 'CASH';
    const paymentStatus = paymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID';

    // Insert invoice
    const result = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status) VALUES (?, ?, ?, ?, ?, ?)',
      [invoice_no, finalPatientId, total, tax, paymentMedium, paymentStatus]
    );
    const invoiceId = result.lastID!;

    // Update customer credit balance if CREDIT
    if (paymentMedium === 'CREDIT') {
      await db.run(
        'UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?',
        [total, finalPatientId]
      );
    }

    // Insert line items and update inventory
    for (const item of items) {
      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [invoiceId, item.inventory_id, item.quantity, item.unit_price]
      );
      // Decrement stock
      await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.inventory_id]);
    }

    
    // Clear cart after successful bill generation
    telegramPrescriptionService.clearCart(parsedChatId);

    // Trigger WhatsApp delivery asynchronously
    import('../services/whatsappInvoiceService.js').then(({ whatsappInvoiceService }) => {
      whatsappInvoiceService.sendInvoiceViaWhatsApp(invoiceId).catch(console.error);
    });

    res.json({
      success: true,
      invoice_no,
      total,
      tax,
      message: 'Bill generated successfully'
    });
  } catch (error) {
    console.error('Error generating bill:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;