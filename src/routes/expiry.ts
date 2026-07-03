import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function getNDaysAheadString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getMonthsInRange(dateFromStr: string, dateToStr: string): string[] {
  const start = new Date(dateFromStr);
  const end = new Date(dateToStr);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }
  
  const months: string[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  
  while (current <= last) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    months.push(`${y}_${m}`);
    current.setMonth(current.getMonth() + 1);
  }
  
  return months;
}

function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  let itemDate: Date;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    let month = parseInt(parts[0], 10) - 1; // 0-indexed
    let year = parseInt(parts[1], 10);
    if (year < 100) year += 2000;
    itemDate = new Date(year, month + 1, 0); // Last day of that month
  } else {
    itemDate = new Date(dateStr);
  }
  
  const start = new Date(startStr);
  const end = new Date(endStr);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  
  return itemDate >= start && itemDate <= end;
}

// Get items nearing expiry / already expired
router.get('/', async (req, res) => {
  const date_from = (req.query.date_from as string) || getTodayString();
  let date_to = req.query.date_to as string;
  if (!date_to) {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
    date_to = getNDaysAheadString(days);
  }

  const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'cache', 'expiry');

  try {
    const months = getMonthsInRange(date_from, date_to);
    let items: any[] = [];
    let cacheLoaded = true;

    for (const ym of months) {
      const filePath = path.join(cacheDir, `expiry_${ym}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const raw = await fs.promises.readFile(filePath, 'utf-8');
          items = items.concat(JSON.parse(raw));
        } catch (err) {
          console.error(`[ExpiryCache] Failed to parse cache file for ${ym}:`, err);
          cacheLoaded = false;
          break;
        }
      } else {
        cacheLoaded = false;
        break;
      }
    }

    if (cacheLoaded && months.length > 0) {
      const filtered = items.filter(item => 
        item.quantity > 0 && 
        isDateInRange(item.expiry_date, date_from, date_to)
      );
      return res.json(filtered);
    }

    // Fallback: Query live database
    console.log('[ExpiryCache] Cache files missing or invalid. Falling back to live SQL query.');
    const db = await dbManager.getConnection();
    let query = `
      SELECT im.id, m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.mrp, im.rack_location
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE im.quantity > 0
        AND date(im.expiry_date) >= date(?)
        AND date(im.expiry_date) <= date(?)
      ORDER BY im.expiry_date ASC
    `;
    const rows = await db.all(query, [date_from, date_to]);
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
