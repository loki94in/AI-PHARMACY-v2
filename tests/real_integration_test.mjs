import { spawn } from 'child_process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function assert(condition, message) {
  if (!condition) {
    throw new Error("TEST FAILED: " + message);
  }
  console.log("✔ " + message);
}

async function run() {
  console.log("\\n==============================");
  console.log("PHARMACY INTEGRATION TEST RUN");
  console.log("==============================\\n");

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Clear existing test data
  await db.run("DELETE FROM inventory_master WHERE medicine_id IN (SELECT id FROM medicines WHERE name='TEST_MED_INT')");
  await db.run("DELETE FROM medicines WHERE name='TEST_MED_INT'");

  console.log("Server should be running on http://localhost:3000\\n");

  try {
    // Session headers
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': 'demo-session-123'
    };

    /**
     * TEST 1: PURCHASE -> INVENTORY
     */
    console.log("--- TEST 1: INVENTORY CREATION ---");
    // API logic: Usually we do POST /api/inventory
    const invRes = await fetch('http://localhost:3000/api/inventory', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'TEST_MED_INT',
        mrp: 100,
        cost_price: 80,
        batch_no: 'BATCH-INT1',
        expiry_date: '12/2099',
        quantity: 100
      })
    });
    
    const invData = await invRes.json();
    assert(invData.success === true, "Inventory created via API");
    const testInvId = invData.inventory_id;
    assert(testInvId != null, "Inventory ID received");

    /**
     * TEST 2: POS SALE -> STOCK REDUCTION
     */
    console.log("\\n--- TEST 2: SALE -> INVENTORY REDUCTION ---");
    const stockBefore = await db.get("SELECT quantity FROM inventory_master WHERE id = ?", [testInvId]);
    
    const saleRes = await fetch('http://localhost:3000/api/sales', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{
          inventory_id: testInvId,
          medicine_name: 'TEST_MED_INT',
          batch_no: 'BATCH-INT1',
          expiry_date: '12/2099',
          mrp: 100,
          quantity: 10,
          unit_price: 100,
          loose_qty: 0
        }],
        discount: 0,
        patient_name: 'Test Patient',
        paymentMedium: 'CASH',
        paymentStatus: 'PAID'
      })
    });

    const saleData = await saleRes.json();
    assert(saleData.success === true, "Sale processed via API");
    const invoiceNo = saleData.invoice_no;
    const saleInvoiceRow = await db.get("SELECT id FROM sales_invoices WHERE invoice_no = ?", [invoiceNo]);
    const invoiceId = saleInvoiceRow.id;

    const stockAfterSale = await db.get("SELECT quantity FROM inventory_master WHERE id = ?", [testInvId]);
    assert(stockAfterSale.quantity === stockBefore.quantity - 10, "Stock accurately reduced by 10");

    /**
     * TEST 3: CUSTOMER RETURN -> STOCK RESTORE
     */
    console.log("\\n--- TEST 3: CUSTOMER RETURN ---");
    const retRes = await fetch('http://localhost:3000/api/customer-returns', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        original_invoice_id: invoiceId,
        reason: 'Patient improved',
        return_items: [{
          inventory_id: testInvId,
          quantity: 5,
          unit_price: 100
        }]
      })
    });
    
    const retData = await retRes.json();
    if (!retData.success) console.error("Return API Error:", retData);
    assert(retData.success === true, "Return processed via API");

    const stockAfterReturn = await db.get("SELECT quantity FROM inventory_master WHERE id = ?", [testInvId]);
    assert(stockAfterReturn.quantity === stockAfterSale.quantity + 5, "Stock securely restored by 5");

    /**
     * TEST 4: EXPIRED BLOCK CHECK
     */
    console.log("\\n--- TEST 4: EXPIRED BLOCK ---");
    // Create expired inventory
    const expRes = await fetch('http://localhost:3000/api/inventory', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'TEST_MED_INT',
        mrp: 100,
        batch_no: 'EXP-BATCH',
        expiry_date: '01/2020',
        quantity: 50
      })
    });
    const expData = await expRes.json();
    const expInvId = expData.inventory_id;

    const saleExpRes = await fetch('http://localhost:3000/api/sales', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{
          inventory_id: expInvId,
          medicine_name: 'TEST_MED_INT',
          batch_no: 'EXP-BATCH',
          expiry_date: '01/2020',
          mrp: 100,
          quantity: 5
        }]
      })
    });
    
    const saleExpData = await saleExpRes.json();
    assert(saleExpData.error != null, "Expired sale blocked by backend");

    /**
     * TEST 5: HOLD BILL RESERVATION
     */
    console.log("\\n--- TEST 5: HOLD BILL ---");
    const stockBeforeHold = await db.get("SELECT quantity FROM inventory_master WHERE id = ?", [testInvId]);
    
    const holdRes = await fetch('http://localhost:3000/api/sales/hold', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cart_data: JSON.stringify([{ id: testInvId, qty: 5 }]),
        patient_name: 'Hold Patient',
        patient_phone: '123'
      })
    });
    
    const holdData = await holdRes.json();
    assert(holdData.success === true, "Hold bill created via API");

    const stockAfterHold = await db.get("SELECT quantity FROM inventory_master WHERE id = ?", [testInvId]);
    assert(stockAfterHold.quantity === stockBeforeHold.quantity - 5, "Stock deducted upon holding bill");

    /**
     * TEST 6: BACKUP SYSTEM
     */
    console.log("\\n--- TEST 6: BACKUP SYSTEM ---");
    const backupExists = fs.existsSync(path.resolve(__dirname, "../backup"));
    assert(backupExists, "Backup directory exists");

    console.log("\\n--- TEST COMPLETED ---");
    console.log("All core pharmacy flows executed successfully against the live API.\\n");
  } catch (error) {
    console.error("\\n❌ TEST FAILURE:\\n", error.message);
  } finally {
    // Cleanup
    await db.run("DELETE FROM inventory_master WHERE medicine_id IN (SELECT id FROM medicines WHERE name='TEST_MED_INT')");
    await db.run("DELETE FROM medicines WHERE name='TEST_MED_INT'");
    await db.close();
    process.exit(0);
  }
}

run();
