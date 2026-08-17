if (process.env.NODE_ENV === 'production' || (process.env.ALLOW_MOCK_SEED !== 'true' && process.env.NODE_ENV !== 'test')) {
  console.error('[MOCK_DATA_PROTECTION] FATAL: save_nikhil_bill is a mock seed script and is hard-blocked in production and outside test environments.');
  process.exit(1);
}

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve('data/app.db');
const db = new sqlite3.Database(dbPath);

console.log('Connecting to SQLite DB at:', dbPath);

db.serialize(() => {
  db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', ['NIKHIL PHARMA']);

  db.get('SELECT id FROM distributors WHERE name = ?', ['NIKHIL PHARMA'], (err, distRow) => {
    if (err || !distRow) {
      console.error('Distributor error:', err);
      return;
    }
    const distId = distRow.id;

    db.get('SELECT id FROM purchases WHERE distributor_id = ? AND invoice_no = ?', [distId, 'CC/18000'], (err, existing) => {
      if (existing) {
        console.log('Purchase bill CC/18000 is ALREADY SAVED! ID:', existing.id);
        return;
      }

      db.get("SELECT app_invoice_no FROM purchases WHERE app_invoice_no LIKE 'P-%' ORDER BY id DESC LIMIT 1", (err, lastPur) => {
        let nextSeq = 1;
        if (lastPur && lastPur.app_invoice_no) {
          const match = lastPur.app_invoice_no.match(/P-(\d+)/);
          if (match) nextSeq = parseInt(match[1], 10) + 1;
        }
        const appInvoiceNo = `P-${nextSeq.toString().padStart(3, '0')}`;

        const items = [
          { medicine_name: 'WYSOLONE 10 MG', manufacturer: 'PFIZER', batch_no: 'NP7611', expiry_date: '2027-11-01', qty: 1, free_qty: 0, rate: 15.61, mrp: 19.02, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'OTEK AC DROP', manufacturer: 'FDC', batch_no: '0326D270', expiry_date: '2027-06-30', qty: 2, free_qty: 0, rate: 62.74, mrp: 82.35, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'DEXONA TABLETS', manufacturer: 'ZYDUS', batch_no: 'SB00112A', expiry_date: '2029-01-01', qty: 14, free_qty: 1, rate: 5.28, mrp: 6.93, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'TELVAS 40MG', manufacturer: 'ARISTO', batch_no: 'SPC260438', expiry_date: '2028-02-01', qty: 2, free_qty: 0, rate: 72.07, mrp: 94.59, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'CROCIN PAIN RELIEF TABLET', manufacturer: 'GSK (OTC)', batch_no: 'EP25037', expiry_date: '2027-09-30', qty: 1, free_qty: 0, rate: 65.09, mrp: 82.01, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'DOLO XTRAA TAB', manufacturer: 'MICRO', batch_no: 'DLXY0004', expiry_date: '2026-11-30', qty: 1, free_qty: 0, rate: 22.80, mrp: 44.25, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'TT TETANUS BETT INJ', manufacturer: 'BIOLOGICA-E', batch_no: '223704026A', expiry_date: '2028-12-31', qty: 10, free_qty: 0, rate: 10.65, mrp: 13.31, cgst_per: 2.5, sgst_per: 2.5 },
          { medicine_name: 'T BACT OINT SMALL', manufacturer: 'GSK', batch_no: '688D', expiry_date: '2027-07-31', qty: 2, free_qty: 0, rate: 83.08, mrp: 109.04, cgst_per: 2.5, sgst_per: 2.5 }
        ];

        let subtotal = 0, totalCgst = 0, totalSgst = 0;
        items.forEach(i => {
          const base = i.qty * i.rate;
          subtotal += base;
          totalCgst += base * (i.cgst_per / 100);
          totalSgst += base * (i.sgst_per / 100);
        });
        const grandTotal = subtotal + totalCgst + totalSgst;

        db.run(
          'INSERT INTO purchases (distributor_id, invoice_no, app_invoice_no, date, total_amount, cgst_value, sgst_value, original_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [distId, 'CC/18000', appInvoiceNo, '2026-07-27', grandTotal, totalCgst, totalSgst, grandTotal],
          function (err) {
            if (err) {
              console.error('Purchase insert error:', err);
              return;
            }
            const purchaseId = this.lastID;
            console.log('✅ SUCCESSFULLY CREATED PURCHASE BILL!');
            console.log('Purchase ID:', purchaseId);
            console.log('App Invoice No:', appInvoiceNo);
            console.log('Distributor:', 'NIKHIL PHARMA');
            console.log('Invoice No:', 'CC/18000');
            console.log('Total Amount: ₹' + grandTotal.toFixed(2));

            let processed = 0;
            items.forEach(item => {
              const cleanName = item.medicine_name.trim();
              db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [cleanName], (err, medRow) => {
                const processWithMedId = (medId) => {
                  const baseAmt = item.qty * item.rate;
                  const cgstVal = baseAmt * (item.cgst_per / 100);
                  const sgstVal = baseAmt * (item.sgst_per / 100);

                  db.run(
                    `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [purchaseId, medId, item.batch_no, item.expiry_date, item.qty, item.free_qty, item.rate, item.mrp, item.cgst_per, cgstVal, item.sgst_per, sgstVal]
                  );

                  const totalQty = item.qty + item.free_qty;
                  db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, item.batch_no], (err, invRow) => {
                    if (invRow) {
                      db.run('UPDATE inventory_master SET quantity = quantity + ?, cost_price = ?, mrp = ? WHERE id = ?', [totalQty, item.rate, item.mrp, invRow.id]);
                    } else {
                      db.run('INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp) VALUES (?, ?, ?, ?, ?, ?)', [medId, totalQty, item.batch_no, item.expiry_date, item.rate, item.mrp]);
                    }

                    processed++;
                    if (processed === items.length) {
                      db.run('UPDATE emails SET is_saved = 1 WHERE uid = 16656', () => {
                        console.log('✅ Marked email UID 16656 as saved!');
                        console.log('All 8 items inserted into purchase_items & inventory_master successfully!');
                      });
                    }
                  });
                };

                if (medRow) {
                  processWithMedId(medRow.id);
                } else {
                  db.run(
                    'INSERT INTO medicines (name, manufacturer, mrp, rate, cgst_per, sgst_per) VALUES (?, ?, ?, ?, ?, ?)',
                    [cleanName, item.manufacturer, item.mrp, item.rate, item.cgst_per, item.sgst_per],
                    function (err) {
                      processWithMedId(this.lastID);
                    }
                  );
                }
              });
            });
          }
        );
      });
    });
  });
});
