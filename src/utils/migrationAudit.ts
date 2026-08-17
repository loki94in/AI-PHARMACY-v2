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
  suggestedAction?: string;
  suggested_action?: string;
  suggested_user_action?: string;
  suggestedUserAction?: string;
  source_record?: string;
  sourceRecord?: string;
  missing_entity?: string;
  missingEntity?: string;
  reason_unresolved?: string;
  reasonUnresolved?: string;
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

export function getDefaultSuggestedAction(entityType: string, action: string, rawVal?: any): string {
  if (entityType === 'customer') {
    return action === 'preserved_null'
      ? 'Review original sales invoice receipt to verify customer details, or leave as direct OTC walk-in sale.'
      : 'Provide a legitimate customer name in the source file and re-import this record.';
  }
  if (entityType === 'doctor') {
    return action === 'preserved_null'
      ? 'Verify prescriber details on original prescription and link doctor, or leave as OTC without doctor.'
      : 'Provide a legitimate doctor name in the source file and re-import this record.';
  }
  if (entityType === 'distributor') {
    return action === 'preserved_null'
      ? 'Verify distributor in vendor directory, or manually link distributor to this purchase/return invoice.'
      : 'Provide a legitimate distributor name in the source file and re-import this record.';
  }
  if (entityType === 'medicine') {
    return 'Add medicine master entry or correct medicine name mapping before re-importing this item.';
  }
  if (entityType === 'invoice') {
    return 'Check source file for missing or empty invoice number; provide invoice number before importing.';
  }
  return 'Review source record and resolve missing entity manually.';
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
      suggested_action TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    await db.exec('ALTER TABLE migration_audit_log ADD COLUMN suggested_action TEXT');
  } catch (_) {
    // Column already exists
  }
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
  entry: Omit<MigrationAuditRecord, 'timestamp'> & { suggested_action?: string },
  db?: any
): Promise<void> {
  const suggestedAction =
    entry.suggestedAction ||
    entry.suggested_action ||
    entry.suggested_user_action ||
    entry.suggestedUserAction ||
    getDefaultSuggestedAction(entry.entityType, entry.action, entry.rawId);

  const sourceRecord = `${entry.table}: ${entry.recordIdentifier}`;
  const rawIdStr = entry.rawId !== undefined && entry.rawId !== null ? String(entry.rawId) : '';
  const missingEntity = rawIdStr ? `${entry.entityType} ("${rawIdStr}")` : entry.entityType;

  const fullRecord: MigrationAuditRecord = {
    ...entry,
    suggestedAction,
    suggested_action: suggestedAction,
    suggested_user_action: suggestedAction,
    suggestedUserAction: suggestedAction,
    source_record: sourceRecord,
    sourceRecord: sourceRecord,
    missing_entity: missingEntity,
    missingEntity: missingEntity,
    reason_unresolved: entry.reason,
    reasonUnresolved: entry.reason,
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
        `INSERT INTO migration_audit_log (table_name, record_identifier, entity_type, action, reason, raw_id, suggested_action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.table,
          entry.recordIdentifier,
          entry.entityType,
          entry.action,
          entry.reason,
          entry.rawId !== undefined && entry.rawId !== null ? String(entry.rawId) : null,
          suggestedAction,
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
        'SELECT table_name as "table", record_identifier as recordIdentifier, entity_type as entityType, action, reason, raw_id as rawId, suggested_action as suggestedAction, created_at as timestamp FROM migration_audit_log ORDER BY id ASC'
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

        const suggestedAction = r.suggestedAction || getDefaultSuggestedAction(r.entityType, r.action, r.rawId);
        const sourceRecord = `${r.table}: ${r.recordIdentifier}`;
        const rawIdStr = r.rawId !== undefined && r.rawId !== null ? String(r.rawId) : '';
        const missingEntity = rawIdStr ? `${r.entityType} ("${rawIdStr}")` : r.entityType;

        return {
          table: r.table,
          recordIdentifier: r.recordIdentifier,
          entityType: r.entityType,
          action: r.action,
          reason: r.reason,
          rawId: r.rawId,
          suggestedAction,
          suggested_action: suggestedAction,
          suggested_user_action: suggestedAction,
          suggestedUserAction: suggestedAction,
          source_record: sourceRecord,
          sourceRecord: sourceRecord,
          missing_entity: missingEntity,
          missingEntity: missingEntity,
          reason_unresolved: r.reason,
          reasonUnresolved: r.reason,
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
  suggested_action?: string;
  suggestedAction?: string;
  suggested_user_action?: string;
  suggestedUserAction?: string;
}): void {
  recordAuditEntry({
    table: entry.table || entry.record_type || 'sales_invoices',
    recordIdentifier: entry.record_identifier || 'UNKNOWN',
    entityType: entry.entity_type,
    action: entry.action || entry.status || 'preserved_null',
    reason: entry.reason,
    rawId: entry.rawId !== undefined ? entry.rawId : entry.raw_value,
    suggestedAction: entry.suggestedAction || entry.suggested_action || entry.suggested_user_action || entry.suggestedUserAction,
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
    suggested_action?: string;
    suggestedAction?: string;
    suggested_user_action?: string;
    suggestedUserAction?: string;
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
      suggestedAction: entry.suggestedAction || entry.suggested_action || entry.suggested_user_action || entry.suggestedUserAction,
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
        `SELECT id, table_name as record_type, table_name, record_identifier, entity_type, raw_id as raw_value, raw_id, action as status, action, reason, suggested_action, created_at
         FROM migration_audit_log
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      if (total > 0) {
        const enriched = dbRows.map((r: any) => {
          const suggestedAction = r.suggested_action || getDefaultSuggestedAction(r.entity_type, r.action, r.raw_value);
          const sourceRecord = `${r.table_name || r.record_type}: ${r.record_identifier}`;
          const rawIdStr = r.raw_value !== undefined && r.raw_value !== null ? String(r.raw_value) : '';
          const missingEntity = rawIdStr ? `${r.entity_type} ("${rawIdStr}")` : r.entity_type;

          return {
            id: r.id,
            table: r.table_name,
            table_name: r.table_name,
            record_type: r.record_type,
            recordIdentifier: r.record_identifier,
            record_identifier: r.record_identifier,
            source_record: sourceRecord,
            sourceRecord: sourceRecord,
            entityType: r.entity_type,
            entity_type: r.entity_type,
            missing_entity: missingEntity,
            missingEntity: missingEntity,
            rawId: r.raw_value,
            raw_id: r.raw_value,
            raw_value: r.raw_value,
            action: r.action,
            status: r.status,
            reason: r.reason,
            reason_unresolved: r.reason,
            reasonUnresolved: r.reason,
            suggested_action: suggestedAction,
            suggestedAction: suggestedAction,
            suggested_user_action: suggestedAction,
            suggestedUserAction: suggestedAction,
            created_at: r.created_at,
            timestamp: r.created_at,
          };
        });
        return { rows: enriched, total };
      }
    } catch (_) {}
  }

  // Fallback to in-memory records
  const total = inMemoryRecords.length;
  const sliced = inMemoryRecords.slice(offset, offset + limit).map((r, i) => {
    const suggestedAction = r.suggestedAction || getDefaultSuggestedAction(r.entityType, r.action, r.rawId);
    const sourceRecord = `${r.table}: ${r.recordIdentifier}`;
    const rawIdStr = r.rawId !== undefined && r.rawId !== null ? String(r.rawId) : '';
    const missingEntity = rawIdStr ? `${r.entityType} ("${rawIdStr}")` : r.entityType;

    return {
      id: offset + i + 1,
      table: r.table,
      table_name: r.table,
      record_type: r.table,
      recordIdentifier: r.recordIdentifier,
      record_identifier: r.recordIdentifier,
      source_record: sourceRecord,
      sourceRecord: sourceRecord,
      entityType: r.entityType,
      entity_type: r.entityType,
      missing_entity: missingEntity,
      missingEntity: missingEntity,
      rawId: r.rawId,
      raw_id: r.rawId,
      raw_value: r.rawId,
      action: r.action,
      status: r.action,
      reason: r.reason,
      reason_unresolved: r.reason,
      reasonUnresolved: r.reason,
      suggested_action: suggestedAction,
      suggestedAction: suggestedAction,
      suggested_user_action: suggestedAction,
      suggestedUserAction: suggestedAction,
      created_at: r.timestamp,
      timestamp: r.timestamp,
    };
  });

  return { rows: sliced, total };
}

export async function flushMigrationAudits(db?: any): Promise<void> {
  if (db && typeof db.run === 'function') {
    await ensureMigrationAuditTable(db);
    while (pendingQueue.length > 0) {
      const entry = pendingQueue.shift()!;
      const suggestedAction =
        entry.suggestedAction ||
        entry.suggested_action ||
        entry.suggested_user_action ||
        getDefaultSuggestedAction(entry.entityType, entry.action, entry.rawId);
      try {
        await db.run(
          `INSERT INTO migration_audit_log (table_name, record_identifier, entity_type, action, reason, raw_id, suggested_action)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.table,
            entry.recordIdentifier,
            entry.entityType,
            entry.action,
            entry.reason,
            entry.rawId !== undefined && entry.rawId !== null ? String(entry.rawId) : null,
            suggestedAction,
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


