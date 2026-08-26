import { dbManager } from './database/connection.js';

// Bump this number whenever you add new CREATE TABLE, ALTER TABLE, or INSERT OR IGNORE statements below.
// On normal boots where this version matches the stored version, all DDL is skipped entirely (~3-5s saved).
const CURRENT_SCHEMA_VERSION = 44;

// FTS5 creates exactly these four shadow tables for an external-content index.
// While the `medicines_fts` declaration exists in sqlite_master these names are
// reserved, so they can neither be created nor inspected as ordinary tables.
const FTS_SHADOW_TABLES = ['medicines_fts_data', 'medicines_fts_idx', 'medicines_fts_docsize', 'medicines_fts_config'];

const FTS_CREATE_SQL = `CREATE VIRTUAL TABLE medicines_fts USING fts5(name, content='medicines', content_rowid='id', tokenize='trigram')`;

const FTS_TRIGGER_SQL = `
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
`;

async function tableExists(db: any, name: string): Promise<boolean> {
  const row = await db.get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?", [name]);
  return !!row;
}

export async function dropFtsTriggers(db: any) {
  for (const trigger of ['medicines_ai', 'medicines_ad', 'medicines_au']) {
    try { await db.exec(`DROP TRIGGER IF EXISTS ${trigger}`); } catch (_) { }
  }
}

/**
 * Classify the FTS index: fully present and queryable, absent, or declared but broken.
 * A missing shadow table is the failure mode that produces "vtable constructor failed".
 */
async function inspectFts(db: any): Promise<'ok' | 'missing' | 'broken'> {
  if (!(await tableExists(db, 'medicines_fts'))) return 'missing';
  for (const shadow of FTS_SHADOW_TABLES) {
    if (!(await tableExists(db, shadow))) return 'broken';
  }
  try {
    await db.get('SELECT COUNT(*) AS cnt FROM medicines_fts');
    return 'ok';
  } catch (_) {
    return 'broken';
  }
}

/**
 * Remove every trace of medicines_fts from the schema.
 *
 * This cannot be done with DROP TABLE alone: dropping an FTS5 virtual table runs
 * its constructor, which is exactly what fails, and the shadow-table names stay
 * reserved while the declaration lives in sqlite_master. Deleting that one schema
 * row first is the only way to break the deadlock; afterwards any surviving shadow
 * tables are ordinary tables and can be dropped normally so their pages are freed.
 */
export async function purgeMedicinesFts(db: any) {
  try {
    await db.run('PRAGMA writable_schema = ON');
    await db.run("DELETE FROM sqlite_master WHERE type='table' AND name = 'medicines_fts'");
  } finally {
    // RESET also flushes the cached schema so later statements see the removal.
    try { await db.run('PRAGMA writable_schema = RESET'); } catch (_) {
      try { await db.run('PRAGMA writable_schema = OFF'); } catch (_) { }
    }
  }
  for (const shadow of FTS_SHADOW_TABLES) {
    try { await db.exec(`DROP TABLE IF EXISTS "${shadow}"`); } catch (_) { }
  }
}

/**
 * Decide whether the index actually holds terms.
 *
 * COUNT(*) cannot answer this: on an external-content FTS5 table a plain scan is
 * served from the content table, so it reports every medicine even when the index
 * is completely empty. Only a MATCH touches the index itself.
 */
async function ftsIndexIsPopulated(db: any): Promise<boolean> {
  const sample = await db.get("SELECT name FROM medicines WHERE name IS NOT NULL AND name != '' LIMIT 1");
  if (!sample) return true;
  // The trigram tokenizer needs at least three characters to match on.
  const token = String(sample.name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toLowerCase();
  if (token.length < 3) return true;
  try {
    const hit = await db.get('SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ? LIMIT 1', [`"${token}"`]);
    return !!hit;
  } catch (_) {
    return false;
  }
}

async function backfillFts(db: any, indexIsNew = false) {
  try {
    const medicines = await db.get('SELECT COUNT(*) AS cnt FROM medicines');
    if (!medicines || medicines.cnt === 0) return;
    // A freshly created index is always empty, so skip the probe in that case.
    if (!indexIsNew && await ftsIndexIsPopulated(db)) return;
    // 'rebuild' is the supported way to repopulate an external-content FTS5 index.
    await db.exec("INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild')");
    console.log(`[Schema] FTS5 index built for ${medicines.cnt} medicine names.`);
  } catch (err: any) {
    console.warn('[Schema] FTS5 backfill skipped:', err.message);
  }
}

/**
 * Guarantee that the medicines_fts search index is either fully working or fully
 * absent — never half-present.
 *
 * This matters far beyond search: the medicines_ai/ad/au triggers write into
 * medicines_fts, so a broken index makes every INSERT/UPDATE/DELETE on `medicines`
 * fail with "vtable constructor failed". That silently reduces a full data
 * migration to zero imported medicines. The triggers are therefore only ever
 * installed once the index has been verified usable, and are removed if it is not.
 *
 * Safe to call on any database handle, including a migration staging database.
 */
export async function ensureMedicinesFts(db: any): Promise<'ok' | 'repaired' | 'unavailable'> {
  // An external-content index needs its content table to exist first.
  if (!(await tableExists(db, 'medicines'))) return 'unavailable';

  const state = await inspectFts(db);
  if (state === 'ok') {
    await db.exec(FTS_TRIGGER_SQL);
    await backfillFts(db);
    return 'ok';
  }

  if (state === 'broken') {
    console.warn('[Schema] medicines_fts is unusable (missing shadow tables) — rebuilding it from scratch.');
    await dropFtsTriggers(db);
    await purgeMedicinesFts(db);
  } else {
    // No declaration, but shadow tables can outlive it (the mirror image of the
    // orphan above). CREATE VIRTUAL TABLE would fail on the name collision, so
    // clear them out first — without the declaration they are ordinary tables.
    for (const shadow of FTS_SHADOW_TABLES) {
      if (await tableExists(db, shadow)) {
        try { await db.exec(`DROP TABLE IF EXISTS "${shadow}"`); } catch (_) { }
      }
    }
  }

  try {
    await db.exec(FTS_CREATE_SQL);
  } catch (err: any) {
    // No usable index. Leaving the triggers in place would block every write to
    // `medicines`, so the app runs without fuzzy search instead.
    await dropFtsTriggers(db);
    await purgeMedicinesFts(db);
    console.error('[Schema] Could not create medicines_fts — medicine search disabled:', err.message);
    return 'unavailable';
  }

  if ((await inspectFts(db)) !== 'ok') {
    await dropFtsTriggers(db);
    await purgeMedicinesFts(db);
    console.error('[Schema] medicines_fts still unusable after rebuild — medicine search disabled.');
    return 'unavailable';
  }

  await db.exec(FTS_TRIGGER_SQL);
  await backfillFts(db, true);
  return state === 'broken' ? 'repaired' : 'ok';
}

/**
 * Ensure required SQLite tables exist.
 * Creates `medicines`, `catalog_jobs`, `processed_files`, `message_templates` and others if they are missing.
 */
export async function ensureSchema(dbPath: string) {
  const db = await dbManager.getConnection();

  // Ensure app_settings and schema_migrations tables exist for schema version tracking
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

  // Fast-path: skip entire DDL wall if schema is already at current version AND key tables exist
  try {
    const versionRow = await db.get("SELECT value FROM app_settings WHERE key = 'schema_version'");
    const migrationRow = await db.get("SELECT MAX(version) as version FROM schema_migrations");
    const tableCheck = await db.get("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name IN ('inventory_master', 'purchase_items', 'sale_items', 'distributors')");
    if (versionRow && parseInt(versionRow.value, 10) >= CURRENT_SCHEMA_VERSION && tableCheck && tableCheck.c >= 4) {
      if (!migrationRow || !migrationRow.version) {
        await db.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', [CURRENT_SCHEMA_VERSION]);
      }
      console.log(`[Boot] Schema v${CURRENT_SCHEMA_VERSION} already applied, skipping DDL (fast boot).`);
      // Still verify the FTS index and performance composite indexes:
      await db.run('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_sales_invoices_cust_pay ON sales_invoices(customer_id, payment_status, payment_medium)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_sales_date_status ON sales_invoices(date DESC, payment_status)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_purchases_date_dist ON purchases(date DESC, distributor_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_customers_credit ON customers(credit_balance, credit_enabled)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_name_mfg ON medicines(name, manufacturer)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_special_orders_status_date ON special_orders(status, date DESC)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_master_stock ON inventory_master(quantity, loose_quantity)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_auto_notif_type_status ON automation_notifications(type, status, created_at DESC)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_auto_notif_created ON automation_notifications(created_at DESC)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_action_logs_created_type ON action_logs(created_at DESC, action_type)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_delivery_boys_active ON delivery_boys(is_active)');
      // Bare-ORDER-BY list endpoints previously full-scanned these tables per request:
      await db.run('CREATE INDEX IF NOT EXISTS idx_dispatch_orders_created ON dispatch_orders(created_at DESC)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_special_orders_date ON special_orders(date DESC)');
      // Investigation timeline joins that previously had no index path
      // (return_items had ZERO indexes; purchase bill join keyed med+batch):
      await db.run('CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_return_items_medicine_id ON return_items(medicine_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_purchase_items_med_batch ON purchase_items(medicine_id, batch_no)');
      // Reports route date predicates wrap columns in COALESCE(date(...)) which
      // defeats plain date indexes; these EXPRESSION indexes match that exact
      // expression so SQLite can range-scan instead of full-scanning per request.
      await db.run("CREATE INDEX IF NOT EXISTS idx_sales_report_day ON sales_invoices(COALESCE(date(business_date), date(date), date(substr(date, 1, 10)), date(substr(business_date, 1, 10))))");
      await db.run("CREATE INDEX IF NOT EXISTS idx_purchases_report_day ON purchases(COALESCE(date(date), date(business_date), date(substr(date, 1, 10)), date(substr(business_date, 1, 10))))");
      // Schedule Drugs hub: filter-by-schedule + name-ordered pages over the
      // 291k master catalog (composite covers equality lookups on schedule_type)
      await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_schedule_type_name ON medicines(schedule_type, name)');
      await ensureMedicinesFts(db);
      return;
    }
  } catch (_) {
    // Should not happen now that app_settings is explicitly created above
  }

  console.log(`[Boot] Applying schema v${CURRENT_SCHEMA_VERSION}...`);

  // We have removed the strict CHECK constraint on catalog_jobs and distributor_dispatch_reminders tables.
  // We'll rely on TypeScript for enum enforcement to prevent future SQLite crashes when new statuses are introduced.
  try {
    const tableSql = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_jobs'");
    if (tableSql && /CHECK\s*\(\s*status\s+IN/i.test(tableSql.sql)) {
      console.log('Removing strict CHECK constraint from catalog_jobs...');
      await db.run("DROP TABLE IF EXISTS catalog_jobs");
    }
  } catch (err) {
    console.warn('Failed removing CHECK constraint:', err);
  }

  try {
    const remTableSql = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='distributor_dispatch_reminders'");
    if (remTableSql && /CHECK\s*\(\s*status\s+IN/i.test(remTableSql.sql)) {
      console.log('Removing strict CHECK constraint from distributor_dispatch_reminders...');
      await db.exec(`
        CREATE TABLE IF NOT EXISTS distributor_dispatch_reminders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          distributor_id INTEGER,
          distributor_name TEXT NOT NULL,
          distributor_phone TEXT,
          delivery_boy_id INTEGER,
          status TEXT DEFAULT 'Pending',
          auto_remind INTEGER DEFAULT 1,
          last_reminded_at DATETIME,
          date TEXT NOT NULL,
          order_source TEXT DEFAULT 'pharmarack',
          email_received_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO distributor_dispatch_reminders_new (id, distributor_id, distributor_name, distributor_phone, delivery_boy_id, status, auto_remind, last_reminded_at, date, created_at)
        SELECT id, distributor_id, distributor_name, distributor_phone, delivery_boy_id, status, auto_remind, last_reminded_at, date, created_at FROM distributor_dispatch_reminders;
        DROP TABLE distributor_dispatch_reminders;
        ALTER TABLE distributor_dispatch_reminders_new RENAME TO distributor_dispatch_reminders;
        CREATE INDEX IF NOT EXISTS idx_distributor_dispatch_reminders_date ON distributor_dispatch_reminders (date);
        CREATE INDEX IF NOT EXISTS idx_distributor_dispatch_reminders_distributor ON distributor_dispatch_reminders (distributor_id);
      `);
    }
  } catch (err) {
    console.warn('Failed removing CHECK constraint from distributor_dispatch_reminders:', err);
  }
  try {
    const spTableSql = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='special_orders'");
    if (spTableSql && /CHECK\s*\(\s*status\s+IN/i.test(spTableSql.sql)) {
      console.log('Removing strict CHECK constraint from special_orders...');
      const cols: Array<{ name: string }> = await db.all("PRAGMA table_info(special_orders)");
      const colNames = cols.map(c => c.name).join(', ');
      await db.exec(`
        DROP TABLE IF EXISTS special_orders_new;
        CREATE TABLE special_orders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER DEFAULT NULL,
          product TEXT,
          requester TEXT,
          phone TEXT,
          notes TEXT,
          medicine_name TEXT,
          qty INTEGER DEFAULT 1,
          priority TEXT DEFAULT 'Normal',
          status TEXT DEFAULT 'Pending',
          date DATETIME DEFAULT CURRENT_TIMESTAMP,
          notified INTEGER DEFAULT 0,
          pharmarack_distributor TEXT,
          pharmarack_rate REAL,
          pharmarack_mrp REAL,
          pharmarack_mapped INTEGER DEFAULT 0,
          pharmarack_scheme TEXT,
          advance_payment REAL DEFAULT 0.0,
          distributor_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT,
          source_refill_id INTEGER DEFAULT NULL,
          converted_to_refill_id INTEGER DEFAULT NULL,
          cart_add_error TEXT DEFAULT NULL,
          notification_count INTEGER DEFAULT 0,
          lifecycle_status TEXT DEFAULT 'CREATED',
          last_checked_at DATETIME
        );
      `);
      if (colNames) {
        await db.exec(`
          INSERT INTO special_orders_new (${colNames}) SELECT ${colNames} FROM special_orders;
        `);
      }
      await db.exec(`
        DROP TABLE special_orders;
        ALTER TABLE special_orders_new RENAME TO special_orders;
      `);
    }
  } catch (err) {
    console.warn('Failed removing CHECK constraint from special_orders:', err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_reference TEXT,
      mrp REAL,
      hsn_code TEXT,
      schedule_type TEXT,
      manufacturer TEXT,
      category TEXT,
      marketed_by TEXT,
      legacy_id TEXT,
      packaging TEXT,
      item_type TEXT,
      cgst_per REAL DEFAULT 0,
      sgst_per REAL DEFAULT 0,
      igst_per REAL DEFAULT 0,
      rack TEXT,
      therapeutic TEXT DEFAULT NULL,
      sub_therapeutic TEXT DEFAULT NULL,
      short_code TEXT DEFAULT NULL,
      ucode TEXT DEFAULT NULL,
      disable_auto_barcode INTEGER DEFAULT 0,
      tb_medicine INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      possible_duplicate_of INTEGER DEFAULT NULL,
      sell_price REAL DEFAULT NULL,
      allow_loose_sale INTEGER DEFAULT 1
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
    CREATE INDEX IF NOT EXISTS idx_medicines_therapeutic ON medicines (therapeutic);
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
      expiry_month TEXT,
      is_active INTEGER DEFAULT 1,
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
      tax_amount REAL,
      net_profit REAL DEFAULT 0,
      payment_medium TEXT DEFAULT 'CASH',
      payment_status TEXT DEFAULT 'PAID'
    );
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER,
      batch_no TEXT,
      quantity INTEGER,
      transaction_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id ON sales_invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices (date);
    CREATE INDEX IF NOT EXISTS idx_sale_items_invoice_id ON sale_items (invoice_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_inventory_id ON sale_items (inventory_id);
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
    CREATE TABLE IF NOT EXISTS expiry_return_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      batch_no TEXT NOT NULL,
      expiry_date TEXT,
      quantity REAL NOT NULL,
      distributor_id INTEGER,
      distributor_name TEXT,
      cost_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      proposed_return_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      return_id INTEGER,
      notes TEXT,
      FOREIGN KEY(inventory_id) REFERENCES inventory_master(id),
      FOREIGN KEY(medicine_id) REFERENCES medicines(id),
      FOREIGN KEY(distributor_id) REFERENCES distributors(id),
      FOREIGN KEY(return_id) REFERENCES returns(id)
    );
    CREATE INDEX IF NOT EXISTS idx_expiry_reviews_status ON expiry_return_reviews(status);
    CREATE INDEX IF NOT EXISTS idx_expiry_reviews_inv ON expiry_return_reviews(inventory_id);

    -- Agent B: CRM, Communication, & Utilities Schemas
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      phone TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      notes TEXT,
      alias_names TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone);
    CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts (type);
    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT,
      description TEXT,
      metadata TEXT,
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
    CREATE TABLE IF NOT EXISTS storage_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      type TEXT DEFAULT 'rack',
      description TEXT,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_reorder_snooze (
      medicine_id INTEGER PRIMARY KEY,
      snooze_until TEXT NOT NULL,
      snooze_type TEXT NOT NULL DEFAULT '7_days',
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );
    CREATE TABLE IF NOT EXISTS patient_refills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      refill_interval_days INTEGER DEFAULT 30,
      last_refill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      next_refill_date DATETIME,
      status TEXT DEFAULT 'pending',
      hold_for_stock INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_ready INTEGER DEFAULT 0,
      acknowledged INTEGER DEFAULT 0,
      ordering_triggered INTEGER DEFAULT 0,
      quick_bill_id INTEGER DEFAULT NULL,
      stock_verified_override INTEGER DEFAULT 0,
      quantity_needed INTEGER DEFAULT 3,
      language TEXT DEFAULT 'en',
      reminder_status TEXT DEFAULT 'NOT_SENT',
      reminder_sent_at DATETIME DEFAULT NULL,
      reminder_job_id INTEGER DEFAULT NULL,
      reminder_occurrence_date DATETIME DEFAULT NULL,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS held_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      temp_label TEXT,
      patient_name TEXT,
      patient_phone TEXT,
      doctor_name TEXT,
      discount REAL DEFAULT 0,
      remarks TEXT,
      cart_data TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
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
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_status ON sales_invoices (customer_id, payment_status, payment_medium);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_date_status ON sales_invoices (date DESC, payment_status);
    CREATE INDEX IF NOT EXISTS idx_purchases_date_dist ON purchases (date DESC, distributor_id);
    CREATE INDEX IF NOT EXISTS idx_medicines_name_mfg ON medicines (name, manufacturer);
    CREATE TABLE IF NOT EXISTS distributor_dispatch_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      distributor_name TEXT NOT NULL,
      distributor_phone TEXT,
      delivery_boy_id INTEGER,
      status TEXT DEFAULT 'Pending',
      auto_remind INTEGER DEFAULT 1,
      last_reminded_at DATETIME,
      date TEXT NOT NULL,
      order_source TEXT DEFAULT 'pharmarack',
      email_received_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_distributor_dispatch_reminders_date ON distributor_dispatch_reminders (date);
    CREATE INDEX IF NOT EXISTS idx_distributor_dispatch_reminders_distributor ON distributor_dispatch_reminders (distributor_id);
    DELETE FROM distributor_dispatch_reminders 
    WHERE id NOT IN (
      SELECT MAX(id) 
      FROM distributor_dispatch_reminders 
      GROUP BY date, LOWER(TRIM(distributor_name))
    );

    -- Core Operational Tables
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
    CREATE INDEX IF NOT EXISTS idx_purchase_items_med_batch ON purchase_items (medicine_id, batch_no);

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
    CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items (return_id);
    CREATE INDEX IF NOT EXISTS idx_return_items_medicine_id ON return_items (medicine_id);

    CREATE TABLE IF NOT EXISTS special_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester TEXT,
      phone TEXT,
      notes TEXT,
      medicine_name TEXT,
      product TEXT,
      qty INTEGER DEFAULT 1,
      priority TEXT DEFAULT 'Normal',
      status TEXT DEFAULT 'Pending',
      notified INTEGER DEFAULT 0,
      pharmarack_mapped INTEGER DEFAULT 0,
      pharmarack_distributor TEXT,
      pharmarack_rate REAL,
      pharmarack_mrp REAL,
      pharmarack_scheme TEXT,
      advance_payment REAL DEFAULT 0.0,
      distributor_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source_refill_id INTEGER DEFAULT NULL,
      source TEXT,
      converted_to_refill_id INTEGER DEFAULT NULL,
      customer_id INTEGER DEFAULT NULL,
      cart_add_error TEXT DEFAULT NULL,
      notification_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS distributor_learning_profiles (
      distributor_id INTEGER PRIMARY KEY,
      file_mapping_rules TEXT,
      layout_type TEXT,
      layout_patterns TEXT,
      field_positions TEXT,
      missing_field_rules TEXT,
      success_count INTEGER DEFAULT 0,
      last_success_at DATETIME,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(distributor_id) REFERENCES distributors(id)
    );

    CREATE TABLE IF NOT EXISTS precalculated_stock_metrics (
      medicine_id INTEGER PRIMARY KEY,
      total_units_pool INTEGER DEFAULT 0,
      low_stock_flag INTEGER DEFAULT 0,
      daily_sales_velocity REAL DEFAULT 0,
      burn_rate_ratio REAL DEFAULT 0,
      heavy_sell_flag INTEGER DEFAULT 0,
      suggested_refill_qty INTEGER DEFAULT 0,
      metrics_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_stock_metrics_low_stock ON precalculated_stock_metrics(low_stock_flag);
    CREATE INDEX IF NOT EXISTS idx_stock_metrics_heavy_sell ON precalculated_stock_metrics(heavy_sell_flag);
  `);

    const profileCols = await db.all("PRAGMA table_info(distributor_learning_profiles)").catch(() => []);
    const existingProfileCols = new Set(profileCols.map((c: any) => c.name));
    if (!existingProfileCols.has('layout_type')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN layout_type TEXT").catch(() => {});
    }
    if (!existingProfileCols.has('layout_patterns')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN layout_patterns TEXT").catch(() => {});
    }
    if (!existingProfileCols.has('field_positions')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN field_positions TEXT").catch(() => {});
    }
    if (!existingProfileCols.has('missing_field_rules')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN missing_field_rules TEXT").catch(() => {});
    }
    if (!existingProfileCols.has('success_count')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN success_count INTEGER DEFAULT 0").catch(() => {});
    }
    if (!existingProfileCols.has('last_success_at')) {
      await db.run("ALTER TABLE distributor_learning_profiles ADD COLUMN last_success_at DATETIME").catch(() => {});
    }

    const medCols = await db.all("PRAGMA table_info(medicines)").catch(() => []);
    const existingMedCols = new Set(medCols.map((c: any) => c.name));
    if (!existingMedCols.has('sell_price')) {
      await db.run("ALTER TABLE medicines ADD COLUMN sell_price REAL DEFAULT NULL").catch(() => {});
    }
    if (!existingMedCols.has('allow_loose_sale')) {
      await db.run("ALTER TABLE medicines ADD COLUMN allow_loose_sale INTEGER DEFAULT 1").catch(() => {});
      await db.run(`
        UPDATE medicines 
        SET allow_loose_sale = 0 
        WHERE LOWER(packaging) LIKE '%bottle%' 
           OR LOWER(packaging) LIKE '%syrup%' 
           OR LOWER(packaging) LIKE '%suspension%' 
           OR LOWER(packaging) LIKE '%drops%' 
           OR LOWER(packaging) LIKE '%inj%' 
           OR LOWER(packaging) LIKE '%ml%' 
           OR LOWER(name) LIKE '%syrup%' 
           OR LOWER(name) LIKE '%suspension%' 
           OR LOWER(name) LIKE '%bottle%'
      `).catch(() => {});
    }

  await db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_distributor_hist_files_dist_id ON distributor_historical_files (distributor_id);

    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      device_name TEXT,
      os TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS whatsapp_send_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'distributor_collection',
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      target_name TEXT,
      scheduled_at INTEGER,
      media_url TEXT,
      file_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at INTEGER DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_send_queue_status ON whatsapp_send_queue (status);

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

    CREATE TABLE IF NOT EXISTS session_refresh_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      next_scheduled_minutes INTEGER,
      status TEXT NOT NULL,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_refresh_logs_ts ON session_refresh_logs(timestamp);

    CREATE TABLE IF NOT EXISTS emails (
      uid INTEGER PRIMARY KEY,
      from_addr TEXT,
      subject TEXT,
      body TEXT,
      date DATETIME,
      is_seen INTEGER DEFAULT 0,
      is_order INTEGER DEFAULT 0,
      is_saved INTEGER DEFAULT 0,
      distributor_name TEXT,
      has_attachments INTEGER DEFAULT 0,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      medicine_names TEXT,
      extracted_invoice_no TEXT,
      extracted_distributor TEXT
    );

    CREATE TABLE IF NOT EXISTS medicine_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER,
      order_id INTEGER,
      status TEXT DEFAULT 'CREATED',
      source_type TEXT DEFAULT 'special_order',
      source_id INTEGER,
      source_distributor_id INTEGER,
      quantity REAL,
      cost_price REAL,
      mrp REAL,
      batch_no TEXT,
      expiry_date TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_med_lifecycle_status ON medicine_lifecycle(status);
    CREATE INDEX IF NOT EXISTS idx_med_lifecycle_order ON medicine_lifecycle(order_id);

    CREATE TABLE IF NOT EXISTS order_overlaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      special_order_id INTEGER,
      purchase_id INTEGER,
      purchase_item_id INTEGER,
      inventory_master_id INTEGER,
      medicine_id INTEGER,
      match_type TEXT DEFAULT 'exact_name',
      match_confidence REAL DEFAULT 1.0,
      overlap_status TEXT DEFAULT 'detected',
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_order_overlaps_special_order ON order_overlaps(special_order_id);
    CREATE INDEX IF NOT EXISTS idx_order_overlaps_status ON order_overlaps(overlap_status);

    CREATE TABLE IF NOT EXISTS order_tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      event_type TEXT DEFAULT 'created',
      event_detail TEXT,
      performed_by TEXT DEFAULT 'system',
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_order_tracking_events_order ON order_tracking_events(order_id);
  `);

  // Safely add new columns to existing tables (SQLite throws if column exists — we catch and ignore)
  // Safely add new columns to existing tables after pre-checking PRAGMA table_info
  const alterStatements: Array<[string, string, string]> = [
    ['action_logs', 'metadata', 'ALTER TABLE action_logs ADD COLUMN metadata TEXT'],
    ['inventory_master', 'unit_price', 'ALTER TABLE inventory_master ADD COLUMN unit_price REAL DEFAULT 0'],
    ['inventory_master', 'cost_price', 'ALTER TABLE inventory_master ADD COLUMN cost_price REAL DEFAULT 0'],
    ['inventory_master', 'reorder_level', 'ALTER TABLE inventory_master ADD COLUMN reorder_level INTEGER DEFAULT 10'],
    ['inventory_master', 'max_stock_level', 'ALTER TABLE inventory_master ADD COLUMN max_stock_level INTEGER DEFAULT NULL'],
    ['inventory_master', 'mrp', 'ALTER TABLE inventory_master ADD COLUMN mrp REAL DEFAULT 0'],
    ['inventory_master', 'legacy_batch_id', 'ALTER TABLE inventory_master ADD COLUMN legacy_batch_id TEXT'],
    ['inventory_master', 'loose_quantity', 'ALTER TABLE inventory_master ADD COLUMN loose_quantity INTEGER DEFAULT 0'],
    ['inventory_master', 'is_active', 'ALTER TABLE inventory_master ADD COLUMN is_active INTEGER DEFAULT 1'],
    ['inventory_master', 'created_at', 'ALTER TABLE inventory_master ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['inventory_master', 'expiry_month', 'ALTER TABLE inventory_master ADD COLUMN expiry_month TEXT'],
    ['medicines', 'max_stock_level', 'ALTER TABLE medicines ADD COLUMN max_stock_level INTEGER DEFAULT NULL'],
    ['medicines', 'mrp', 'ALTER TABLE medicines ADD COLUMN mrp REAL DEFAULT 0'],
    ['medicines', 'hsn_code', 'ALTER TABLE medicines ADD COLUMN hsn_code TEXT'],
    ['medicines', 'schedule_type', 'ALTER TABLE medicines ADD COLUMN schedule_type TEXT DEFAULT \'None\''],
    ['medicines', 'manufacturer', 'ALTER TABLE medicines ADD COLUMN manufacturer TEXT'],
    ['medicines', 'category', 'ALTER TABLE medicines ADD COLUMN category TEXT'],
    ['medicines', 'marketed_by', 'ALTER TABLE medicines ADD COLUMN marketed_by TEXT'],
    ['medicines', 'legacy_id', 'ALTER TABLE medicines ADD COLUMN legacy_id TEXT'],
    ['medicines', 'packaging', 'ALTER TABLE medicines ADD COLUMN packaging TEXT'],
    ['medicines', 'item_type', 'ALTER TABLE medicines ADD COLUMN item_type TEXT'],
    ['medicines', 'rack', 'ALTER TABLE medicines ADD COLUMN rack TEXT'],
    ['medicines', 'generic_name', 'ALTER TABLE medicines ADD COLUMN generic_name TEXT'],
    ['medicines', 'strength', 'ALTER TABLE medicines ADD COLUMN strength TEXT'],
    ['medicines', 'rate', 'ALTER TABLE medicines ADD COLUMN rate REAL DEFAULT 0'],
    ['medicines', 'pack_unit', 'ALTER TABLE medicines ADD COLUMN pack_unit TEXT'],
    ['medicines', 'cgst_per', 'ALTER TABLE medicines ADD COLUMN cgst_per REAL DEFAULT 0'],
    ['medicines', 'sgst_per', 'ALTER TABLE medicines ADD COLUMN sgst_per REAL DEFAULT 0'],
    ['medicines', 'igst_per', 'ALTER TABLE medicines ADD COLUMN igst_per REAL DEFAULT 0'],
    ['medicines', 'item_code', 'ALTER TABLE medicines ADD COLUMN item_code TEXT'],
    ['medicines', 'metadata', 'ALTER TABLE medicines ADD COLUMN metadata TEXT'],
    ['medicines', 'sell_price', 'ALTER TABLE medicines ADD COLUMN sell_price REAL DEFAULT NULL'],
    ['purchases', 'cgst_value', 'ALTER TABLE purchases ADD COLUMN cgst_value REAL DEFAULT 0'],
    ['purchases', 'sgst_value', 'ALTER TABLE purchases ADD COLUMN sgst_value REAL DEFAULT 0'],
    ['purchases', 'igst_value', 'ALTER TABLE purchases ADD COLUMN igst_value REAL DEFAULT 0'],
    ['purchases', 'roff', 'ALTER TABLE purchases ADD COLUMN roff REAL DEFAULT 0'],
    ['purchases', 'status', 'ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT \'PUBLISHED\''],
    ['purchases', 'legacy_id', 'ALTER TABLE purchases ADD COLUMN legacy_id TEXT'],
    ['purchases', 'business_date', 'ALTER TABLE purchases ADD COLUMN business_date DATETIME'],
    ['purchases', 'app_invoice_no', 'ALTER TABLE purchases ADD COLUMN app_invoice_no TEXT'],
    ['purchases', 'cn_amount', 'ALTER TABLE purchases ADD COLUMN cn_amount REAL DEFAULT 0'],
    ['purchases', 'cn_number', 'ALTER TABLE purchases ADD COLUMN cn_number TEXT DEFAULT NULL'],
    ['purchases', 'original_amount', 'ALTER TABLE purchases ADD COLUMN original_amount REAL DEFAULT NULL'],
    ['special_orders', 'lifecycle_status', 'ALTER TABLE special_orders ADD COLUMN lifecycle_status TEXT DEFAULT \'CREATED\''],
    ['special_orders', 'last_checked_at', 'ALTER TABLE special_orders ADD COLUMN last_checked_at DATETIME'],
    ['sales_invoices', 'doctor_id', 'ALTER TABLE sales_invoices ADD COLUMN doctor_id INTEGER'],
    ['sales_invoices', 'payment_medium', 'ALTER TABLE sales_invoices ADD COLUMN payment_medium TEXT'],
    ['sales_invoices', 'roff', 'ALTER TABLE sales_invoices ADD COLUMN roff REAL DEFAULT 0'],
    ['sales_invoices', 'cgst_value', 'ALTER TABLE sales_invoices ADD COLUMN cgst_value REAL DEFAULT 0'],
    ['sales_invoices', 'sgst_value', 'ALTER TABLE sales_invoices ADD COLUMN sgst_value REAL DEFAULT 0'],
    ['sales_invoices', 'igst_value', 'ALTER TABLE sales_invoices ADD COLUMN igst_value REAL DEFAULT 0'],
    ['sales_invoices', 'legacy_id', 'ALTER TABLE sales_invoices ADD COLUMN legacy_id TEXT'],
    ['sales_invoices', 'business_date', 'ALTER TABLE sales_invoices ADD COLUMN business_date DATETIME'],
    ['sales_invoices', 'discount', 'ALTER TABLE sales_invoices ADD COLUMN discount REAL DEFAULT 0'],
    ['sales_invoices', 'subtotal', 'ALTER TABLE sales_invoices ADD COLUMN subtotal REAL DEFAULT 0'],
    ['sales_invoices', 'payment_status', 'ALTER TABLE sales_invoices ADD COLUMN payment_status TEXT DEFAULT \'PAID\''],
    ['sales_invoices', 'net_profit', 'ALTER TABLE sales_invoices ADD COLUMN net_profit REAL DEFAULT 0'],
    ['sales_invoices', 'updated_at', 'ALTER TABLE sales_invoices ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['sale_items', 'mrp', 'ALTER TABLE sale_items ADD COLUMN mrp REAL'],
    ['sale_items', 'batch_no', 'ALTER TABLE sale_items ADD COLUMN batch_no TEXT'],
    ['sale_items', 'cgst_value', 'ALTER TABLE sale_items ADD COLUMN cgst_value REAL DEFAULT 0'],
    ['sale_items', 'sgst_value', 'ALTER TABLE sale_items ADD COLUMN sgst_value REAL DEFAULT 0'],
    ['sale_items', 'discount_per', 'ALTER TABLE sale_items ADD COLUMN discount_per REAL DEFAULT 0'],
    ['sale_items', 'legacy_id', 'ALTER TABLE sale_items ADD COLUMN legacy_id TEXT'],
    ['sale_items', 'loose_qty', 'ALTER TABLE sale_items ADD COLUMN loose_qty INTEGER DEFAULT 0'],
    ['returns', 'cgst_value', 'ALTER TABLE returns ADD COLUMN cgst_value REAL DEFAULT 0'],
    ['returns', 'sgst_value', 'ALTER TABLE returns ADD COLUMN sgst_value REAL DEFAULT 0'],
    ['returns', 'igst_value', 'ALTER TABLE returns ADD COLUMN igst_value REAL DEFAULT 0'],
    ['returns', 'distributor_id', 'ALTER TABLE returns ADD COLUMN distributor_id INTEGER'],
    ['returns', 'legacy_id', 'ALTER TABLE returns ADD COLUMN legacy_id TEXT'],
    ['returns', 'reason', 'ALTER TABLE returns ADD COLUMN reason TEXT'],
    ['returns', 'return_invoice_id', 'ALTER TABLE returns ADD COLUMN return_invoice_id TEXT DEFAULT NULL'],
    ['returns', 'return_sub_type', 'ALTER TABLE returns ADD COLUMN return_sub_type TEXT CHECK(return_sub_type IN (\'expiry\', \'good\')) DEFAULT \'good\''],
    ['returns', 'return_date_time', 'ALTER TABLE returns ADD COLUMN return_date_time DATETIME DEFAULT NULL'],
    ['returns', 'raw_return_type', 'ALTER TABLE returns ADD COLUMN raw_return_type TEXT'],
    ['distributors', 'legacy_id', 'ALTER TABLE distributors ADD COLUMN legacy_id TEXT'],
    ['distributors', 'gstin', 'ALTER TABLE distributors ADD COLUMN gstin TEXT'],
    ['distributors', 'address', 'ALTER TABLE distributors ADD COLUMN address TEXT'],
    ['distributors', 'city', 'ALTER TABLE distributors ADD COLUMN city TEXT'],
    ['distributors', 'email', 'ALTER TABLE distributors ADD COLUMN email TEXT'],
    ['distributors', 'dl_no', 'ALTER TABLE distributors ADD COLUMN dl_no TEXT'],
    ['distributors', 'phone', 'ALTER TABLE distributors ADD COLUMN phone TEXT'],
    ['distributors', 'state_code', 'ALTER TABLE distributors ADD COLUMN state_code TEXT'],
    ['distributors', 'preferred_file_format', 'ALTER TABLE distributors ADD COLUMN preferred_file_format TEXT DEFAULT NULL'],
    ['distributors', 'mapping_config', 'ALTER TABLE distributors ADD COLUMN mapping_config TEXT DEFAULT NULL'],
    ['doctors', 'send_daily_summary', 'ALTER TABLE doctors ADD COLUMN send_daily_summary INTEGER DEFAULT 0'],
    ['customers', 'legacy_id', 'ALTER TABLE customers ADD COLUMN legacy_id TEXT'],
    ['customers', 'age', 'ALTER TABLE customers ADD COLUMN age TEXT'],
    ['customers', 'gender', 'ALTER TABLE customers ADD COLUMN gender TEXT'],
    ['customers', 'credit_enabled', 'ALTER TABLE customers ADD COLUMN credit_enabled INTEGER DEFAULT 0'],
    ['customers', 'credit_balance', 'ALTER TABLE customers ADD COLUMN credit_balance REAL DEFAULT 0'],
    ['customers', 'created_at', 'ALTER TABLE customers ADD COLUMN created_at DATETIME'],
    ['customers', 'credit_due_date', 'ALTER TABLE customers ADD COLUMN credit_due_date TEXT'],
    ['customers', 'language', "ALTER TABLE customers ADD COLUMN language TEXT DEFAULT 'en'"],
    ['patient_refills', 'hold_for_stock', 'ALTER TABLE patient_refills ADD COLUMN hold_for_stock INTEGER DEFAULT 0'],
    ['patient_refills', 'is_active', 'ALTER TABLE patient_refills ADD COLUMN is_active INTEGER DEFAULT 1'],
    ['patient_refills', 'is_ready', 'ALTER TABLE patient_refills ADD COLUMN is_ready INTEGER DEFAULT 0'],
    ['patient_refills', 'acknowledged', 'ALTER TABLE patient_refills ADD COLUMN acknowledged INTEGER DEFAULT 0'],
    ['patient_refills', 'ordering_triggered', 'ALTER TABLE patient_refills ADD COLUMN ordering_triggered INTEGER DEFAULT 0'],
    ['patient_refills', 'quick_bill_id', 'ALTER TABLE patient_refills ADD COLUMN quick_bill_id INTEGER DEFAULT NULL'],
    ['patient_refills', 'stock_verified_override', 'ALTER TABLE patient_refills ADD COLUMN stock_verified_override INTEGER DEFAULT 0'],
    ['patient_refills', 'customer_id', 'ALTER TABLE patient_refills ADD COLUMN customer_id INTEGER DEFAULT NULL'],
    ['patient_refills', 'quantity_needed', 'ALTER TABLE patient_refills ADD COLUMN quantity_needed INTEGER DEFAULT 3'],
    ['patient_refills', 'language', "ALTER TABLE patient_refills ADD COLUMN language TEXT DEFAULT 'en'"],
    ['patient_refills', 'reminder_status', "ALTER TABLE patient_refills ADD COLUMN reminder_status TEXT DEFAULT 'NOT_SENT'"],
    ['patient_refills', 'reminder_sent_at', 'ALTER TABLE patient_refills ADD COLUMN reminder_sent_at DATETIME DEFAULT NULL'],
    ['patient_refills', 'reminder_job_id', 'ALTER TABLE patient_refills ADD COLUMN reminder_job_id INTEGER DEFAULT NULL'],
    ['patient_refills', 'reminder_occurrence_date', 'ALTER TABLE patient_refills ADD COLUMN reminder_occurrence_date DATETIME DEFAULT NULL'],
    ['special_orders', 'customer_id', 'ALTER TABLE special_orders ADD COLUMN customer_id INTEGER DEFAULT NULL'],
    ['special_orders', 'date', 'ALTER TABLE special_orders ADD COLUMN date DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['special_orders', 'product', 'ALTER TABLE special_orders ADD COLUMN product TEXT'],
    ['special_orders', 'medicine_name', 'ALTER TABLE special_orders ADD COLUMN medicine_name TEXT'],
    ['special_orders', 'qty', 'ALTER TABLE special_orders ADD COLUMN qty INTEGER DEFAULT 1'],
    ['special_orders', 'priority', 'ALTER TABLE special_orders ADD COLUMN priority TEXT DEFAULT \'Normal\''],
    ['special_orders', 'notified', 'ALTER TABLE special_orders ADD COLUMN notified INTEGER DEFAULT 0'],
    ['special_orders', 'pharmarack_mapped', 'ALTER TABLE special_orders ADD COLUMN pharmarack_mapped INTEGER DEFAULT 0'],
    ['special_orders', 'pharmarack_distributor', 'ALTER TABLE special_orders ADD COLUMN pharmarack_distributor TEXT'],
    ['special_orders', 'pharmarack_rate', 'ALTER TABLE special_orders ADD COLUMN pharmarack_rate REAL'],
    ['special_orders', 'pharmarack_mrp', 'ALTER TABLE special_orders ADD COLUMN pharmarack_mrp REAL'],
    ['special_orders', 'pharmarack_scheme', 'ALTER TABLE special_orders ADD COLUMN pharmarack_scheme TEXT'],
    ['special_orders', 'advance_payment', 'ALTER TABLE special_orders ADD COLUMN advance_payment REAL DEFAULT 0.0'],
    ['special_orders', 'converted_to_refill_id', 'ALTER TABLE special_orders ADD COLUMN converted_to_refill_id INTEGER DEFAULT NULL'],
    ['special_orders', 'source_refill_id', 'ALTER TABLE special_orders ADD COLUMN source_refill_id INTEGER DEFAULT NULL'],
    ['special_orders', 'source', 'ALTER TABLE special_orders ADD COLUMN source TEXT'],
    ['special_orders', 'cart_add_error', 'ALTER TABLE special_orders ADD COLUMN cart_add_error TEXT DEFAULT NULL'],
    ['special_orders', 'notification_count', 'ALTER TABLE special_orders ADD COLUMN notification_count INTEGER DEFAULT 0'],
    ['held_bills', 'invoice_no', 'ALTER TABLE held_bills ADD COLUMN invoice_no TEXT'],
    ['held_bills', 'temp_label', 'ALTER TABLE held_bills ADD COLUMN temp_label TEXT'],
    ['held_bills', 'patient_name', 'ALTER TABLE held_bills ADD COLUMN patient_name TEXT'],
    ['held_bills', 'patient_phone', 'ALTER TABLE held_bills ADD COLUMN patient_phone TEXT'],
    ['held_bills', 'doctor_name', 'ALTER TABLE held_bills ADD COLUMN doctor_name TEXT'],
    ['held_bills', 'discount', 'ALTER TABLE held_bills ADD COLUMN discount REAL DEFAULT 0'],
    ['held_bills', 'remarks', 'ALTER TABLE held_bills ADD COLUMN remarks TEXT'],
    ['held_bills', 'cart_data', 'ALTER TABLE held_bills ADD COLUMN cart_data TEXT'],
    ['held_bills', 'created_at', 'ALTER TABLE held_bills ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['held_bills', 'date', 'ALTER TABLE held_bills ADD COLUMN date DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['held_bills', 'customer_id', 'ALTER TABLE held_bills ADD COLUMN customer_id INTEGER DEFAULT NULL'],
    ['medicines', 'enrichment_status', 'ALTER TABLE medicines ADD COLUMN enrichment_status TEXT DEFAULT NULL'],
    ['medicines', 'enrichment_confidence', 'ALTER TABLE medicines ADD COLUMN enrichment_confidence REAL DEFAULT NULL'],
    ['medicines', 'pack_size', 'ALTER TABLE medicines ADD COLUMN pack_size INTEGER'],
    ['medicines', 'source', 'ALTER TABLE medicines ADD COLUMN source TEXT DEFAULT \'manual\''],
    ['medicines', 'possible_duplicate_of', 'ALTER TABLE medicines ADD COLUMN possible_duplicate_of INTEGER DEFAULT NULL'],
    ['medicines', 'therapeutic', 'ALTER TABLE medicines ADD COLUMN therapeutic TEXT DEFAULT NULL'],
    ['medicines', 'sub_therapeutic', 'ALTER TABLE medicines ADD COLUMN sub_therapeutic TEXT DEFAULT NULL'],
    ['medicines', 'short_code', 'ALTER TABLE medicines ADD COLUMN short_code TEXT DEFAULT NULL'],
    ['medicines', 'ucode', 'ALTER TABLE medicines ADD COLUMN ucode TEXT DEFAULT NULL'],
    ['medicines', 'disable_auto_barcode', 'ALTER TABLE medicines ADD COLUMN disable_auto_barcode INTEGER DEFAULT 0'],
    ['medicines', 'tb_medicine', 'ALTER TABLE medicines ADD COLUMN tb_medicine INTEGER DEFAULT 0'],
    // stock_ledger's full definition (line ~1280) never applies on top of the earlier
    // CREATE TABLE IF NOT EXISTS (line ~329) — these three columns were silently missing
    // on every install, making every recordStockLedger() call throw (swallowed by its own catch).
    ['stock_ledger', 'loose_quantity', 'ALTER TABLE stock_ledger ADD COLUMN loose_quantity INTEGER DEFAULT 0'],
    ['stock_ledger', 'transaction_id', 'ALTER TABLE stock_ledger ADD COLUMN transaction_id TEXT'],
    ['stock_ledger', 'business_date', 'ALTER TABLE stock_ledger ADD COLUMN business_date DATETIME'],
    ['distributor_dispatch_reminders', 'order_source', "ALTER TABLE distributor_dispatch_reminders ADD COLUMN order_source TEXT DEFAULT 'pharmarack'"],
    ['distributor_dispatch_reminders', 'email_received_at', 'ALTER TABLE distributor_dispatch_reminders ADD COLUMN email_received_at DATETIME'],
    // ponytail: source_type records where a staged purchase originated (e.g. 'email', 'telegram')
    // without mixing that into the distributor identity field
    ['staged_purchases', 'source_type', "ALTER TABLE staged_purchases ADD COLUMN source_type TEXT DEFAULT NULL"],
    ['refill_fulfillments', 'cycle_due_date', 'ALTER TABLE refill_fulfillments ADD COLUMN cycle_due_date TEXT'],
    ['refill_fulfillments', 'next_due_date', 'ALTER TABLE refill_fulfillments ADD COLUMN next_due_date TEXT'],
    ['refill_fulfillments', 'fulfilled_via', 'ALTER TABLE refill_fulfillments ADD COLUMN fulfilled_via TEXT'],
    ['refill_fulfillments', 'notes', 'ALTER TABLE refill_fulfillments ADD COLUMN notes TEXT'],
    // catalog_jobs: the base CREATE (id/file_path/status/created_at) predates the whole
    // OCR pipeline — worker + routes read/write these 11 columns on EVERY upload/review,
    // so fresh installs AND long-lived DBs crashed with "no such column" (bug found via
    // catalogPipeline/duplicateCatalog suites, 2026-08-25). Mirrors the stock_ledger case.
    ['catalog_jobs', 'original_filename', 'ALTER TABLE catalog_jobs ADD COLUMN original_filename TEXT'],
    ['catalog_jobs', 'extracted_data', 'ALTER TABLE catalog_jobs ADD COLUMN extracted_data TEXT'],
    ['catalog_jobs', 'mapping_config', 'ALTER TABLE catalog_jobs ADD COLUMN mapping_config TEXT'],
    ['catalog_jobs', 'data_filters', 'ALTER TABLE catalog_jobs ADD COLUMN data_filters TEXT'],
    ['catalog_jobs', 'error_log', 'ALTER TABLE catalog_jobs ADD COLUMN error_log TEXT'],
    ['catalog_jobs', 'progress', 'ALTER TABLE catalog_jobs ADD COLUMN progress INTEGER DEFAULT 0'],
    ['catalog_jobs', 'total_count', 'ALTER TABLE catalog_jobs ADD COLUMN total_count INTEGER DEFAULT 0'],
    ['catalog_jobs', 'processed_count', 'ALTER TABLE catalog_jobs ADD COLUMN processed_count INTEGER DEFAULT 0'],
    ['catalog_jobs', 'new_count', 'ALTER TABLE catalog_jobs ADD COLUMN new_count INTEGER DEFAULT 0'],
    ['catalog_jobs', 'existing_count', 'ALTER TABLE catalog_jobs ADD COLUMN existing_count INTEGER DEFAULT 0'],
    ['catalog_jobs', 'duplicate_count', 'ALTER TABLE catalog_jobs ADD COLUMN duplicate_count INTEGER DEFAULT 0'],
    ['catalog_jobs', 'matched_previous_job_id', 'ALTER TABLE catalog_jobs ADD COLUMN matched_previous_job_id INTEGER DEFAULT NULL'],
    ['catalog_jobs', 'newly_detected_columns', 'ALTER TABLE catalog_jobs ADD COLUMN newly_detected_columns TEXT'],
  ];

  // Pre-check PRAGMA table_info before ALTER TABLE ADD COLUMN to prevent SQLite error outputs
  for (const [table, col, stmt] of alterStatements) {
    try {
      const columns = await db.all(`PRAGMA table_info(${table})`);
      const exists = columns.some((c: any) => c.name.toLowerCase() === col.toLowerCase());
      if (!exists) {
        await db.run(stmt);
      }
    } catch (_e) {}
  }

  // expiry_month: indexed YYYY-MM shadow of the mixed-format expiry_date column.
  // Maintained by triggers below so EVERY write path (purchases, migration, OCR,
  // manual edit) stays in sync with zero route-level code. Normalization mirrors
  // routes/compliance.ts: 'MM/YY' -> '20YY-MM', 'MM/YYYY' -> 'YYYY-MM',
  // 'YYYY-MM-DD' -> 'YYYY-MM'; unparseable formats stay NULL and fall back to
  // JS-side isExpired() checks in consumers.
  try {
    const invColsForExpiryMonth = await db.all('PRAGMA table_info(inventory_master)');
    if (invColsForExpiryMonth.some((c: { name: string }) => c.name === 'expiry_month')) {
      const monthExpr = (ref: string) => `CASE
        WHEN ${ref} IS NULL OR TRIM(${ref}) = '' THEN NULL
        WHEN length(${ref}) = 5 THEN '20' || substr(${ref}, 4, 2) || '-' || substr(${ref}, 1, 2)
        WHEN length(${ref}) = 7 AND ${ref} LIKE '%/%' THEN substr(${ref}, 4, 4) || '-' || substr(${ref}, 1, 2)
        WHEN ${ref} LIKE '____-__%' THEN substr(${ref}, 1, 7)
        ELSE NULL
      END`;
      await db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_inventory_expiry_month_ins
        AFTER INSERT ON inventory_master
        WHEN NEW.expiry_date IS NOT NULL
        BEGIN
          UPDATE inventory_master
          SET expiry_month = ${monthExpr('NEW.expiry_date')}
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_inventory_expiry_month_upd
        AFTER UPDATE OF expiry_date ON inventory_master
        BEGIN
          UPDATE inventory_master
          SET expiry_month = ${monthExpr('NEW.expiry_date')}
          WHERE id = NEW.id;
        END;
      `);
      await db.run(`UPDATE inventory_master SET expiry_month = ${monthExpr('expiry_date')} WHERE expiry_month IS NULL OR expiry_month = ''`);
      await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_expiry_month ON inventory_master (expiry_month)');
    }
  } catch (err) {
    console.warn('[Database] expiry_month trigger/backfill warning:', err);
  }

  try {
    const { backfillInventoryActiveFlags, deactivateExpiredInventory } = await import('./utils/inventoryActive.js');
    const invCols = await db.all('PRAGMA table_info(inventory_master)');
    if (invCols.some((c: { name: string }) => c.name === 'is_active')) {
      await backfillInventoryActiveFlags(db);
      await deactivateExpiredInventory(db);
    }
  } catch (err) {
    console.warn('[Database] inventory is_active backfill warning:', err);
  }

  // Pre-check PRAGMA table_info before ALTER TABLE DROP COLUMN to prevent SQLite error outputs
  const dropStatements: Array<[string, string, string]> = [
    ['medicines', 'manufactured_by', 'ALTER TABLE medicines DROP COLUMN manufactured_by'],
    ['medicines', 'cgst', 'ALTER TABLE medicines DROP COLUMN cgst'],
    ['medicines', 'sgst', 'ALTER TABLE medicines DROP COLUMN sgst'],
    ['medicines', 'igst', 'ALTER TABLE medicines DROP COLUMN igst'],
    ['inventory_master', 'storage_location_id', 'ALTER TABLE inventory_master DROP COLUMN storage_location_id'],
    ['held_bills', 'data', 'ALTER TABLE held_bills DROP COLUMN data']
  ];

  for (const [table, col, stmt] of dropStatements) {
    try {
      const columns = await db.all(`PRAGMA table_info(${table})`);
      const exists = columns.some((c: any) => c.name.toLowerCase() === col.toLowerCase());
      if (exists) {
        await db.run(stmt);
      }
    } catch (_e) {}
  }

  try {
    await db.run("DELETE FROM app_settings WHERE key IN ('delivery_boy_whatsapp', 'dinesh_whatsapp_number')");
  } catch (_e) {}

  // Unify patient contact storage — Backfill customer_id across patient_refills, special_orders, held_bills
  try {
    const { isValidCustomerName } = await import('./utils/nameNormalizer.js');
    const unlinkedRefills = await db.all('SELECT id, patient_name, patient_phone FROM patient_refills WHERE customer_id IS NULL AND patient_phone IS NOT NULL AND patient_phone != ""');
    for (const refill of unlinkedRefills) {
      const phoneClean = refill.patient_phone.trim();
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phoneClean]);
      if (!cust && refill.patient_name && isValidCustomerName(refill.patient_name)) {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [refill.patient_name]);
      }
      if (!cust && phoneClean && refill.patient_name && isValidCustomerName(refill.patient_name)) {
        const res = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [refill.patient_name.trim(), phoneClean]);
        cust = { id: res.lastID };
      }
      if (cust) {
        await db.run('UPDATE patient_refills SET customer_id = ? WHERE id = ?', [cust.id, refill.id]);
      }
    }

    const specialOrdersTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='special_orders'");
    if (specialOrdersTableExists) {
      const unlinkedOrders = await db.all('SELECT id, requester, phone FROM special_orders WHERE customer_id IS NULL AND phone IS NOT NULL AND phone != ""');
      for (const order of unlinkedOrders) {
        const phoneClean = (order.phone || '').trim();
        let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phoneClean]);
        if (!cust && order.requester && isValidCustomerName(order.requester)) {
          cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [order.requester]);
        }
        if (!cust && phoneClean && order.requester && isValidCustomerName(order.requester)) {
          const res = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [order.requester.trim(), phoneClean]);
          cust = { id: res.lastID };
        }
        if (cust) {
          await db.run('UPDATE special_orders SET customer_id = ? WHERE id = ?', [cust.id, order.id]);
        }
      }
    }

    const unlinkedBills = await db.all('SELECT id, patient_name, patient_phone FROM held_bills WHERE customer_id IS NULL AND patient_phone IS NOT NULL AND patient_phone != ""');
    for (const bill of unlinkedBills) {
      const phoneClean = (bill.patient_phone || '').trim();
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phoneClean]);
      if (!cust && bill.patient_name && isValidCustomerName(bill.patient_name)) {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [bill.patient_name]);
      }
      if (!cust && phoneClean && bill.patient_name && isValidCustomerName(bill.patient_name)) {
        const res = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [bill.patient_name.trim(), phoneClean]);
        cust = { id: res.lastID };
      }
      if (cust) {
        await db.run('UPDATE held_bills SET customer_id = ? WHERE id = ?', [cust.id, bill.id]);
      }
    }

    // Purge email strings incorrectly written into phone/contact columns
    await db.run(`
      UPDATE distributors SET
        phone = CASE WHEN phone LIKE '%@%' OR phone LIKE '%<%' OR phone LIKE '%.com%' THEN '' ELSE phone END,
        contact = CASE WHEN contact LIKE '%@%' OR contact LIKE '%<%' OR contact LIKE '%.com%' THEN '' ELSE contact END
      WHERE (phone LIKE '%@%' OR phone LIKE '%<%' OR phone LIKE '%.com%')
         OR (contact LIKE '%@%' OR contact LIKE '%<%' OR contact LIKE '%.com%')
    `);

    // Synchronize distributors contact and phone columns
    await db.run("UPDATE distributors SET phone = contact WHERE (phone IS NULL OR phone = '') AND contact IS NOT NULL AND contact != ''");
    await db.run("UPDATE distributors SET contact = phone WHERE (contact IS NULL OR contact = '') AND phone IS NOT NULL AND phone != ''");

    // Synchronize special_orders product and medicine_name columns to eliminate column name confusion
    await db.run("UPDATE special_orders SET product = medicine_name WHERE (product IS NULL OR product = '') AND medicine_name IS NOT NULL AND medicine_name != ''");
    await db.run("UPDATE special_orders SET medicine_name = product WHERE (medicine_name IS NULL OR medicine_name = '') AND product IS NOT NULL AND product != ''");

    // Sanitize distributors contact table: overwrite legacy contact column with phone so old numbers are purged
    await db.run(`
      UPDATE distributors 
      SET contact = phone 
      WHERE phone IS NOT NULL AND phone != '' AND (contact IS NULL OR contact != phone)
    `);
  } catch (err) {
    console.warn('Customer contact backfill warning:', err);
  }

  // Create index on medicines (item_code) after columns are added
  try {
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_item_code ON medicines (item_code);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_master_quantity ON inventory_master (quantity);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_master_expiry ON inventory_master (expiry_date);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_active_stock ON inventory_master (expiry_date, medicine_id) WHERE is_active = 1 AND quantity > 0');
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_generic_name ON medicines (generic_name);');
    await db.run('CREATE INDEX IF NOT EXISTS idx_medicines_manufacturer ON medicines (manufacturer);');

    // Seed default storage locations if table is empty
    const locCount = await db.get("SELECT COUNT(*) as c FROM storage_locations");
    if (!locCount || locCount.c === 0) {
      await db.run("INSERT OR IGNORE INTO storage_locations (name, code, type, description, is_default, is_active) VALUES ('Main Store', 'MAIN', 'main_store', 'Primary Pharmacy Counter & Shelves', 1, 1)");
      await db.run("INSERT OR IGNORE INTO storage_locations (name, code, type, description, is_default, is_active) VALUES ('Godown 1', 'GDN1', 'godown', 'Main Storage Godown', 0, 1)");
      await db.run("INSERT OR IGNORE INTO storage_locations (name, code, type, description, is_default, is_active) VALUES ('Rack A1', 'RA1', 'rack', 'Front Counter Rack A1', 0, 1)");
      await db.run("INSERT OR IGNORE INTO storage_locations (name, code, type, description, is_default, is_active) VALUES ('Rack B1', 'RB1', 'rack', 'Medicine Rack B1', 0, 1)");
      await db.run("INSERT OR IGNORE INTO storage_locations (name, code, type, description, is_default, is_active) VALUES ('Cold Storage', 'COLD', 'cold_storage', 'Refrigerated Items', 0, 1)");
    }
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

    CREATE TABLE IF NOT EXISTS pending_shortage_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_name TEXT NOT NULL,
      distributor_name TEXT,
      quantity INTEGER DEFAULT 1,
      customer_phone TEXT,
      customer_name TEXT,
      source TEXT DEFAULT 'whatsapp',
      status TEXT CHECK(status IN ('pending', 'inventory_found', 'notified_admin', 'cancelled')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notified_at DATETIME
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
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      source_type TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS medicine_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias_name TEXT NOT NULL UNIQUE,
      medicine_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS distributor_medicine_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      alias_name TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id),
      UNIQUE(distributor_id, alias_name)
    );

    CREATE TABLE IF NOT EXISTS legacy_id_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_id TEXT NOT NULL UNIQUE,
      canonical_medicine_id INTEGER NOT NULL,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(canonical_medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS catalog_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_headers TEXT UNIQUE,
      mapping_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      cn_number TEXT,
      cn_date TEXT,
      amount REAL DEFAULT 0,
      applied_amount REAL DEFAULT 0,
      reason TEXT,
      related_purchase_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (distributor_id) REFERENCES distributors(id),
      FOREIGN KEY (related_purchase_id) REFERENCES purchases(id)
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
      schedule_type TEXT DEFAULT 'general',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS summary_cache (
      cache_key TEXT PRIMARY KEY,
      cache_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS delivery_boys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp_number TEXT,
      telegram_chat_id TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_boys_active ON delivery_boys(is_active);

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      phone TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      notes TEXT,
      alias_names TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pharmarack_distributors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT UNIQUE,
      distributor_code TEXT,
      phone TEXT,
      location TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
      store_name TEXT PRIMARY KEY,
      distributor_id INTEGER,
      phone TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS expiry_return_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      batch_no TEXT NOT NULL,
      expiry_date TEXT,
      quantity REAL NOT NULL,
      distributor_id INTEGER,
      distributor_name TEXT,
      cost_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      proposed_return_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      return_id INTEGER,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_expiry_return_reviews_status ON expiry_return_reviews(status);

    CREATE TABLE IF NOT EXISTS inventory_reorder_snooze (
      medicine_id INTEGER PRIMARY KEY,
      snooze_until TEXT NOT NULL,
      snooze_type TEXT NOT NULL DEFAULT '7_days',
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS refill_fulfillments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refill_id INTEGER NOT NULL,
      customer_id INTEGER,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      medicine_name TEXT,
      quantity_fulfilled INTEGER DEFAULT 1,
      fulfilled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      invoice_id INTEGER,
      invoice_no TEXT,
      payment_status TEXT DEFAULT 'PAID',
      cycle_due_date TEXT,
      next_due_date TEXT,
      fulfilled_via TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refill_fulfillments_refill_id ON refill_fulfillments(refill_id);
    CREATE INDEX IF NOT EXISTS idx_refill_fulfillments_customer_id ON refill_fulfillments(customer_id);

    -- Composite Performance Indexes for High-Traffic Query Endpoints
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_cust_pay ON sales_invoices(customer_id, payment_status, payment_medium);
    CREATE INDEX IF NOT EXISTS idx_sales_date_status ON sales_invoices(date DESC, payment_status);
    CREATE INDEX IF NOT EXISTS idx_purchases_date_dist ON purchases(date DESC, distributor_id);
    CREATE INDEX IF NOT EXISTS idx_customers_credit ON customers(credit_balance, credit_enabled);
    CREATE INDEX IF NOT EXISTS idx_automation_notifications_type_status ON automation_notifications(type, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_special_orders_status_date ON special_orders(status, date DESC);
    CREATE INDEX IF NOT EXISTS idx_medicines_enrichment ON medicines(enrichment_status);
    CREATE INDEX IF NOT EXISTS idx_action_logs_created_type ON action_logs(created_at DESC, action_type);
    CREATE INDEX IF NOT EXISTS idx_medicines_name_mfg ON medicines(name, manufacturer);
    CREATE INDEX IF NOT EXISTS idx_inventory_master_stock ON inventory_master(quantity, loose_quantity);

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

    CREATE TABLE IF NOT EXISTS session_refresh_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      next_scheduled_minutes INTEGER,
      status TEXT NOT NULL,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_refresh_logs_ts ON session_refresh_logs(timestamp);

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

    CREATE TABLE IF NOT EXISTS pending_whatsapp_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      recipient_phone TEXT,
      pdf_path TEXT,
      caption TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      retries INTEGER DEFAULT 0,
      scheduled_at INTEGER
    );
  `);

  try {
    const pCols = await db.all("PRAGMA table_info(pending_whatsapp_jobs)");
    const pNames = pCols.map((c: any) => c.name);
    if (!pNames.includes('scheduled_at')) {
      await db.run("ALTER TABLE pending_whatsapp_jobs ADD COLUMN scheduled_at INTEGER");
    }
  } catch (err) {}

  await db.exec(`
    -- Expiry returns tracking and credit notes reconciliation
    CREATE TABLE IF NOT EXISTS expiry_returns_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER,
      distributor_id INTEGER,
      return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      original_amount REAL,
      loss_percentage REAL NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_distributor_hist_files_dist_id ON distributor_historical_files (distributor_id);

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

    -- Distributor credit notes tracking
    CREATE TABLE IF NOT EXISTS credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER,
      cn_number TEXT,
      cn_date TEXT,
      amount REAL DEFAULT 0,
      applied_amount REAL DEFAULT 0,
      reason TEXT,
      related_purchase_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (distributor_id) REFERENCES distributors(id),
      FOREIGN KEY (related_purchase_id) REFERENCES purchases(id)
    );

    -- Review queue for order-detected emails (manual review, no auto-import)
    CREATE TABLE IF NOT EXISTS email_order_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_uid INTEGER,
      distributor_name TEXT,
      invoice_number TEXT,
      medicines_json TEXT,
      email_subject TEXT,
      email_date TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    -- Permanent Ignore Words (for recon/bounced items & OCR stop words)
    CREATE TABLE IF NOT EXISTS permanently_ignored_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE COLLATE NOCASE,
      source TEXT DEFAULT 'recon',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_piw_word ON permanently_ignored_words (word COLLATE NOCASE);

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

    -- Pharmarack daily batch dispatch: log every verified cart order for morning send
    CREATE TABLE IF NOT EXISTS pharmarack_placed_orders (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_date            TEXT    NOT NULL,   -- YYYY-MM-DD (IST date of placement)
      store_id              INTEGER,
      store_name            TEXT    NOT NULL,
      items_json            TEXT    NOT NULL,   -- [{productName, qty}]
      delivery_persons_json TEXT,               -- [{name, code}]
      placed_at             INTEGER NOT NULL,   -- unix ms
      batch_sent            INTEGER DEFAULT 0,  -- 0=pending, 1=included in batch
      batch_sent_at         INTEGER             -- unix ms when batch sent it
    );
    CREATE INDEX IF NOT EXISTS idx_pharmarack_placed_orders_date ON pharmarack_placed_orders (order_date, batch_sent);
  `);

  // FTS5 trigram index for fast fuzzy medicine name search, rebuilt if unusable
  await ensureMedicinesFts(db);

  // Insert default settings if they don't exist
  await db.run("DELETE FROM app_settings WHERE key = 'medical_name' AND (value = 'XYZ MEDICAL' OR value = 'XYZ Pharmacy')");
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

  // Pharmarack daily batch dispatch defaults
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pharmarack_batch_cycle_start', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pharmarack_batch_window_offset', '0')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pharmarack_batch_last_sent_date', '')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pharmarack_batch_next_offset', '')");

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
            const { emailService, isNonMedicineNoise, cleanMedicineName } = await import('./services/emailService.js');
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
                  const orderInfo = await emailService.extractOrderInfo({
                    subject: email.subject || '',
                    body: email.body || '',
                    from: email.from_addr || '',
                    attachments: []
                  });
                  for (const med of orderInfo.medicines) {
                    parsedItems.push({ name: med.name });
                  }
                }
                const medNames = Array.from(new Set(parsedItems.map(i => cleanMedicineName(i.name)).filter(n => Boolean(n) && !isNonMedicineNoise(n))));
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
    if (subtotalResult && subtotalResult.changes !== undefined && subtotalResult.changes > 0) {
      console.log(`[Database Healing] Backfilled subtotals for ${subtotalResult.changes} invoices.`);
    }

    const discountResult = await db.run(`
      UPDATE sales_invoices
      SET discount = ROUND(subtotal - total_amount)
      WHERE subtotal > total_amount AND (discount IS NULL OR discount = 0);
    `);
    if (discountResult && discountResult.changes !== undefined && discountResult.changes > 0) {
      console.log(`[Database Healing] Backfilled discounts for ${discountResult.changes} invoices.`);
    }

    await db.run(`
      UPDATE sales_invoices
      SET discount = 0
      WHERE discount IS NULL;
    `);
  } catch (healErr) {
    console.warn('[Database Healing] Non-critical warning, failed to run database healing checks:', healErr);
  }

  // Sanitize existing distributor email addresses in DB (e.g. "Name" <email@domain.com> -> email@domain.com)
  try {
    const distsWithEmail = await db.all("SELECT id, email FROM distributors WHERE email IS NOT NULL AND email != ''");
    const { extractCleanEmail } = await import('./utils/emailSanitizer.js');
    for (const dist of distsWithEmail) {
      const clean = extractCleanEmail(dist.email);
      if (clean && clean !== dist.email) {
        console.log(`[Database Migration] Sanitizing distributor #${dist.id} email: "${dist.email}" -> "${clean}"`);
        await db.run("UPDATE distributors SET email = ? WHERE id = ?", [clean, dist.id]);
      }
    }
  } catch (distEmailErr) {
    console.warn('[Database Migration] Failed to clean distributor emails in DB:', distEmailErr);
  }

  // WhatsApp silent-send queue with status, pacing, and retry tracking
  await db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_send_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'distributor_collection',
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      error_message TEXT,
      target_name TEXT
    )
  `);

  // Ensure columns exist for upgraded schemas
  try {
    const queueCols = await db.all("PRAGMA table_info(whatsapp_send_queue)");
    const colNames = queueCols.map((c: any) => c.name);
    if (!colNames.includes('type')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN type TEXT DEFAULT 'distributor_collection'");
    }
    if (!colNames.includes('status')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN status TEXT DEFAULT 'pending'");
    }
    if (!colNames.includes('retry_count')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN retry_count INTEGER DEFAULT 0");
    }
    if (!colNames.includes('error_message')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN error_message TEXT");
    }
    if (!colNames.includes('target_name')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN target_name TEXT");
    }
    if (!colNames.includes('scheduled_at')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN scheduled_at INTEGER");
    }
    if (!colNames.includes('media_url')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN media_url TEXT DEFAULT NULL");
    }
    if (!colNames.includes('file_json')) {
      await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN file_json TEXT DEFAULT NULL");
    }
  } catch (colErr) {
    console.warn('[Database Schema] Column check warning for whatsapp_send_queue:', colErr);
  }

  // Ensure 6 new columns exist on medicines table for upgraded 26-field editor
  try {
    const medCols = await db.all("PRAGMA table_info(medicines)");
    const medColNames = new Set(medCols.map((c: any) => c.name));
    if (!medColNames.has('therapeutic')) {
      await db.run("ALTER TABLE medicines ADD COLUMN therapeutic TEXT DEFAULT NULL").catch(() => {});
    }
    if (!medColNames.has('sub_therapeutic')) {
      await db.run("ALTER TABLE medicines ADD COLUMN sub_therapeutic TEXT DEFAULT NULL").catch(() => {});
    }
    if (!medColNames.has('short_code')) {
      await db.run("ALTER TABLE medicines ADD COLUMN short_code TEXT DEFAULT NULL").catch(() => {});
    }
    if (!medColNames.has('ucode')) {
      await db.run("ALTER TABLE medicines ADD COLUMN ucode TEXT DEFAULT NULL").catch(() => {});
    }
    if (!medColNames.has('disable_auto_barcode')) {
      await db.run("ALTER TABLE medicines ADD COLUMN disable_auto_barcode INTEGER DEFAULT 0").catch(() => {});
    }
    if (!medColNames.has('tb_medicine')) {
      await db.run("ALTER TABLE medicines ADD COLUMN tb_medicine INTEGER DEFAULT 0").catch(() => {});
    }
  } catch (medColErr) {
    console.warn('[Database Schema] Column check warning for medicines:', medColErr);
  }

  // Pacing settings default (min 5s, max 8s)
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', '5000')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', '8000')");

  // WhatsApp Delay Timers defaults (in minutes)
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('whatsapp_delay_credit_bill', '0')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('whatsapp_delay_distributor', '0')");
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('whatsapp_delay_delivery_boy', '0')");

  // WhatsApp message templates for quick CRM sending
  await db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Seed default starter templates if empty
  const tmplCount = await db.get('SELECT COUNT(*) as count FROM whatsapp_message_templates');
  if (!tmplCount || tmplCount.count === 0) {
    const now = Date.now();
    const seedTemplates = [
      { name: 'Refill Reminder', category: 'Patients', body: 'Hello {{name}}, this is a friendly reminder from AI Pharmacy that your prescription for {{medicine}} is due for refill. Reply to confirm order delivery.' },
      { name: 'Payment Dues Reminder', category: 'Patients', body: 'Dear {{name}}, your bill invoice #{{invoice}} of ₹{{amount}} is due. Kindly let us know if you need assistance with payment.' },
      { name: 'Stock Availability Inquiry', category: 'Distributors', body: 'Dear {{distributor}}, please check stock availability and rate for: {{medicines}}. Thank you.' },
      { name: 'General Reply', category: 'General', body: 'Hello! Thank you for contacting AI Pharmacy. How can we help you today?' }
    ];
    for (const t of seedTemplates) {
      await db.run(
        'INSERT INTO whatsapp_message_templates (name, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [t.name, t.category, t.body, now, now]
      );
    }
  }



  // Add missing_license column to compliance_logs (idempotent — SQLite raises an error if the
  // column already exists; we swallow it so this is safe on every boot).
  try {
    await db.run('ALTER TABLE compliance_logs ADD COLUMN missing_license INTEGER DEFAULT 0');
  } catch {
    // Column already exists — no action needed
  }

  // Consolidate legacy 'contact' into 'phone' if 'phone' is empty, then ensure 'phone' is the single source of truth

  try {
    await db.run("UPDATE distributors SET phone = contact WHERE (phone IS NULL OR phone = '') AND contact IS NOT NULL AND contact != ''");
    await db.run("UPDATE distributors SET contact = phone WHERE phone IS NOT NULL AND phone != ''");
  } catch (syncErr) {
    console.warn('[Database Schema] Distributor phone sync warning:', syncErr);
  }

  // Stamp schema version so subsequent boots skip all DDL
  await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('schema_version', ?)", [String(CURRENT_SCHEMA_VERSION)]);
  await db.run("INSERT OR REPLACE INTO schema_migrations (version) VALUES (?)", [CURRENT_SCHEMA_VERSION]);
  console.log(`[Boot] Schema v${CURRENT_SCHEMA_VERSION} applied successfully.`);

  // ponytail: don't close — we reuse the dbManager shared connection
}
