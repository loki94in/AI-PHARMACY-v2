import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

// Fix Jest VM Float32Array instanceof checks for native ONNX / Canvas addons if needed
Object.defineProperty(Float32Array, Symbol.hasInstance, {
  value: (inst: any) => inst && inst.constructor && inst.constructor.name === 'Float32Array'
});

describe('WhatsApp OCR, Medicine & Prescription Pipeline Verification', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pipeline-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // Populate test medicines
    await db.run("INSERT INTO medicines (name, api_reference) VALUES ('Dolo 650', 'Paracetamol')");
    await db.run("INSERT INTO medicines (name, api_reference) VALUES ('Azithromycin 500mg', 'Azithromycin')");
    await db.run("INSERT INTO medicines (name, api_reference) VALUES ('Pan 40 Tablet', 'Pantoprazole')");

    // Populate api_substances for V2 Scan Gate
    await db.run("INSERT OR IGNORE INTO api_substances (api) VALUES ('paracetamol')");
    await db.run("INSERT OR IGNORE INTO api_substances (api) VALUES ('azithromycin')");
    await db.run("INSERT OR IGNORE INTO api_substances (api) VALUES ('pantoprazole')");
  }, 30000);

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('1. Inbound WhatsApp Text Pipeline: Correctly identifies medicine and broadcasts match', async () => {
    const { whatsappIntentService } = await import('../src/services/whatsappIntentService.js');
    const { eventService } = await import('../src/services/eventService.js');

    let matchedPayload: any = null;
    const listener = (event: any) => {
      if (event.type === 'wa_medicine_match') {
        matchedPayload = event.payload;
      }
    };
    eventService.on('server_event', listener);

    const mockMsg = {
      from: '919999888877@c.us',
      body: 'Do you have Dolo 650 tablets?',
      id: { _serialized: 'msg-test-101' },
      hasMedia: false
    };

    await whatsappIntentService.handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    expect(matchedPayload).not.toBeNull();
    expect(matchedPayload.medicineName).toContain('Dolo 650');
    expect(matchedPayload.confidence).toBeGreaterThanOrEqual(60);

    eventService.removeListener('wa_medicine_match', listener);
  });

  test('2. Inbound WhatsApp Repeat Order Pipeline: Returns previous refill medicine for customer', async () => {
    // Insert customer & refill history
    await db.run("INSERT INTO customers (id, name, phone) VALUES (101, 'Test Patient', '919999888866')");
    const medRow = await db.get("SELECT id FROM medicines WHERE name = 'Pan 40 Tablet'");
    await db.run(
      "INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date) VALUES ('Test Patient', '919999888866', ?, 30, DATE('now'))",
      [medRow.id]
    );

    const { whatsappIntentService } = await import('../src/services/whatsappIntentService.js');
    const { eventService } = await import('../src/services/eventService.js');

    let matchedPayload: any = null;
    const listener = (event: any) => {
      if (event.type === 'wa_medicine_match') {
        matchedPayload = event.payload;
      }
    };
    eventService.on('server_event', listener);

    const mockMsg = {
      from: '919999888866@c.us',
      body: 'wahi repeat kar do please',
      id: { _serialized: 'msg-test-102' },
      hasMedia: false
    };

    await whatsappIntentService.handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    expect(matchedPayload).not.toBeNull();
    expect(matchedPayload.isRepeat).toBe(true);
    expect(matchedPayload.medicineName).toBe('Pan 40 Tablet');

    eventService.removeListener('wa_medicine_match', listener);
  });

  test('3. WhatsApp Prescription OCR Pipeline: Processes valid medicine photo OCR and passes V2 gate', async () => {
    const { handleOcrComplete } = await import('../src/services/whatsappIntentService.js');
    const { eventService } = await import('../src/services/eventService.js');

    let matchedPayload: any = null;
    const listener = (event: any) => {
      if (event.type === 'wa_medicine_match') {
        matchedPayload = event.payload;
      }
    };
    eventService.on('server_event', listener);

    const mockOcrData = {
      phone: '919999888855@c.us',
      chatId: '919999888855@c.us',
      messageBody: 'Rx Prescription Photo',
      msgId: 'msg-test-ocr-201',
      ocrResult: {
        text: 'Rx\nAzithromycin 500mg\nTake 1 tablet daily for 3 days',
        medicineInfo: {
          potentialName: 'Azithromycin 500mg',
          dosageForm: 'Tablet',
          mrp: 120
        }
      }
    };

    handleOcrComplete(mockOcrData);

    // Wait until event fires (up to 3 seconds)
    for (let i = 0; i < 30; i++) {
      if (matchedPayload) break;
      await new Promise(r => setTimeout(r, 100));
    }

    expect(matchedPayload).not.toBeNull();
    expect(matchedPayload.medicineName).toBe('Azithromycin 500mg');
    expect(['ocr', 'both']).toContain(matchedPayload.source);

    eventService.removeListener('wa_medicine_match', listener);
  });

  test('4. WhatsApp Prescription OCR Pipeline: Correctly gates (skips) non-medicine image OCR', async () => {
    const { handleOcrComplete } = await import('../src/services/whatsappIntentService.js');
    const { eventService } = await import('../src/services/eventService.js');

    let matchedPayload: any = null;
    const listener = (event: any) => {
      if (event.type === 'wa_medicine_match') {
        matchedPayload = event.payload;
      }
    };
    eventService.on('server_event', listener);

    const mockNonMedicineOcrData = {
      phone: '919999888844@c.us',
      chatId: '919999888844@c.us',
      messageBody: 'Here is my bill receipt',
      msgId: 'msg-test-ocr-202',
      ocrResult: {
        text: 'ELECTRICITY BILL PAYMENT RECEIPT\nTotal Paid: Rs 1500\nTransaction ID: 987654321',
        medicineInfo: {
          potentialName: 'ELECTRICITY BILL PAYMENT RECEIPT'
        }
      }
    };

    handleOcrComplete(mockNonMedicineOcrData);

    await new Promise(r => setTimeout(r, 800));

    // Non-medicine photo should be skipped by V2 Scan Gate
    expect(matchedPayload).toBeNull();

    eventService.removeListener('wa_medicine_match', listener);
  });
});
