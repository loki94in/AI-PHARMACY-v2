const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { createObjectCsvWriter } = require('csv-writer');
const { program } = require('commander');

program
  .version('1.0.0')
  .description('AI Pharmacy Standalone Data Extractor')
  .requiredOption('-i, --input <path>', 'Path to the legacy SQL, ZIP, or GZ backup file')
  .option('-o, --output <dir>', 'Directory to save the clean CSV files', './output_csvs')
  .parse(process.argv);

const options = program.opts();
const inputPath = path.resolve(options.input);
const outputDir = path.resolve(options.output);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`\n🚀 Starting Pharmacy Data Extractor...`);
console.log(`📥 Input File: ${inputPath}`);
console.log(`📂 Output Directory: ${outputDir}\n`);

// ─── CSV Writers ─────────────────────────────────────────────────────────────

const createWriter = (filename, headers) => {
  return createObjectCsvWriter({
    path: path.join(outputDir, filename),
    header: headers.map(h => ({ id: h, title: h }))
  });
};

const writers = {
  inventory: {
    writer: createWriter('1_inventory_master.csv', ['Medicine Name', 'Packaging', 'Batch Number', 'Expiry Date', 'Quantity', 'MRP', 'Cost Price', 'Rack Location', 'CGST %', 'SGST %', 'Barcode', 'Manufacturer']),
    records: []
  },
  purchases: {
    writer: createWriter('2_purchases.csv', ['Purchase Bill / Invoice No', 'Purchase Date', 'Distributor / Supplier Name', 'Total Bill Amount', 'Total GST Paid', 'Status', 'Bill Discounts']),
    records: []
  },
  sales: {
    writer: createWriter('3_sales.csv', ['Sales Invoice Number', 'Sale Date', 'Patient Details', 'Prescribing Doctor', 'Total Sale Amount', 'Payment Mode', 'Discount Given', 'Delivery Boy']),
    records: []
  },
  returns: {
    writer: createWriter('4_returns.csv', ['Return Invoice No', 'Date of Return', 'Type', 'Refund Amount', 'Returned to Distributor', 'Returned from Patient', 'Status']),
    records: []
  }
};

const FLUSH_LIMIT = 5000;

async function flushWriter(writerKey) {
  if (writers[writerKey].records.length > 0) {
    await writers[writerKey].writer.writeRecords(writers[writerKey].records);
    writers[writerKey].records = [];
  }
}

async function addRecord(writerKey, record) {
  writers[writerKey].records.push(record);
  if (writers[writerKey].records.length >= FLUSH_LIMIT) {
    await flushWriter(writerKey);
  }
}

// ─── Decompression & Streaming ────────────────────────────────────────────────

async function getReadStream(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Check magic bytes for GZIP (1f 8b)
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(2);
  fs.readSync(fd, buffer, 0, 2, 0);
  fs.closeSync(fd);
  
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`📦 Detected GZIP compression. Decompressing on the fly...`);
    return fs.createReadStream(filePath).pipe(zlib.createGunzip());
  }

  if (ext === '.zip') {
    console.log(`📦 Detected ZIP archive. Extracting SQL file...`);
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const sqlEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.sql'));
    if (!sqlEntry) throw new Error('No .sql file found in ZIP');
    
    const tempPath = path.join(outputDir, 'temp_extracted.sql');
    fs.writeFileSync(tempPath, sqlEntry.getData());
    return fs.createReadStream(tempPath);
  }

  console.log(`📄 Detected raw SQL file.`);
  return fs.createReadStream(filePath);
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

async function runExtraction() {
  let inStream;
  try {
    inStream = await getReadStream(inputPath);
  } catch (err) {
    console.error(`❌ Failed to read input file: ${err.message}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });

  let currentTable = null;
  let currentColumns = [];
  
  // Stats
  const stats = { inventory: 0, purchases: 0, sales: 0, returns: 0, skipped: 0 };

  console.log(`\n⏳ Parsing database dump... (this may take a few minutes)`);

  for await (const line of rl) {
    // Check if we reached the end of a COPY block
    if (currentTable && line === '\\.') {
      currentTable = null;
      currentColumns = [];
      continue;
    }

    // Check if a new COPY block starts
    if (!currentTable && line.startsWith('COPY public.')) {
      const match = line.match(/^COPY public\.(\w+) \((.*?)\) FROM stdin;/);
      if (match) {
        const tableName = match[1];
        if (['medicine', 'batch', 'inventory', 'orders', 'return_orders'].includes(tableName)) {
          currentTable = tableName;
          currentColumns = match[2].split(',').map(c => c.trim());
          console.log(`  -> Found data for: ${tableName}`);
        }
      }
      continue;
    }

    // Process data rows inside a targeted COPY block
    if (currentTable) {
      // PostgreSQL COPY default delimiter is Tab
      const values = line.split('\t').map(v => v === '\\N' ? '' : v);
      const row = {};
      currentColumns.forEach((col, idx) => {
        row[col] = values[idx];
      });

      try {
        if (currentTable === 'medicine' || currentTable === 'batch') {
          // Both go to inventory CSV for staging to map properly
          await addRecord('inventory', {
            'Medicine Name': row.medicine_name_detailed || row.medicine_name_base || '',
            'Packaging': row.medicine_packaging || '',
            'Batch Number': row.batch_number || '',
            'Expiry Date': row.batch_expiry || '',
            'Quantity': '', // App maps from stock ledger, but we prepare the column
            'MRP': row.mrp || row.selling_price || '',
            'Cost Price': row.cost_price || '',
            'Rack Location': row.rack || '',
            'CGST %': row.cgst || row.cgst_percent || '',
            'SGST %': row.sgst || row.sgst_percent || '',
            'Barcode': row.barcode || '',
            'Manufacturer': row.manufacturer_name || ''
          });
          stats.inventory++;
        } 
        else if (currentTable === 'inventory') {
          // This represents purchases in the legacy schema
          await addRecord('purchases', {
            'Purchase Bill / Invoice No': row.invoice_id || row.invoice || '',
            'Purchase Date': row.business_date || row.receive_date || '',
            'Distributor / Supplier Name': row.distributor_id || '',
            'Total Bill Amount': row.amount || '',
            'Total GST Paid': row.net_gst_value || '',
            'Status': row.status || '',
            'Bill Discounts': row.extra_discount || ''
          });
          stats.purchases++;
        }
        else if (currentTable === 'orders') {
          await addRecord('sales', {
            'Sales Invoice Number': row.invoice || '',
            'Sale Date': row.business_date || '',
            'Patient Details': row.patient_id || row.name || '',
            'Prescribing Doctor': row.doctor_id || '',
            'Total Sale Amount': row.amount || '',
            'Payment Mode': row.payment_medium || '',
            'Discount Given': row.discount || '',
            'Delivery Boy': row.delivered_by || ''
          });
          stats.sales++;
        }
        else if (currentTable === 'return_orders') {
          await addRecord('returns', {
            'Return Invoice No': row.return_order_id || row.invoice_id || '',
            'Date of Return': row.business_date || '',
            'Type': row.return_type || '',
            'Refund Amount': row.amount || '',
            'Returned to Distributor': row.distributor_id || '',
            'Returned from Patient': row.patient_id || '',
            'Status': row.status || ''
          });
          stats.returns++;
        }
      } catch (err) {
        stats.skipped++;
      }
    }
  }

  // Flush all remaining records
  await flushWriter('inventory');
  await flushWriter('purchases');
  await flushWriter('sales');
  await flushWriter('returns');

  // Clean up temp extracted file if it exists
  const tempPath = path.join(outputDir, 'temp_extracted.sql');
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  console.log(`\n✅ Extraction Complete!`);
  console.log(`📊 Summary:`);
  console.log(`   📦 Inventory/Master Items: ${stats.inventory}`);
  console.log(`   🛒 Purchase Bills:         ${stats.purchases}`);
  console.log(`   💰 Sales Invoices:         ${stats.sales}`);
  console.log(`   ↩️ Return Invoices:        ${stats.returns}`);
  console.log(`   ⚠️ Skipped Errors:         ${stats.skipped}`);
  console.log(`\n🎉 Your CSV files are ready in: ${outputDir}`);
  console.log(`   Next step: Upload these CSVs to the AI Pharmacy Migration Wizard!\n`);
}

runExtraction().catch(console.error);
