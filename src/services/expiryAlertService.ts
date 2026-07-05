import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export async function runExpiryScanAndAlert(days = 90): Promise<boolean> {
  console.log(`[ExpiryScan] Executing automatic 15-day near-expiry inventory scan (horizon: ${days} days)...`);
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    
    // Fetch items nearing expiry / already expired
    const rows = await db.all(`
      SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE date(im.expiry_date) <= date('now', '+' || ? || ' days')
      AND im.quantity > 0
      ORDER BY im.expiry_date ASC
      LIMIT 10
    `, [days]);

    if (rows.length === 0) {
      console.log('[ExpiryScan] No near-expiry items found to report.');
            return true; // No items is a successful scan
    }

    // Load owner/pharmacist phone number from settings
    const phoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_phone'");
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    
    const targetPhone = phoneRow?.value;
    const medicalName = nameRow?.value || 'AI Pharmacy';

    if (!targetPhone) {
      console.warn('[ExpiryScan] Expiry scan completed, but no `owner_phone` is configured in app_settings. WhatsApp alert skipped.');
      // Fallback: log system alert
      const dbLog = await dbManager.getConnection();
      await dbLog.run(
        "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
        'AUTOMATION_ALERT',
        `❌ Expiry Alert Failure: Owner WhatsApp number not configured. Expiring list contains ${rows.length} item(s).`
      );
            return false; // Not fully successful (skipped notification)
    }

    // Load WhatsApp client and send message
    const { sendMessage } = await import('../whatsappClient.js');
    const cleanPhone = targetPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    // Construct reports list message
    let msg = `📋 *${medicalName} - Auto 15-Day Expiry Report*\n`;
    msg += `The following inventory items are expiring soon (within ${days} days):\n\n`;
    
    rows.forEach((r, index) => {
      const expDate = new Date(r.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' });
      msg += `${index + 1}. *${r.medicine_name}* (Batch: ${r.batch_no}) | Exp: ${expDate} | Qty: ${r.quantity}\n`;
    });
    
    if (rows.length >= 10) {
      msg += `\n...and others. Please log in to the dashboard Expiry Monitor for the full report.`;
    }

    await sendMessage(formattedPhone, undefined, msg);
    console.log(`[ExpiryScan] Auto WhatsApp alert summary successfully dispatched to ${targetPhone}`);
    return true;
  } catch (err: any) {
    console.error('[ExpiryScan] Error running automatic expiry scan:', err);
    try {
      const dbLog = await dbManager.getConnection();
      await dbLog.run(
        "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
        'AUTOMATION_ALERT',
        `❌ Expiry Alert Failure: WhatsApp message failed to dispatch. Technical Error: ${err.message || 'Unknown network error'}`
      );
          } catch (_) {}
    return false;
  }
}

export async function checkAndRunScheduledExpiryScan(days = 90) {
  console.log('[ExpiryScan] Checking if scheduled 15-day expiry scan is overdue...');
  
  try {
    await rebuildAllExpiryCaches();
  } catch (err) {
    console.error('[ExpiryScan] Failed to build cache files during check:', err);
  }

  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    
    // Check last scan timestamp
    const lastScanRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_expiry_scan_timestamp'");
    
    const now = new Date();
    let shouldRun = false;

    if (!lastScanRow || !lastScanRow.value) {
      // Never run before, should run now
      shouldRun = true;
      console.log('[ExpiryScan] No previous execution timestamp found. Triggering scan for the first time.');
    } else {
      const lastScanDate = new Date(lastScanRow.value);
      const diffTime = now.getTime() - lastScanDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      
      console.log(`[ExpiryScan] Last execution was ${diffDays.toFixed(2)} days ago (${lastScanRow.value}).`);
      
      if (diffDays >= 15) {
        shouldRun = true;
        console.log('[ExpiryScan] Over 15 days have elapsed. Triggering catch-up scan.');
      } else {
        console.log(`[ExpiryScan] Scan is up to date. Next run in ${(15 - diffDays).toFixed(2)} days.`);
      }
    }

    if (shouldRun) {
      // Execute the scan & WhatsApp alerts
      const success = await runExpiryScanAndAlert(days);
      
      if (success) {
        // Update database timestamp to current time only after a successful run
        const dbUpdate = await dbManager.getConnection();
        await dbUpdate.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ['last_expiry_scan_timestamp', now.toISOString()]);
        console.log('[ExpiryScan] Execution timestamp successfully updated in database.');
      } else {
        console.warn('[ExpiryScan] Expiry scan skipped or failed to send notification. Database timestamp not updated (will retry next check).');
      }
    }
  } catch (err) {
    console.error('[ExpiryScan] Failed to execute scheduled expiry scan check:', err);
  }
}

export function getExpiryYearMonth(expiryDateStr: string | null | undefined): string {
  if (!expiryDateStr) return 'unknown';
  let year: number;
  let month: number;
  
  const trimmed = expiryDateStr.trim();
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    month = parseInt(parts[0], 10);
    year = parseInt(parts[1], 10);
    if (year < 100) year += 2000;
  } else {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return 'unknown';
    year = d.getFullYear();
    month = d.getMonth() + 1;
  }
  
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return 'unknown';
  }
  
  return `${year}_${String(month).padStart(2, '0')}`;
}

export async function rebuildAllExpiryCaches(): Promise<void> {
  console.log('[ExpiryCache] Rebuilding all month-wise expiry cache files...');
  try {
    const db = await dbManager.getConnection();
    // Only fetch items that still have stock — zero-qty = sold/returned
    const rows = await db.all(`
      SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.mrp, im.rack_location,
             pi.id as purchase_item_id, pi.cost_price as purchase_cost_price, p.invoice_no as purchase_invoice_no, p.id as purchase_id,
             d.id as distributor_id, d.name as distributor_name
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN purchase_items pi ON pi.id = (
        SELECT pi3.id 
        FROM purchase_items pi3 
        WHERE pi3.medicine_id = im.medicine_id AND pi3.batch_no = im.batch_no 
        ORDER BY pi3.id DESC 
        LIMIT 1
      )
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE im.quantity > 0
      ORDER BY im.expiry_date ASC
    `);

    const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'cache', 'expiry');
    
    // Delete all existing cache files — old files for empty months must not survive
    if (fs.existsSync(cacheDir)) {
      const files = await fs.promises.readdir(cacheDir);
      for (const file of files) {
        if (file.startsWith('expiry_') && file.endsWith('.json')) {
          await fs.promises.unlink(path.join(cacheDir, file));
        }
      }
    } else {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    }

    // Group items by year_month
    const groups: Record<string, typeof rows> = {};
    for (const r of rows) {
      const ym = getExpiryYearMonth(r.expiry_date);
      if (!groups[ym]) groups[ym] = [];
      groups[ym].push(r);
    }

    // Write a file ONLY for months that have at least one item with stock.
    // Empty months get NO file — a missing file = empty month (all sold/returned).
    let written = 0;
    for (const [ym, items] of Object.entries(groups)) {
      if (ym === 'unknown') continue; // skip bad expiry dates
      const filePath = path.join(cacheDir, `expiry_${ym}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(items, null, 2), 'utf-8');
      written++;
    }
    console.log(`[ExpiryCache] Rebuilt: ${written} month file(s) with stock. Empty months auto-removed.`);
  } catch (err) {
    console.error('[ExpiryCache] Error rebuilding expiry caches:', err);
  }
}

let rebuildTimeout: NodeJS.Timeout | null = null;

/**
 * Surgical per-item cache patch.
 * Called after a sale or return — only touches the ONE month file
 * that contains the affected inventory item.
 * - If qty > 0 : updates the item's quantity inside the file.
 * - If qty = 0 : removes the item from the file.
 * - If file becomes empty : deletes the file (empty month = no file).
 * Does NOT touch any other month file.
 */
export async function patchExpiryCacheForInventoryItem(inventoryId: number): Promise<void> {
  try {
    const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'cache', 'expiry');
    if (!fs.existsSync(cacheDir)) return; // cache not initialised yet, skip

    const db = await dbManager.getConnection();
    const item = await db.get<{
      id: number; medicine_id: number; medicine_name: string; batch_no: string;
      expiry_date: string; quantity: number; mrp: number; rack_location: string | null;
      purchase_item_id: number | null; purchase_cost_price: number | null;
      purchase_invoice_no: string | null; purchase_id: number | null;
      distributor_id: number | null; distributor_name: string | null;
    }>(`
      SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date,
             im.quantity, im.mrp, im.rack_location,
             pi.id as purchase_item_id, pi.cost_price as purchase_cost_price, p.invoice_no as purchase_invoice_no, p.id as purchase_id,
             d.id as distributor_id, d.name as distributor_name
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN purchase_items pi ON pi.id = (
        SELECT pi3.id 
        FROM purchase_items pi3 
        WHERE pi3.medicine_id = im.medicine_id AND pi3.batch_no = im.batch_no 
        ORDER BY pi3.id DESC 
        LIMIT 1
      )
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE im.id = ?
    `, [inventoryId]);

    if (!item) return; // deleted inventory row — nothing to do

    const ym = getExpiryYearMonth(item.expiry_date);
    if (ym === 'unknown') return;

    const filePath = path.join(cacheDir, `expiry_${ym}.json`);

    // Read existing month file (may not exist if month was previously empty)
    let monthItems: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        monthItems = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
      } catch {
        monthItems = [];
      }
    }

    // Remove stale entry for this item
    monthItems = monthItems.filter((i: any) => i.id !== inventoryId);

    if (item.quantity > 0) {
      // Still has stock — add updated entry back
      monthItems.push(item);
      monthItems.sort((a: any, b: any) =>
        String(a.expiry_date).localeCompare(String(b.expiry_date))
      );
    }
    // If qty === 0: item was already removed above — stays removed

    if (monthItems.length === 0) {
      // All medicines in this month are now sold/returned — delete the file
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        console.log(`[ExpiryCache] Patch: ${ym} file deleted (all items sold/returned).`);
      }
    } else {
      await fs.promises.writeFile(filePath, JSON.stringify(monthItems, null, 2), 'utf-8');
      console.log(`[ExpiryCache] Patch: ${ym} updated for inventory #${inventoryId} (qty=${item.quantity}).`);
    }
  } catch (err) {
    console.error('[ExpiryCache] Error patching expiry cache for item:', inventoryId, err);
  }
}

/**
 * Debounced trigger. When inventoryIds are known (sale / return),
 * patches only those specific items. Falls back to full rebuild
 * when IDs are not available (e.g. bulk purchase import).
 */
export function triggerExpiryCacheRebuildDebounced(inventoryIds?: number[]): void {
  if (rebuildTimeout) clearTimeout(rebuildTimeout);

  rebuildTimeout = setTimeout(async () => {
    rebuildTimeout = null;
    if (inventoryIds && inventoryIds.length > 0) {
      // Surgical: only update the affected items' month files
      for (const id of inventoryIds) {
        await patchExpiryCacheForInventoryItem(id);
      }
    } else {
      // Full rebuild — used on startup / bulk imports
      await rebuildAllExpiryCaches();
    }
  }, 800);
}
