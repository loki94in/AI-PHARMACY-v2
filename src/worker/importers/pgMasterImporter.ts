/**
 * PostgreSQL → SQLite Importer for reference/master data tables:
 *   - category → in-memory map
 *   - manufacturer → in-memory map
 *   - distributor → distributors table
 *   - doctor → doctors table
 *   - patient → customers table
 *   - medicine → medicines table
 */

import { Database } from 'sqlite';
import { normalizeDistributorName } from '../../utils/migrationValidation.js';

// In-memory lookup maps (legacy_id → new SQLite id)
export const categoryMap = new Map<string, string>();       // legacy_id → category_name
export const manufacturerMap = new Map<string, string>();   // legacy_id → manufacturer_name
export const distributorMap = new Map<string, number>();    // legacy_id → new id
export const doctorMap = new Map<string, number>();         // legacy_id → new id
export const patientMap = new Map<string, number>();        // legacy_id → new id (→ customers)
export const medicineMap = new Map<string, number>();       // legacy_id → new id
export const customerMap = new Map<string, number>();       // legacy customer_id → new id (B2B)
export const genericMap = new Map<string, string>();        // legacy generic_id → generic/composition name

export function clearAllMaps() {
  categoryMap.clear();
  manufacturerMap.clear();
  distributorMap.clear();
  normalizedDistributorMap.clear();
  doctorMap.clear();
  patientMap.clear();
  medicineMap.clear();
  customerMap.clear();
  genericMap.clear();
}

// ─── Category ───────────────────────────────────────────────
export function importCategory(row: Record<string, string | null>) {
  const id = row['category_id'];
  const name = row['category_name'];
  const deleted = row['deleted'];
  if (!id || !name || deleted === 't') return;
  categoryMap.set(id, name);
}

// ─── Manufacturer ───────────────────────────────────────────
export function importManufacturer(row: Record<string, string | null>) {
  const id = row['manufacturer_id'];
  const name = row['manufacturer_name'];
  const deleted = row['deleted'];
  if (!id || !name || deleted === 't') return;
  manufacturerMap.set(id, name);
}

// ─── Distributor ────────────────────────────────────────────
let distributorBatch: any[] = [];
const normalizedDistributorMap = new Map<string, number>();

export async function importDistributor(row: Record<string, string | null>, db: Database) {
  const legacyId = row['distributor_id'];
  const name = row['distributor_name'];
  const deleted = row['deleted'];
  if (!legacyId || !name || deleted === 't') return;

  const normName = normalizeDistributorName(name);
  if (normalizedDistributorMap.has(normName)) {
      distributorMap.set(legacyId, normalizedDistributorMap.get(normName)!);
      return; // Skip duplicate
  }

  distributorBatch.push({
    name: name,
    normName: normName,
    contact: row['contact'] || row['distributor_sales_mobile'] || null,
    legacy_id: legacyId,
    gstin: row['distributor_gstin'] || null,
    address: row['address'] || null,
    city: row['city'] || null,
    email: row['email'] || null,
    dl_no: row['dlno'] || null,
    phone: row['distributor_sales_phone'] || row['contact'] || null,
    state_code: row['gst_state'] || null,
  });

  if (distributorBatch.length >= 500) {
    await flushDistributors(db);
  }
}

export async function flushDistributors(db: Database) {
  if (distributorBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const d of distributorBatch) {
      try {
        const result = await db.run(
          `INSERT INTO distributors (name, contact, legacy_id, gstin, address, city, email, dl_no, phone, state_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.name, d.contact, d.legacy_id, d.gstin, d.address, d.city, d.email, d.dl_no, d.phone, d.state_code]
        );
        distributorMap.set(d.legacy_id, result.lastID!);
        normalizedDistributorMap.set(d.normName, result.lastID!);
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE constraint failed: distributors.name')) {
          // Retrieve existing distributor's ID to preserve mappings
          const row = await db.get('SELECT id FROM distributors WHERE name = ?', [d.name]);
          if (row) {
            distributorMap.set(d.legacy_id, row.id);
            normalizedDistributorMap.set(d.normName, row.id);
            // Link legacy_id on existing record if it is not already set
            await db.run('UPDATE distributors SET legacy_id = COALESCE(legacy_id, ?) WHERE id = ?', [d.legacy_id, row.id]);
          } else {
            // Check by case-insensitive name matching if name isn't exactly equal due to unicode/whitespace differences
            const rows = await db.all('SELECT id, name FROM distributors');
            const matched = rows.find(r => normalizeDistributorName(r.name) === d.normName);
            if (matched) {
              distributorMap.set(d.legacy_id, matched.id);
              normalizedDistributorMap.set(d.normName, matched.id);
              await db.run('UPDATE distributors SET legacy_id = COALESCE(legacy_id, ?) WHERE id = ?', [d.legacy_id, matched.id]);
            } else {
              throw err;
            }
          }
        } else {
          throw err;
        }
      }
    }
    await db.run('COMMIT');
    distributorBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Doctor ─────────────────────────────────────────────────
let doctorBatch: any[] = [];

export async function importDoctor(row: Record<string, string | null>, db: Database) {
  const legacyId = row['doctor_id'];
  const name = row['doctor_name'];
  const deleted = row['deleted'];
  if (!legacyId || !name || deleted === 't') return;

  doctorBatch.push({
    name,
    degree: row['qualification'] || row['doctor_qualifications'] || null,
    reg_no: row['registration_no'] || null,
    hospital: row['doctor_hospital'] || null,
    phone: row['doctor_phone'] || null,
    address: row['doctor_address'] || null,
    legacy_id: legacyId,
    speciality: row['speciality'] || null,
  });

  if (doctorBatch.length >= 500) {
    await flushDoctors(db);
  }
}

export async function flushDoctors(db: Database) {
  if (doctorBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const d of doctorBatch) {
      try {
        const result = await db.run(
          `INSERT INTO doctors (name, degree, reg_no, hospital, phone, address, legacy_id, speciality)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.name, d.degree, d.reg_no, d.hospital, d.phone, d.address, d.legacy_id, d.speciality]
        );
        doctorMap.set(d.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped doctor ${d.name}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    doctorBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Patient → Customers ───────────────────────────────────
let patientBatch: any[] = [];

export async function importPatient(row: Record<string, string | null>, db: Database) {
  const legacyId = row['patient_id'];
  const name = row['patient_name'];
  const deleted = row['deleted'];
  if (!legacyId || !name || deleted === 't') return;

  patientBatch.push({
    name,
    phone: row['patient_phone'] || null,
    address: row['patient_address'] || null,
    notes: row['remarks'] || null,
    legacy_id: legacyId,
    age: row['age'] || null,
    gender: row['gender'] || null,
  });

  if (patientBatch.length >= 1000) {
    await flushPatients(db);
  }
}

export async function flushPatients(db: Database) {
  if (patientBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const p of patientBatch) {
      try {
        const result = await db.run(
          `INSERT INTO customers (name, phone, address, notes, legacy_id, age, gender)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [p.name, p.phone, p.address, p.notes, p.legacy_id, p.age, p.gender]
        );
        patientMap.set(p.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped patient ${p.name}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    patientBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Generic → medicine composition/API reference ───────────
export function importGeneric(row: Record<string, string | null>) {
  const id = row['generic_id'];
  const name = row['generic_name'];
  if (!id || !name) return;
  genericMap.set(id, name);
}

// ─── Customer (B2B) → customers table ───────────────────────
let customerBatch: any[] = [];

export async function importCustomer(row: Record<string, string | null>, db: Database) {
  const legacyId = row['customer_id'];
  const name = row['customer_name'];
  const deleted = row['deleted'];
  if (!legacyId || !name || deleted === 't') return;

  customerBatch.push({
    name,
    phone: row['contact'] || null,
    address: row['address'] || null,
    notes: row['remarks'] || null,
    legacy_id: `cust_${legacyId}`, // prefix to avoid clash with patient legacy_ids
    age: null,
    gender: null,
    credit_enabled: 1,
    credit_balance: parseFloat(row['opening_balance'] || '0') || 0,
  });

  if (customerBatch.length >= 500) {
    await flushCustomers(db);
  }
}

export async function flushCustomers(db: Database) {
  if (customerBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const c of customerBatch) {
      try {
        const result = await db.run(
          `INSERT INTO customers (name, phone, address, notes, legacy_id, age, gender, credit_enabled, credit_balance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.name, c.phone, c.address, c.notes, c.legacy_id, c.age, c.gender, c.credit_enabled, c.credit_balance]
        );
        // Store with prefixed key so resolveCustomer can find it
        customerMap.set(c.legacy_id.replace('cust_', ''), result.lastID!);
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE constraint')) {
          const existing = await db.get('SELECT id FROM customers WHERE legacy_id = ?', [c.legacy_id]);
          if (existing) customerMap.set(c.legacy_id.replace('cust_', ''), existing.id);
        }
      }
    }
    await db.run('COMMIT');
    customerBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Medicine ───────────────────────────────────────────────
let medicineBatch: any[] = [];
const MEDICINE_BATCH_SIZE = 5000;

export async function importMedicine(row: Record<string, string | null>, db: Database) {
  const legacyId = row['medicine_id'];
  const name = row['medicine_name'];
  const deleted = row['deleted'];
  if (!legacyId || !name || deleted === 't') return;

  // Resolve manufacturer name
  const mfgId = row['manufacturer_id'];
  const mfgName = row['manufacturer_name'] || (mfgId ? manufacturerMap.get(mfgId) : null) || null;

  // Resolve category name
  const catId = row['category_id'];
  const catName = catId ? categoryMap.get(catId) : null;

  // Resolve generic/composition name from genericMap
  const genericId = row['generic_id'];
  const apiReference = genericId ? (genericMap.get(genericId) || null) : null;

  // Build metadata JSON for extra fields not in the main schema
  const metadata: Record<string, any> = {};
  if (row['is_chronic'] === 't') metadata.is_chronic = true;
  if (row['is_banned'] === 't') metadata.is_banned = true;
  if (row['is_discontinued'] === 't') metadata.is_discontinued = true;
  if (row['selling_price']) metadata.selling_price = parseFloat(row['selling_price']) || 0;
  if (row['min_stock']) metadata.min_stock = parseInt(row['min_stock']) || 0;
  if (row['max_stock']) metadata.max_stock = parseInt(row['max_stock']) || 0;
  if (row['is_loose'] === 't') metadata.is_loose = true;
  const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

  medicineBatch.push({
    name,
    legacy_id: legacyId,
    hsn_code: row['hsn_code'] || null,
    manufacturer: mfgName,
    category: catName || null,
    packaging: row['medicine_packaging'] || null,
    item_type: row['itemtype'] || null,
    cgst: parseFloat(row['cgst'] || '0') || 0,
    sgst: parseFloat(row['sgst'] || '0') || 0,
    igst: parseFloat(row['igst'] || '0') || 0,
    rack: row['rack'] || null,
    marketed_by: row['marketer_name'] || null,
    schedule_type: row['therapeutic'] || 'None',
    api_reference: apiReference,
    generic_name: apiReference, // generic_name mirrors composition from genericMap
    item_code: row['medicine_short_code'] || row['mdm_itemcode'] || null,
    metadata: metadataJson,
  });

  if (medicineBatch.length >= MEDICINE_BATCH_SIZE) {
    await flushMedicines(db);
  }
}

export async function flushMedicines(db: Database) {
  if (medicineBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const m of medicineBatch) {
      try {
        const result = await db.run(
          `INSERT INTO medicines (name, legacy_id, hsn_code, manufacturer, category, packaging, item_type, cgst, sgst, igst, rack, marketed_by, schedule_type, api_reference, generic_name, item_code, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.name, m.legacy_id, m.hsn_code, m.manufacturer, m.category, m.packaging, m.item_type, m.cgst, m.sgst, m.igst, m.rack, m.marketed_by, m.schedule_type, m.api_reference || null, m.generic_name || null, m.item_code || null, m.metadata || null]
        );
        medicineMap.set(m.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped medicine ${m.name}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    medicineBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}
