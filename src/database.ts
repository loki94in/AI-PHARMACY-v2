import { dbManager } from './database/connection.js';

// Bump this number whenever you add new CREATE TABLE, ALTER TABLE, or INSERT OR IGNORE statements below.
// On normal boots where this version matches the stored version, all DDL is skipped entirely (~3-5s saved).
const CURRENT_SCHEMA_VERSION = 9;

/**
 * Ensure required SQLite tables exist.
 * Creates `medicines`, `catalog_jobs`, `processed_files`, `message_templates` and others if they are missing.
 */
export async function ensureSchema(dbPath: string) {
  const db = await dbManager.getConnection();

  // Ensure app_settings table exists for schema version tracking
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');

  // Fast-path: skip entire DDL wall if schema is already at current version
  try {
    const versionRow = await db.get("SELECT value FROM app_settings WHERE key = 'schema_version'");
    if (versionRow && parseInt(versionRow.value, 10) >= CURRENT_SCHEMA_VERSION) {
      console.log(`[Boot] Schema v${CURRENT_SCHEMA_VERSION} already applied, skipping DDL (fast boot).`);
      return;
    }
  } catch (_) {
    // Should not happen now that app_settings is explicitly created above
  }

  console.log(`[Boot] Applying schema v${CURRENT_SCHEMA_VERSION}...`);

  // We have removed the strict CHECK constraint on catalog_jobs table.
  // We'll rely on TypeScript for enum enforcement to prevent future SQLite crashes when new statuses are introduced.
  try {
    const tableSql = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_jobs'");
    if (tableSql && tableSql.sql.includes('CHECK(status IN')) {
      console.log('Removing strict CHECK constraint from catalog_jobs...');
      await db.run("DROP TABLE IF EXISTS catalog_jobs");
    }
  } catch (err) {
    console.warn('Failed removing CHECK constraint:', err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_reference TEXT
    );
    CREATE TABLE IF NOT EXISTS catalog_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS processed_files (
      file_path TEXT PRIMARY KEY,
      last_processed DATETIME
    );
    CREATE TABLE IF NOT EXISTS distributors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact TEXT
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      invoice_no TEXT,
      app_invoice_no TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_amount REAL,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );
    CREATE TABLE IF NOT EXISTS message_templates (
      locale TEXT NOT NULL,
      key    TEXT NOT NULL,
      value  TEXT NOT NULL,
      PRIMARY KEY (locale, key)
    );
    CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines (name);
    CREATE INDEX IF NOT EXISTS idx_medicines_api_ref ON medicines (api_reference);
    CREATE INDEX IF NOT EXISTS idx_catalog_jobs_status ON catalog_jobs (status);
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (date);


    -- Reference dataset for composition auto-enrichment
    CREATE TABLE IF NOT EXISTS medicine_reference (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      composition1 TEXT,
      composition2 TEXT,
      manufacturer TEXT,
      UNIQUE(name)
    );
    CREATE INDEX IF NOT EXISTS idx_medicine_reference_name ON medicine_reference (name);

    CREATE TABLE IF NOT EXISTS api_substances (
      api TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_api_substances_api ON api_substances (api);

    -- Agent A: Core Business & Inventory Schemas
    CREATE TABLE IF NOT EXISTS inventory_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER,
      quantity INTEGER DEFAULT 0,
      loose_quantity INTEGER DEFAULT 0,
      rack_location TEXT,
      batch_no TEXT,
      expiry_date DATETIME,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_master_medicine_id ON inventory_master (medicine_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_master_batch_no ON inventory_master (batch_no);
    CREATE INDEX IF NOT EXISTS idx_inventory_master_search_filter ON inventory_master (quantity, expiry_date, medicine_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_master_med_qty_exp ON inventory_master (medicine_id, quantity, expiry_date);
    CREATE TABLE IF NOT EXISTS sales_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      customer_id INTEGER,
      doctor_id INTEGER,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_amount REAL,
      tax_amount REAL
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      inventory_id INTEGER,
      quantity INTEGER,
      unit_price REAL,
      FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
      FOREIGN KEY(inventory_id) REFERENCES inventory_master(id)
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_no TEXT UNIQUE,
      original_invoice_id INTEGER,
      distributor_id INTEGER,
      type TEXT CHECK(type IN ('sale', 'purchase')),
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_amount REAL,
      raw_return_type TEXT
    );

    -- Agent B: CRM, Communication, & Utilities Schemas
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS delivery_boys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp_number TEXT,
      telegram_chat_id TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS patient_refills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      refill_interval_days INTEGER DEFAULT 30,
      last_refill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      next_refill_date DATETIME,
      status TEXT CHECK(status IN ('pending', 'notified')) DEFAULT 'pending',
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );
    CREATE TABLE IF NOT EXISTS held_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_label TEXT,
      patient_name TEXT,
      patient_phone TEXT,
      doctor_name TEXT,
      discount REAL DEFAULT 0,
      remarks TEXT,
      cart_data TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ocr_corrections (
      ocr TEXT PRIMARY KEY,
      correct TEXT NOT NULL,
      count INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ocr_audit_queue (
      id TEXT PRIMARY KEY,
      image_path TEXT NOT NULL,
      raw_ocr_text TEXT,
      cloud_suggested_text TEXT,
      status TEXT CHECK(status IN ('pending_human_review', 'reviewed')) DEFAULT 'pending_human_review',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id ON sales_invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_doctor_id ON sales_invoices (doctor_id);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices (date);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_doctor_date ON sales_invoices (doctor_id, date);
    CREATE INDEX IF NOT EXISTS idx_sale_items_invoice_id ON sale_items (invoice_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_inventory_id ON sale_items (inventory_id);
    CREATE INDEX IF NOT EXISTS idx_returns_distributor_id ON returns (distributor_id);
    CREATE INDEX IF NOT EXISTS idx_returns_date ON returns (date);
    CREATE INDEX IF NOT EXISTS idx_purchases_distributor_id ON purchases (distributor_id);
    CREATE INDEX IF NOT EXISTS idx_patient_refills_status_date ON patient_refills (status, next_refill_date);
  `);

  // Safely add new columns to existing tables (SQLite throws if column exists — we catch and ignore)
  const alterStatements = [
    `ALTER TABLE inventory_master ADD COLUMN unit_price REAL DEFAULT 0`,
    `ALTER TABLE inventory_master ADD COLUMN cost_price REAL DEFAULT 0`,
    `ALTER TABLE inventory_master ADD COLUMN reorder_level INTEGER DEFAULT 10`,
    `ALTER TABLE inventory_master ADD COLUMN mrp REAL DEFAULT 0`,
    `ALTER TABLE inventory_master ADD COLUMN legacy_batch_id TEXT`,
    `ALTER TABLE inventory_master ADD COLUMN loose_quantity INTEGER DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN mrp REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN hsn_code TEXT`,
    `ALTER TABLE medicines ADD COLUMN schedule_type TEXT DEFAULT 'None'`,
    `ALTER TABLE medicines ADD COLUMN manufacturer TEXT`,
    `ALTER TABLE medicines ADD COLUMN category TEXT`,
    `ALTER TABLE medicines ADD COLUMN marketed_by TEXT`,
    `ALTER TABLE medicines ADD COLUMN manufactured_by TEXT`,
    `ALTER TABLE medicines ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE medicines ADD COLUMN packaging TEXT`,
    `ALTER TABLE medicines ADD COLUMN strength TEXT`,
    `ALTER TABLE medicines ADD COLUMN item_type TEXT`,
    `ALTER TABLE medicines ADD COLUMN cgst REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN sgst REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN igst REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN rack TEXT`,
    `ALTER TABLE medicines ADD COLUMN generic_name TEXT`,
    `ALTER TABLE medicines ADD COLUMN pack_unit TEXT`,
    `ALTER TABLE medicines ADD COLUMN cgst_per REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN sgst_per REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN item_code TEXT`,
    `ALTER TABLE medicines ADD COLUMN metadata TEXT`,
    // Purchases extra columns
    `ALTER TABLE purchases ADD COLUMN cgst_value REAL DEFAULT 0`,
    `ALTER TABLE purchases ADD COLUMN sgst_value REAL DEFAULT 0`,
    `ALTER TABLE purchases ADD COLUMN igst_value REAL DEFAULT 0`,
    `ALTER TABLE purchases ADD COLUMN roff REAL DEFAULT 0`,
    `ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'PUBLISHED'`,
    `ALTER TABLE purchases ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE purchases ADD COLUMN business_date DATETIME`,
    `ALTER TABLE purchases ADD COLUMN app_invoice_no TEXT`,
    `ALTER TABLE purchases ADD COLUMN cn_amount REAL DEFAULT 0`,
    `ALTER TABLE purchases ADD COLUMN cn_number TEXT DEFAULT NULL`,
    `ALTER TABLE purchases ADD COLUMN original_amount REAL DEFAULT NULL`,
    // Sales invoices extra columns
    `ALTER TABLE sales_invoices ADD COLUMN doctor_id INTEGER`,
    `ALTER TABLE sales_invoices ADD COLUMN payment_medium TEXT`,
    `ALTER TABLE sales_invoices ADD COLUMN roff REAL DEFAULT 0`,
    `ALTER TABLE sales_invoices ADD COLUMN cgst_value REAL DEFAULT 0`,
    `ALTER TABLE sales_invoices ADD COLUMN sgst_value REAL DEFAULT 0`,
    `ALTER TABLE sales_invoices ADD COLUMN igst_value REAL DEFAULT 0`,
    `ALTER TABLE sales_invoices ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE sales_invoices ADD COLUMN business_date DATETIME`,
    `ALTER TABLE sales_invoices ADD COLUMN discount REAL DEFAULT 0`,
    `ALTER TABLE sales_invoices ADD COLUMN subtotal REAL DEFAULT 0`,
    // Sale items extra columns
    `ALTER TABLE sale_items ADD COLUMN mrp REAL`,
    `ALTER TABLE sale_items ADD COLUMN batch_no TEXT`,
    `ALTER TABLE sale_items ADD COLUMN cgst_value REAL DEFAULT 0`,
    `ALTER TABLE sale_items ADD COLUMN sgst_value REAL DEFAULT 0`,
    `ALTER TABLE sale_items ADD COLUMN discount_per REAL DEFAULT 0`,
    `ALTER TABLE sale_items ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE sale_items ADD COLUMN loose_qty INTEGER DEFAULT 0`,
    // Returns extra columns
    `ALTER TABLE returns ADD COLUMN cgst_value REAL DEFAULT 0`,
    `ALTER TABLE returns ADD COLUMN sgst_value REAL DEFAULT 0`,
    `ALTER TABLE returns ADD COLUMN igst_value REAL DEFAULT 0`,
    `ALTER TABLE returns ADD COLUMN distributor_id INTEGER`,
    `ALTER TABLE returns ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE returns ADD COLUMN reason TEXT`,
    `ALTER TABLE returns ADD COLUMN return_invoice_id TEXT DEFAULT NULL`,
    `ALTER TABLE returns ADD COLUMN return_sub_type TEXT CHECK(return_sub_type IN ('expiry', 'good')) DEFAULT 'good'`,
    `ALTER TABLE returns ADD COLUMN return_date_time DATETIME DEFAULT NULL`,
    `ALTER TABLE returns ADD COLUMN raw_return_type TEXT`,
    // Distributors extra columns
    `ALTER TABLE distributors ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE distributors ADD COLUMN gstin TEXT`,
    `ALTER TABLE distributors ADD COLUMN address TEXT`,
    `ALTER TABLE distributors ADD COLUMN city TEXT`,
    `ALTER TABLE distributors ADD COLUMN email TEXT`,
    `ALTER TABLE distributors ADD COLUMN dl_no TEXT`,
    `ALTER TABLE distributors ADD COLUMN phone TEXT`,
    `ALTER TABLE distributors ADD COLUMN state_code TEXT`,
    `ALTER TABLE doctors ADD COLUMN send_daily_summary INTEGER DEFAULT 0`,
    // Customers extra columns
    `ALTER TABLE customers ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE customers ADD COLUMN age TEXT`,
    `ALTER TABLE customers ADD COLUMN gender TEXT`,
    `ALTER TABLE customers ADD COLUMN credit_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN credit_balance REAL DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN created_at DATETIME`,
    `UPDATE customers SET created_at = datetime('now') WHERE created_at IS NULL`,
    `ALTER TABLE sales_invoices ADD COLUMN payment_status TEXT DEFAULT 'PAID'`,
    `ALTER TABLE sales_invoices ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE patient_refills ADD COLUMN hold_for_stock INTEGER DEFAULT 0`,
    `ALTER TABLE patient_refills ADD COLUMN is_active INTEGER DEFAULT 1`,
    `ALTER TABLE patient_refills ADD COLUMN is_ready INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN extracted_data TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN original_filename TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN total_count INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN existing_count INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN new_count INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN duplicate_count INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN progress INTEGER DEFAULT 0`,
    `ALTER TABLE catalog_jobs ADD COLUMN error_log TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN mapping_config TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN data_filters TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN processed_count INTEGER DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN schedule_type TEXT`,
    `ALTER TABLE held_bills ADD COLUMN invoice_no TEXT`,
    `ALTER TABLE held_bills ADD COLUMN temp_label TEXT`,
    `ALTER TABLE held_bills ADD COLUMN patient_name TEXT`,
    `ALTER TABLE held_bills ADD COLUMN patient_phone TEXT`,
    `ALTER TABLE held_bills ADD COLUMN doctor_name TEXT`,
    `ALTER TABLE held_bills ADD COLUMN discount REAL DEFAULT 0`,
    `ALTER TABLE held_bills ADD COLUMN remarks TEXT`,
    `ALTER TABLE held_bills ADD COLUMN cart_data TEXT`,
    `ALTER TABLE held_bills ADD COLUMN data TEXT`,
    `ALTER TABLE held_bills ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE held_bills ADD COLUMN date DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE medicines ADD COLUMN enrichment_status TEXT DEFAULT NULL`,
    `ALTER TABLE medicines ADD COLUMN enrichment_confidence REAL DEFAULT NULL`,
    `ALTER TABLE push_tokens ADD COLUMN last_seen DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE catalog_jobs ADD COLUMN matched_previous_job_id INTEGER DEFAULT NULL`,
    `ALTER TABLE catalog_jobs ADD COLUMN newly_detected_columns TEXT DEFAULT NULL`,
    `ALTER TABLE return_items ADD COLUMN expiry_date DATETIME`,
    `ALTER TABLE emails ADD COLUMN medicine_names TEXT`,
    `ALTER TABLE emails ADD COLUMN extracted_invoice_no TEXT`,
    `ALTER TABLE emails ADD COLUMN extracted_distributor TEXT`,
    // Refill automation updates
    `ALTER TABLE patient_refills ADD COLUMN acknowledged INTEGER DEFAULT 0`,
    `ALTER TABLE patient_refills ADD COLUMN ordering_triggered INTEGER DEFAULT 0`,
    `ALTER TABLE patient_refills ADD COLUMN quick_bill_id INTEGER DEFAULT NULL`,
    `ALTER TABLE special_orders ADD COLUMN source_refill_id INTEGER DEFAULT NULL`,
    `ALTER TABLE special_orders ADD COLUMN source TEXT`,
    `ALTER TABLE automation_notifications ADD COLUMN needs_confirmation INTEGER DEFAULT 0`,
    `ALTER TABLE automation_notifications ADD COLUMN lifecycle_status TEXT DEFAULT 'sent'`,
    `ALTER TABLE stock_ledger ADD COLUMN loose_quantity INTEGER DEFAULT 0`,
    `ALTER TABLE patient_refills ADD COLUMN stock_verified_override INTEGER DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN pack_size INTEGER`,
    `ALTER TABLE whatsapp_chats ADD COLUMN resolved_number TEXT`,
    `ALTER TABLE staged_medicine_reviews ADD COLUMN source TEXT`,
    `ALTER TABLE medicines ADD COLUMN source TEXT DEFAULT 'manual'`,
    `ALTER TABLE medicines ADD COLUMN possible_duplicate_of INTEGER DEFAULT NULL`,
    `ALTER TABLE staged_medicine_reviews ADD COLUMN possible_duplicate_of INTEGER DEFAULT NULL`,
  ];
  for (const stmt of alterStatements) {
    try {
      await db.run(stmt);
    } catch (_e) {
      // Column already exists — safe to ignore
    }
  }

  // Create index on medicines (item_code) after columns are added
  try {
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_item_code ON medicines (item_code);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_master_quantity ON inventory_master (quantity);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_master_expiry ON inventory_master (expiry_date);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_generic_name ON medicines (generic_name);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_manufacturer ON medicines (manufacturer);');
  } catch (err) {
    console.warn('Failed to create index idx_medicines_item_code or custom optimization indexes:', err);
  }

  // New tables needed by various routes
  await db.exec(`
    CREATE TABLE IF NOT EXISTS staged_medicine_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      medicine_name TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      original_row_data TEXT,
      search_query TEXT,
      screenshot_path TEXT,
      raw_ocr_text TEXT,
      extracted_json TEXT,
      approved_json TEXT,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_staged_reviews_job_id ON staged_medicine_reviews (job_id);
    CREATE INDEX IF NOT EXISTS idx_staged_reviews_status ON staged_medicine_reviews (status);

    CREATE TABLE IF NOT EXISTS google_search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS automation_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      recipient_name TEXT,
      recipient_phone TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reference_id TEXT,
      needs_confirmation INTEGER DEFAULT 0,
      lifecycle_status TEXT DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS staged_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT,
      patient_phone TEXT,
      discount REAL DEFAULT 0,
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      items_json TEXT,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS staged_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_name TEXT,
      invoice_no TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_amount REAL,
      items_json TEXT,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS medicine_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias_name TEXT NOT NULL UNIQUE,
      medicine_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS catalog_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_headers TEXT UNIQUE,
      mapping_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS auto_generate_item_code
    AFTER INSERT ON medicines
    FOR EACH ROW
    WHEN NEW.item_code IS NULL
    BEGIN
      UPDATE medicines SET item_code = 'SKU-' || (10000 + NEW.id) WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customers_created_at
    AFTER INSERT ON customers
    FOR EACH ROW
    WHEN NEW.created_at IS NULL
    BEGIN
      UPDATE customers SET created_at = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      degree TEXT,
      reg_no TEXT,
      hospital TEXT,
      phone TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      legacy_id TEXT,
      speciality TEXT,
      send_daily_summary INTEGER DEFAULT 0
    );


    CREATE TABLE IF NOT EXISTS compliance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      drug_name TEXT,
      patient_name TEXT,
      doctor_name TEXT,
      license_no TEXT,
      qty INTEGER,
      bill_no TEXT,
      schedule_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Migration: Purchase line items
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER,
      medicine_id INTEGER,
      batch_no TEXT,
      expiry_date DATETIME,
      quantity INTEGER,
      free_qty INTEGER DEFAULT 0,
      cost_price REAL,
      mrp REAL,
      hsn_code TEXT,
      cgst_per REAL DEFAULT 0,
      cgst_value REAL DEFAULT 0,
      sgst_per REAL DEFAULT 0,
      sgst_value REAL DEFAULT 0,
      igst_per REAL DEFAULT 0,
      igst_value REAL DEFAULT 0,
      scheme_per REAL DEFAULT 0,
      scheme_value REAL DEFAULT 0,
      cd_value REAL DEFAULT 0,
      legacy_id TEXT,
      FOREIGN KEY(purchase_id) REFERENCES purchases(id),
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_items_medicine_id ON purchase_items (medicine_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id);

    -- Migration: Return line items
    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER,
      medicine_id INTEGER,
      batch_no TEXT,
      quantity INTEGER,
      cost_price REAL,
      mrp REAL,
      total_price REAL,
      cgst_value REAL DEFAULT 0,
      sgst_value REAL DEFAULT 0,
      igst_value REAL DEFAULT 0,
      legacy_id TEXT,
      expiry_date DATETIME,
      FOREIGN KEY(return_id) REFERENCES returns(id),
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );

    -- Migration: Stock movement audit trail
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER,
      batch_no TEXT,
      quantity INTEGER,
      loose_quantity INTEGER DEFAULT 0,
      transaction_type TEXT,
      transaction_id TEXT,
      business_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_ledger_med_batch ON stock_ledger (medicine_id, batch_no);
    -- App Settings table
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS processed_emails (
      uid INTEGER PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Persistent local email store (offline-first inbox)
    CREATE TABLE IF NOT EXISTS emails (
      uid             INTEGER PRIMARY KEY,
      from_addr       TEXT,
      subject         TEXT,
      body            TEXT,
      date            DATETIME,
      is_seen         INTEGER DEFAULT 0,
      is_order        INTEGER DEFAULT 0,
      is_saved        INTEGER DEFAULT 0,
      distributor_name TEXT,
      has_attachments INTEGER DEFAULT 0,
      synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      medicine_names  TEXT,
      extracted_invoice_no TEXT,
      extracted_distributor TEXT
    );

    -- Attachment records per email UID (offline-first)
    CREATE TABLE IF NOT EXISTS email_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      uid          INTEGER NOT NULL,
      filename     TEXT NOT NULL,
      size         INTEGER DEFAULT 0,
      content_type TEXT,
      local_path   TEXT,
      FOREIGN KEY(uid) REFERENCES emails(uid)
    );

    -- Resilient WhatsApp transmission queue
    CREATE TABLE IF NOT EXISTS pending_whatsapp_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      recipient_phone TEXT,
      pdf_path TEXT,
      caption TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      retries INTEGER DEFAULT 0
    );

    -- Expiry returns tracking and credit notes reconciliation
    CREATE TABLE IF NOT EXISTS expiry_returns_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER,
      distributor_id INTEGER,
      return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      original_amount REAL,
      loss_percentage REAL DEFAULT 3.0,
      expected_credit_amount REAL,
      reminder_date DATETIME,
      status TEXT CHECK(status IN ('pending', 'reconciled', 'overdue')) DEFAULT 'pending',
      actual_credit_amount REAL DEFAULT 0,
      reconciled_date DATETIME,
      reconciled_purchase_id INTEGER,
      FOREIGN KEY(return_id) REFERENCES returns(id),
      FOREIGN KEY(distributor_id) REFERENCES distributors(id),
      FOREIGN KEY(reconciled_purchase_id) REFERENCES purchases(id)
    );

    -- Dispatch delivery orders (home delivery management)
    CREATE TABLE IF NOT EXISTS dispatch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT,
      address TEXT,
      items TEXT,
      notes TEXT,
      delivery_boy_id INTEGER,
      invoice_no TEXT,
      status TEXT CHECK(status IN ('Pending','In Transit','Delivered')) DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      FOREIGN KEY(delivery_boy_id) REFERENCES delivery_boys(id)
    );

    -- AI-Assisted Document Understanding Learning Profiles
    CREATE TABLE IF NOT EXISTS distributor_learning_profiles (
      distributor_id INTEGER PRIMARY KEY,
      file_mapping_rules TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );

    -- AI-Assisted Document Understanding Historical Files Memory
    CREATE TABLE IF NOT EXISTS distributor_historical_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      filename TEXT,
      file_path TEXT,
      file_type TEXT,
      file_headers TEXT,
      mapping_config TEXT,
      extracted_data TEXT,
      status TEXT DEFAULT 'success',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );

    -- Push Notification Registered Tokens Registry
    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      device_name TEXT,
      os TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Device Connection Activity Logs
    CREATE TABLE IF NOT EXISTS device_connection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT,
      device_name TEXT,
      os TEXT,
      status TEXT CHECK(status IN ('connected', 'disconnected')),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Assistant Chat session logs
    CREATE TABLE IF NOT EXISTS assistant_chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      device_name TEXT,
      sender TEXT CHECK(sender IN ('user', 'assistant')),
      message_text TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- WhatsApp local chat cache
    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      unread_count INTEGER DEFAULT 0,
      timestamp INTEGER,
      last_message TEXT,
      is_group INTEGER DEFAULT 0,
      resolved_number TEXT
    );

    -- WhatsApp local messages cache
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      body TEXT,
      from_me INTEGER,
      timestamp INTEGER,
      type TEXT,
      has_media INTEGER DEFAULT 0,
      FOREIGN KEY(chat_id) REFERENCES whatsapp_chats(id)
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_id ON whatsapp_messages (chat_id);

    -- Crash telemetry: written by processGuardian on uncaught exceptions
    CREATE TABLE IF NOT EXISTS crash_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      message TEXT,
      stack TEXT,
      app_version TEXT,
      recovered INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS migration_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS migration_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      module_type TEXT NOT NULL,
      mappings TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS migration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      backup_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES migration_projects(id)
    );

    CREATE TABLE IF NOT EXISTS migration_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      module_type TEXT,
      raw_imported_data TEXT,
      matching_record_id INTEGER,
      conflict_reason TEXT,
      status TEXT DEFAULT 'pending'
    );

    -- Distributor payments (cash, cheque, UPI paid to distributors)
    CREATE TABLE IF NOT EXISTS distributor_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      amount REAL DEFAULT 0,
      payment_type TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      cheque_no TEXT,
      cheque_bank TEXT,
      cheque_date DATETIME,
      upi_id TEXT,
      legacy_id TEXT,
      business_date DATETIME,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );

    -- Payment ↔ Purchase invoice line items
    CREATE TABLE IF NOT EXISTS distributor_payment_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      purchase_id INTEGER,
      amount REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      legacy_id TEXT,
      business_date DATETIME,
      FOREIGN KEY(payment_id) REFERENCES distributor_payments(id),
      FOREIGN KEY(purchase_id) REFERENCES purchases(id)
    );

    -- Credit tracking on sales invoices
    CREATE TABLE IF NOT EXISTS order_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_invoice_id INTEGER,
      amount_paid REAL DEFAULT 0,
      legacy_id TEXT,
      FOREIGN KEY(sales_invoice_id) REFERENCES sales_invoices(id)
    );

    -- Purchase orders sent to distributors
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      status TEXT DEFAULT 'DRAFT',
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      legacy_id TEXT,
      business_date DATETIME,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );

    -- Purchase order line items
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER,
      medicine_id INTEGER,
      quantity INTEGER DEFAULT 0,
      free_qty INTEGER DEFAULT 0,
      cost_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      legacy_id TEXT,
      FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );

    -- B2B sales invoices (wholesale/institutional)
    CREATE TABLE IF NOT EXISTS b2b_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT,
      customer_id INTEGER,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_amount REAL DEFAULT 0,
      cgst_value REAL DEFAULT 0,
      sgst_value REAL DEFAULT 0,
      igst_value REAL DEFAULT 0,
      roff REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      payment_medium TEXT,
      legacy_id TEXT,
      business_date DATETIME,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    -- B2B sale line items
    CREATE TABLE IF NOT EXISTS b2b_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      medicine_id INTEGER,
      batch_no TEXT,
      quantity INTEGER DEFAULT 0,
      mrp REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      cgst_value REAL DEFAULT 0,
      sgst_value REAL DEFAULT 0,
      discount_per REAL DEFAULT 0,
      legacy_id TEXT,
      FOREIGN KEY(invoice_id) REFERENCES b2b_invoices(id),
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );

    -- Pharmarack cart snapshots for auto-notifier state diffing
    CREATE TABLE IF NOT EXISTS pharmarack_cart_snapshots (
      store_id INTEGER PRIMARY KEY,
      store_name TEXT,
      items_json TEXT,
      delivery_persons_json TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Unified Engine: Stock configuration per medicine
    CREATE TABLE IF NOT EXISTS stock_config (
      medicine_id INTEGER PRIMARY KEY,
      avg_daily_sales REAL DEFAULT 0,
      lead_time_days INTEGER DEFAULT 7,
      safety_factor REAL DEFAULT 1.5,
      min_stock_level INTEGER DEFAULT 0,
      max_stock_level INTEGER DEFAULT 0,
      reorder_level INTEGER DEFAULT 0,
      category_fallback TEXT,
      last_calculated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_config_avg_sales ON stock_config (avg_daily_sales);

    -- Unified Engine: Pre-computed substitute relationships
    CREATE TABLE IF NOT EXISTS substitutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_medicine_id INTEGER NOT NULL,
      substitute_medicine_id INTEGER NOT NULL,
      match_type TEXT NOT NULL CHECK(match_type IN ('composition', 'category', 'fuzzy', 'manual')),
      confidence REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified DATETIME DEFAULT CURRENT_TIMESTAMP,
      verification_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY(source_medicine_id) REFERENCES medicines(id),
      FOREIGN KEY(substitute_medicine_id) REFERENCES medicines(id),
      UNIQUE(source_medicine_id, substitute_medicine_id, match_type)
    );
    CREATE INDEX IF NOT EXISTS idx_substitutes_source ON substitutes (source_medicine_id);
    CREATE INDEX IF NOT EXISTS idx_substitutes_type ON substitutes (match_type);
    CREATE INDEX IF NOT EXISTS idx_substitutes_confidence ON substitutes (confidence DESC);

    -- Unified Engine: Pharmacist correction learning
    CREATE TABLE IF NOT EXISTS pharmacist_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_query TEXT NOT NULL,
      corrected_medicine_id INTEGER NOT NULL,
      context TEXT,
      count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(corrected_medicine_id) REFERENCES medicines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_query ON pharmacist_corrections (original_query);

    -- Sales bill edit history for backup and audit logs
    CREATE TABLE IF NOT EXISTS sales_bill_edit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      invoice_no TEXT NOT NULL,
      original_data TEXT NOT NULL,
      updated_data TEXT NOT NULL,
      edited_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sales_bill_edit_hist_inv ON sales_bill_edit_history (invoice_id);

    -- WhatsApp OCR Pipeline: Admin-managed ignored numbers
    CREATE TABLE IF NOT EXISTS ignored_whatsapp_numbers (
      phone TEXT PRIMARY KEY,
      reason TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- WhatsApp OCR Pipeline: Prevents re-scanning the same image
    CREATE TABLE IF NOT EXISTS scanned_messages (
      msg_id TEXT PRIMARY KEY,
      chat_id TEXT,
      result_json TEXT,
      scanned_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_scanned_msg ON scanned_messages (msg_id);

    -- WhatsApp OCR Pipeline: Offline Pharmarack distributor catalog cache
    CREATE TABLE IF NOT EXISTS distributor_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER,
      store_name TEXT,
      product_name TEXT,
      mrp REAL,
      packaging TEXT,
      dosage_form TEXT,
      manufacturer TEXT,
      salt TEXT,
      strength TEXT,
      distributor_price REAL,
      availability TEXT,
      is_mapped INTEGER DEFAULT 1,
      last_synced TEXT,
      UNIQUE(store_id, product_name)
    );
    CREATE INDEX IF NOT EXISTS idx_dist_catalog_name ON distributor_catalog (product_name);
    CREATE INDEX IF NOT EXISTS idx_dist_catalog_form ON distributor_catalog (dosage_form);

    CREATE TABLE IF NOT EXISTS wa_admin_escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT,
      customer_phone TEXT,
      medicine_key TEXT NOT NULL,
      outcome TEXT NOT NULL,
      review_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wa_admin_esc_msg ON wa_admin_escalations (msg_id, medicine_key);
    CREATE INDEX IF NOT EXISTS idx_wa_admin_esc_phone ON wa_admin_escalations (customer_phone, medicine_key, created_at);
  `);

  // FTS5 trigram index for fast fuzzy medicine name search (separate exec — virtual tables can't be inside multi-statement exec)
  try {
    await db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fts USING fts5(name, content='medicines', content_rowid='id', tokenize='trigram')`);
  } catch (ftsErr) {
    console.warn('[Schema] FTS5 trigram table creation skipped (may already exist):', (ftsErr as any).message);
  }

  // FTS5 sync triggers — keep medicines_fts in sync with medicines table
  try {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS medicines_ai AFTER INSERT ON medicines BEGIN
        INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
      END;
      CREATE TRIGGER IF NOT EXISTS medicines_ad AFTER DELETE ON medicines BEGIN
        INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
      END;
      CREATE TRIGGER IF NOT EXISTS medicines_au AFTER UPDATE ON medicines BEGIN
        INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
        INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
      END;
    `);
  } catch (triggerErr) {
    console.warn('[Schema] FTS5 triggers may already exist:', (triggerErr as any).message);
  }

  // One-time FTS5 backfill — populate from existing medicines rows
  try {
    const ftsCount = await db.get('SELECT COUNT(*) as cnt FROM medicines_fts');
    if (!ftsCount || ftsCount.cnt === 0) {
      const medCount = await db.get('SELECT COUNT(*) as cnt FROM medicines');
      if (medCount && medCount.cnt > 0) {
        await db.exec('INSERT INTO medicines_fts(rowid, name) SELECT id, name FROM medicines');
        console.log(`[Schema] FTS5 backfill: indexed ${medCount.cnt} medicine names.`);
      }
    }
  } catch (backfillErr) {
    console.warn('[Schema] FTS5 backfill skipped:', (backfillErr as any).message);
  }

  // Insert default settings if they don't exist
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('medical_name', 'XYZ MEDICAL')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('gmail_user', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('gmail_pass', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('imap_host', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('imap_port', '993')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('imap_tls', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('login_password', 'admin123')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('master_password', 'master999')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('connection_mode', 'hybrid')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('bluetooth_com_port', 'COM1')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('email_autodelete_enabled', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('email_autodelete_limit', '10')");
  
  // Telegram Bot settings defaults
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('telegram_enabled', 'false')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('telegram_token', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('telegram_chat_id', '')");
  
  // Remote Admin Operations Defaults
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_remote_mode', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_username', 'admin')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_password', 'admin123')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_unique_key', 'KEY-ADM-837261')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_authorized_device_id', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_authorized_device_name', '')");

  // Backup System Default Settings
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_auto_enabled', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_local_enabled', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_gdrive_enabled', 'false')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_telegram_enabled', 'false')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_startup_restore_check', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_daily_compression', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_notifications_enabled', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_auto_delete_old_archives', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_manual_access', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_is_paused', 'false')");

  // Self-healing boot tracking
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('last_clean_shutdown', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('app_version', 'unknown')");

  // WhatsApp Business API defaults
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_business_enabled', 'false')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_business_phone_number_id', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_business_access_token', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_business_waba_id', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_business_webhook_verify_token', '')");

  // WhatsApp Admin Auto-Escalation defaults
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_whatsapp', '')");

  // Safely add legacy_id/speciality to doctors if the table already existed without them
  const doctorAlters = [
    `ALTER TABLE doctors ADD COLUMN legacy_id TEXT`,
    `ALTER TABLE doctors ADD COLUMN speciality TEXT`,
  ];
  for (const stmt of doctorAlters) {
    try { await db.run(stmt); } catch (_e) { /* already exists */ }
  }

  // Run background migration to populate medicine_names for existing emails
  if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
    try {
      (async () => {
        const dbPathLocal = dbPath;
        // Wait a bit to let the main boot complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        const { open } = await import('sqlite');
        const { default: sqlite3 } = await import('sqlite3');
        const backgroundDb = await open({ filename: dbPathLocal, driver: sqlite3.Database });
        try {
          const unpopulated = await backgroundDb.all('SELECT uid, subject, body, from_addr FROM emails WHERE is_order = 1 AND medicine_names IS NULL');
          if (unpopulated.length > 0) {
            console.log(`[Database Migration] Populating medicine names for ${unpopulated.length} emails in background...`);
            const { emailService } = await import('./services/emailService.js');
            const fs = await import('fs');
            for (const email of unpopulated) {
              try {
                const attachments = await backgroundDb.all('SELECT local_path, filename FROM email_attachments WHERE uid = ?', [email.uid]);
                const parsedItems = [];
                for (const att of attachments) {
                  if (att.local_path && fs.existsSync(att.local_path)) {
                    try {
                      const resParse = await emailService.parseAndImportAttachment(att.local_path, false);
                      if (resParse && resParse.success && resParse.items) {
                        parsedItems.push(...resParse.items);
                      }
                    } catch (pe) {
                      // Ignore parsing error for this attachment
                    }
                  }
                }
                if (parsedItems.length === 0) {
                  const orderInfo = emailService.extractOrderInfo({
                    subject: email.subject || '',
                    body: email.body || '',
                    from: email.from_addr || '',
                    attachments: []
                  });
                  for (const med of orderInfo.medicines) {
                    parsedItems.push({ name: med.name });
                  }
                }
                const medNames = Array.from(new Set(parsedItems.map(i => i.name).filter(Boolean)));
                await backgroundDb.run('UPDATE emails SET medicine_names = ? WHERE uid = ?', [JSON.stringify(medNames), email.uid]);
              } catch (err) {
                console.error(`[Database Migration] Failed to populate medicine names for email ${email.uid}:`, err);
              }
            }
            console.log('[Database Migration] Background medicine name population completed.');
          }
        } catch (err) {
          console.warn('[Database Migration] Failed in background query:', err);
        } finally {
          await backgroundDb.close();
        }
      })();
    } catch (err) {
      console.warn('[Database Migration] Failed to initialize background runner:', err);
    }
  }

  // Healing database for sales_invoices with missing subtotal/discount values (e.g. legacy/imported sales)
  try {
    console.log('[Database Healing] Checking sales_invoices subtotals and discounts...');
    const subtotalResult = await db.run(`
      UPDATE sales_invoices
      SET subtotal = COALESCE(NULLIF(
        (
          SELECT COALESCE(SUM(
            (si.quantity * (si.unit_price * (1 - COALESCE(si.discount_per, 0) / 100))) +
            (si.loose_qty * ((si.unit_price * (1 - COALESCE(si.discount_per, 0) / 100)) / COALESCE(m.pack_size, 10)))
          ), 0)
          FROM sale_items si
          JOIN inventory_master im ON si.inventory_id = im.id
          JOIN medicines m ON im.medicine_id = m.id
          WHERE si.invoice_id = sales_invoices.id
        ), 0), total_amount)
      WHERE subtotal IS NULL OR subtotal = 0;
    `);
    if (subtotalResult.changes > 0) {
      console.log(`[Database Healing] Backfilled subtotals for ${subtotalResult.changes} invoices.`);
    }

    const discountResult = await db.run(`
      UPDATE sales_invoices
      SET discount = CASE 
        WHEN subtotal > total_amount THEN ROUND(subtotal - total_amount) 
        ELSE 0 
      END
      WHERE discount IS NULL OR discount = 0;
    `);
    if (discountResult.changes > 0) {
      console.log(`[Database Healing] Backfilled discounts for ${discountResult.changes} invoices.`);
    }
  } catch (healErr) {
    console.warn('[Database Healing] Non-critical warning, failed to run database healing checks:', healErr);
  }

  // Stamp schema version so subsequent boots skip all DDL
  await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('schema_version', ?)", [String(CURRENT_SCHEMA_VERSION)]);
  console.log(`[Boot] Schema v${CURRENT_SCHEMA_VERSION} applied successfully.`);

  // ponytail: don't close — we reuse the dbManager shared connection
}
