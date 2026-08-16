/**
 * Migration Audit Tracker & Reporting
 * Tracks unresolved relationships (customers, doctors, etc.) during database migrations.
 * Enforces zero phantom/arbitrary ID fallbacks (e.g. customerId || 1, doctorId || 1).
 */

export interface MigrationAuditRecord {
  table: string;
  recordIdentifier: string;
  entityType: 'customer' | 'doctor' | 'distributor' | 'medicine' | 'invoice' | 'other';
  action: 'preserved_null' | 'skipped';
  reason: string;
  rawId?: string | number | null;
  timestamp: string;
}

export interface MigrationAuditSummary {
  unresolvedCustomers: number;
  unresolvedDoctors: number;
  unresolvedDistributors: number;
  unresolvedMedicines: number;
  skippedRecords: number;
  preservedNullRecords: number;
  totalAuditEntries: number;
  records: MigrationAuditRecord[];
}

const inMemoryRecords: MigrationAuditRecord[] = [];
const pendingQueue: MigrationAuditRecord[] = [];
let unresolvedCustomersCount = 0;
let unresolvedDoctorsCount = 0;
let unresolvedDistributorsCount = 0;
let unresolvedMedicinesCount = 0;
let skippedRecordsCount = 0;
let preservedNullRecordsCount = 0;

export async function ensureMigrationAuditTable(db: any): Promise<void> {
  if (!db || typeof db.exec !== 'function') return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS migration_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      record_identifier TEXT,
      entity_type TEXT,
      action TEXT,
      reason TEXT,
      raw_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function clearMigrationAudit(db?: any): Promise<void> {
  inMemoryRecords.length = 0;
  pendingQueue.length = 0;
  unresolvedCustomersCount = 0;
  unresolvedDoctorsCount = 0;
  unresolvedDistributorsCount = 0;
  unresolvedMedicinesCount = 0;
  skippedRecordsCount = 0;
  preservedNullRecordsCount = 0;

  if (db && typeof db.run === 'function') {
    try {
      await ensureMigrationAuditTable(db);
      await db.run('DELETE FROM migration_audit_log');
      await db.run('DELETE FROM app_settings WHERE key = ?', ['migration_audit_summary']);
    } catch (_) {
      // Non-fatal if table not present
    }
  }
}

export async function recordAuditEntry(
  entry: Omit<MigrationAuditRecord, 'timestamp'>,
  db?: any
): Promise<void> {
  const fullRecord: MigrationAuditRecord = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  inMemoryRecords.push(fullRecord);

  if (entry.entityType === 'customer') {
    unresolvedCustomersCount++;
  } else if (entry.entityType === 'doctor') {
    unresolvedDoctorsCount++;
  } else if (entry.entityType === 'distributor') {
    unresolvedDistributorsCount++;
  } else if (entry.entityType === 'medicine') {
    unresolvedMedicinesCount++;
  }

  if (entry.action === 'skipped') {
    skippedRecordsCount++;
  } else if (entry.action === 'preserved_null') {
    preservedNullRecordsCount++;
  }

  if (db && typeof db.run === 'function') {
    try {
      await ensureMigrationAuditTable(db);
      await db.run(
        `INSERT INTO migration_audit_log (table_name, record_identifier, entity_type, action, reason, raw_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          entry.table,
          entry.recordIdentifier,
          entry.entityType,
          entry.action,
          entry.reason,
          entry.rawId !== undefined && entry.rawId !== null ? String(entry.rawId) : null,
        ]
      );
    } catch (_) {
      // Non-fatal database logging failure
    }
  } else {
    pendingQueue.push(fullRecord);
  }
}

export async function getMigrationAuditSummary(db?: any): Promise<MigrationAuditSummary> {
  // If in-memory records exist, return current summary
  if (inMemoryRecords.length > 0) {
    return {
      unresolvedCustomers: unresolvedCustomersCount,
      unresolvedDoctors: unresolvedDoctorsCount,
      unresolvedDistributors: unresolvedDistributorsCount,
      unresolvedMedicines: unresolvedMedicinesCount,
      skippedRecords: skippedRecordsCount,
      preservedNullRecords: preservedNullRecordsCount,
      totalAuditEntries: inMemoryRecords.length,
      records: [...inMemoryRecords],
    };
  }

  // Otherwise try to load from database
  if (db && typeof db.all === 'function') {
    try {
      await ensureMigrationAuditTable(db);
      const rows = await db.all(
        'SELECT table_name as "table", record_identifier as recordIdentifier, entity_type as entityType, action, reason, raw_id as rawId, created_at as timestamp FROM migration_audit_log ORDER BY id ASC'
      );

      let custCount = 0;
      let docCount = 0;
      let distCount = 0;
      let medCount = 0;
      let skipped = 0;
      let preservedNull = 0;

      const records: MigrationAuditRecord[] = rows.map((r: any) => {
        if (r.entityType === 'customer') custCount++;
        if (r.entityType === 'doctor') docCount++;
        if (r.entityType === 'distributor') distCount++;
        if (r.entityType === 'medicine') medCount++;
        if (r.action === 'skipped') skipped++;
        if (r.action === 'preserved_null') preservedNull++;

        return {
          table: r.table,
          recordIdentifier: r.recordIdentifier,
          entityType: r.entityType,
          action: r.action,
          reason: r.reason,
          rawId: r.rawId,
          timestamp: r.timestamp,
        };
      });

      return {
        unresolvedCustomers: custCount,
        unresolvedDoctors: docCount,
        unresolvedDistributors: distCount,
        unresolvedMedicines: medCount,
        skippedRecords: skipped,
        preservedNullRecords: preservedNull,
        totalAuditEntries: records.length,
        records,
      };
    } catch (_) {
      // If table query fails, check app_settings
    }

    try {
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', ['migration_audit_summary']);
      if (row?.value) {
        return JSON.parse(row.value);
      }
    } catch (_) {}
  }

  return {
    unresolvedCustomers: 0,
    unresolvedDoctors: 0,
    unresolvedDistributors: 0,
    unresolvedMedicines: 0,
    skippedRecords: 0,
    preservedNullRecords: 0,
    totalAuditEntries: 0,
    records: [],
  };
}

export async function saveMigrationAuditSummary(db: any): Promise<void> {
  if (!db || typeof db.run !== 'function') return;
  const summary = await getMigrationAuditSummary(db);
  try {
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    await db.run(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
      ['migration_audit_summary', JSON.stringify(summary)]
    );
  } catch (_) {}
}

export function queueMigrationAudit(entry: {
  file_name?: string;
  record_type?: string;
  table?: string;
  record_identifier?: string;
  entity_type: 'customer' | 'doctor' | 'distributor' | 'medicine' | 'invoice' | 'other';
  raw_value?: any;
  rawId?: any;
  status?: 'preserved_null' | 'skipped';
  action?: 'preserved_null' | 'skipped';
  reason: string;
}): void {
  recordAuditEntry({
    table: entry.table || entry.record_type || 'sales_invoices',
    recordIdentifier: entry.record_identifier || 'UNKNOWN',
    entityType: entry.entity_type,
    action: entry.action || entry.status || 'preserved_null',
    reason: entry.reason,
    rawId: entry.rawId !== undefined ? entry.rawId : entry.raw_value,
  });
}

export async function recordMigrationAudit(
  db: any,
  entry: {
    file_name?: string;
    record_type?: string;
    table?: string;
    record_identifier?: string;
    entity_type: 'customer' | 'doctor' | 'distributor' | 'medicine' | 'invoice' | 'other';
    raw_value?: any;
    rawId?: any;
    status?: 'preserved_null' | 'skipped';
    action?: 'preserved_null' | 'skipped';
    reason: string;
  }
): Promise<void> {
  await recordAuditEntry(
    {
      table: entry.table || entry.record_type || 'sales_invoices',
      recordIdentifier: entry.record_identifier || 'UNKNOWN',
      entityType: entry.entity_type,
      action: entry.action || entry.status || 'preserved_null',
      reason: entry.reason,
      rawId: entry.rawId !== undefined ? entry.rawId : entry.raw_value,
    },
    db
  );
}

export async function getMigrationAuditRecords(
  db?: any,
  limit: number = 500,
  offset: number = 0
): Promise<{ rows: any[]; total: number }> {
  if (db && typeof db.all === 'function') {
    try {
      await ensureMigrationAuditTable(db);
      const countRow = await db.get('SELECT COUNT(*) as cnt FROM migration_audit_log');
      const total = countRow?.cnt || 0;
      const dbRows = await db.all(
        `SELECT id, table_name as record_type, record_identifier, entity_type, raw_id as raw_value, action as status, reason, created_at
         FROM migration_audit_log
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      if (total > 0) {
        return { rows: dbRows, total };
      }
    } catch (_) {}
  }

  // Fallback to in-memory records
  const total = inMemoryRecords.length;
  const sliced = inMemoryRecords.slice(offset, offset + limit).map((r, i) => ({
    id: offset + i + 1,
    record_type: r.table,
    record_identifier: r.recordIdentifier,
    entity_type: r.entityType,
    raw_value: r.rawId,
    status: r.action,
    reason: r.reason,
    created_at: r.timestamp,
  }));

  return { rows: sliced, total };
}

export async function flushMigrationAudits(db?: any): Promise<void> {
  if (db && typeof db.run === 'function') {
    await ensureMigrationAuditTable(db);
    while (pendingQueue.length > 0) {
      const entry = pendingQueue.shift()!;
      try {
        await db.run(
          `INSERT INTO migration_audit_log (table_name, record_identifier, entity_type, action, reason, raw_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            entry.table,
            entry.recordIdentifier,
            entry.entityType,
            entry.action,
            entry.reason,
            entry.rawId !== undefined && entry.rawId !== null ? String(entry.rawId) : null,
          ]
        );
      } catch (_) {}
    }
    await saveMigrationAuditSummary(db);
  }
}

export function clearMigrationAuditQueue(): void {
  clearMigrationAudit();
}

