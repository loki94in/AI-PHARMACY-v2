import { jest } from '@jest/globals';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

// Mock whatsappClient sendMessage BEFORE importing anything that imports it
let capturedMessage = null;
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: async (phone, _, text) => {
    capturedMessage = { phone, text };
    console.log(`\n--- MOCK WHATSAPP CLIENT SENDING TO ADMIN (${phone}) ---`);
    console.log(text);
    console.log('-----------------------------------------------------\n');
    return { success: true };
  }
}));

async function main() {
  const dbPath = path.resolve('data', 'app.db');
  console.log('Using database:', dbPath);
  
  // Set DB path env var
  process.env.DB_PATH = dbPath;

  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  try {
    // 1. Ensure the setting is true and admin phone is set
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')");
    // Get existing admin_whatsapp if set, or set a dummy one
    let adminRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_whatsapp'");
    if (!adminRow || !adminRow.value) {
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_whatsapp', '919876543210')");
      adminRow = { value: '919876543210' };
    }
    console.log('Admin WhatsApp setting:', adminRow.value);

    // 2. Ensure customer exists
    await db.run("INSERT OR IGNORE INTO customers (id, name, phone) VALUES (999, 'Azetor Test Customer', '919000000001@c.us')");

    // 3. Clear existing escalations for clean run
    await db.run("DELETE FROM wa_admin_escalations WHERE msg_id = 'msg-azetor-1234'");
    await db.run("DELETE FROM staged_medicine_reviews WHERE search_query = 'azetor 20'");

    // 4. Import intent service
    const { handleInbound } = await import('../src/services/whatsappIntentService.js');

    // 5. Simulate inbound message: "buy azetor 20"
    console.log('Simulating inbound message: "buy azetor 20"...');
    await handleInbound({
      from: '919000000001@c.us',
      body: 'buy azetor 20',
      id: 'msg-azetor-1234',
      hasMedia: false
    });

    // Wait a brief moment for async promises to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 6. Query the results
    console.log('--- Results from Database ---');
    const escalations = await db.all("SELECT * FROM wa_admin_escalations WHERE msg_id = 'msg-azetor-1234'");
    console.log('Escalation row:', escalations);

    const reviews = await db.all("SELECT * FROM staged_medicine_reviews WHERE search_query = 'azetor 20'");
    console.log('Staged reviews:', reviews);

  } catch (err) {
    console.error('Error during simulation:', err);
  } finally {
    await db.close();
  }
}

main();
