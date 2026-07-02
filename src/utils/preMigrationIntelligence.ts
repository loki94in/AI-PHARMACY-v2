import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { normalizeDate } from './migrationUtils.js';

// Auto-detect which data modules are present based on column headers
export function detectDataModules(headers: string[]): { type: string; confidence: number }[] {
  const lowercaseHeaders = headers.map(h => h.toLowerCase().trim());
  const modules: { type: string; confidence: number }[] = [];

  // Matcher keywords
  const mappings = {
    inventory: ['quantity', 'stock', 'qty', 'rack', 'batch', 'expiry'],
    purchases: ['purchase', 'cost', 'distributor', 'supplier', 'bill_no', 'invoice_no'],
    sales: ['sales', 'patient', 'customer', 'doctor', 'invoice_no', 'bill_no', 'total_amount'],
    returns: ['return', 'return_no', 'refund'],
  };

  for (const [mod, keywords] of Object.entries(mappings)) {
    let matches = 0;
    keywords.forEach(kw => {
      if (lowercaseHeaders.some(h => h.includes(kw))) matches++;
    });
    if (matches > 0) {
      modules.push({ type: mod, confidence: matches / keywords.length });
    }
  }

  // Always suggest Medicine Master if there is a name
  if (lowercaseHeaders.some(h => h.includes('name') || h.includes('item') || h.includes('product'))) {
    modules.push({ type: 'medicine_master', confidence: 0.9 });
  }

  return modules.sort((a, b) => b.confidence - a.confidence);
}

// Map column names to standard DB fields based on heuristics
export function autoMapColumn(header: string): string {
  const h = header.toLowerCase().trim();
  if (h === 'id' || h === 'code') return '';
  if (h.includes('medicine') || h.includes('name') || h.includes('product') || h.includes('item')) return 'name';
  if (h.includes('batch')) return 'batch_no';
  if (h.includes('expiry') || h.includes('exp')) return 'expiry_date';
  if (h.includes('quantity') || h.includes('qty') || h.includes('stock')) return 'quantity';
  if (h.includes('loose') || h.includes('unit')) return 'loose_qty';
  if (h.includes('pack')) return 'packaging';
  if (h.includes('mrp') || h.includes('price')) return 'mrp';
  if (h.includes('cost') || h.includes('purchase')) return 'cost_price';
  if (h.includes('rack') || h.includes('loc')) return 'rack_location';
  if (h.includes('invoice') || h.includes('bill')) return 'invoice_no';
  if (h.includes('return')) return 'return_no';
  if (h.includes('date')) return 'date';
  if (h.includes('total') || h.includes('amount')) return 'total_amount';
  if (h.includes('patient') || h.includes('customer')) return 'patient_name';
  if (h.includes('distributor') || h.includes('supplier')) return 'distributor_name';
  if (h.includes('doctor')) return 'doctor_name';
  if (h.includes('phone') || h.includes('mobile')) return 'phone';
  if (h.includes('address')) return 'address';
  if (h.includes('notes') || h.includes('remark')) return 'notes';
  return '';
}

// Evaluate smart filter constraints
export function matchesFilters(row: any, mapping: Record<string, string>, filters: any): boolean {
  if (!filters) return true;

  // Filter: Only active stock
  if (filters.onlyActiveStock) {
    const qtyKey = Object.keys(mapping).find(k => mapping[k] === 'quantity');
    if (qtyKey) {
      const val = parseFloat(row[qtyKey]);
      if (isNaN(val) || val <= 0) return false;
    }
  }

  // Filter: Exclude expired stock
  if (filters.excludeExpired) {
    const expKey = Object.keys(mapping).find(k => mapping[k] === 'expiry_date');
    if (expKey) {
      const normalized = normalizeDate(String(row[expKey] || ''));
      if (normalized) {
        const expDate = new Date(normalized);
        const today = new Date();
        if (expDate < today) return false;
      }
    }
  }

  // Filter: Min purchase date
  if (filters.minPurchaseDate) {
    const dateKey = Object.keys(mapping).find(k => mapping[k] === 'date');
    if (dateKey) {
      const normalized = normalizeDate(String(row[dateKey] || ''));
      if (normalized) {
        const rowDate = new Date(normalized);
        const minDate = new Date(filters.minPurchaseDate);
        if (rowDate < minDate) return false;
      }
    }
  }

  return true;
}

// Run simulation to predict changes on SQLite database
export function runSimulation(
  samples: any[],
  mapping: Record<string, string>,
  dataType: string,
  existingMedicines: string[]
): { created: number; updated: number; skipped: number } {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const existingMedsSet = new Set(existingMedicines.map(m => m.toLowerCase().trim()));
  const nameKey = Object.keys(mapping).find(k => mapping[k] === 'name');

  samples.forEach(row => {
    if (!nameKey || !row[nameKey]) {
      skipped++;
      return;
    }

    const medName = String(row[nameKey]).toLowerCase().trim();
    if (existingMedsSet.has(medName)) {
      updated++;
    } else {
      created++;
      existingMedsSet.add(medName); // Prevent double counting duplicate imports in the same sheet
    }
  });

  return { created, updated, skipped };
}

export interface ValidationWarning {
  type: string;
  message: string;
  affectedCount: number;
}

export function runValidationCheck(
  rows: any[],
  mapping: Record<string, string>,
  dataType: string
): { isValid: boolean; warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];
  const lowercaseMapping = Object.entries(mapping).reduce((acc, [k, v]) => {
    acc[k.trim()] = v.trim();
    return acc;
  }, {} as Record<string, string>);

  const getSourceCol = (target: string) => {
    return Object.keys(lowercaseMapping).find(k => lowercaseMapping[k] === target);
  };

  // Define mandatory targets for the chosen module
  let mandatoryFields: string[] = [];
  if (dataType === 'inventory') {
    mandatoryFields = ['name', 'batch_no', 'expiry_date', 'quantity'];
  } else if (dataType === 'purchases') {
    mandatoryFields = ['invoice_no', 'name', 'batch_no', 'quantity', 'distributor_name'];
  } else if (dataType === 'sales') {
    mandatoryFields = ['invoice_no', 'name', 'batch_no', 'quantity', 'patient_name'];
  } else if (dataType === 'returns') {
    mandatoryFields = ['name', 'batch_no', 'expiry_date', 'quantity'];
  } else if (dataType === 'customers') {
    mandatoryFields = ['name'];
  } else if (dataType === 'combined') {
    mandatoryFields = ['name'];
  }

  // A. Check for unmapped mandatory columns
  mandatoryFields.forEach(field => {
    const src = getSourceCol(field);
    if (!src) {
      warnings.push({
        type: 'missing_mapping',
        message: `Mandatory field "${field}" is not mapped to any column.`,
        affectedCount: rows.length
      });
    }
  });

  // B. Row-by-row checks
  let emptyMandatoryCount = 0;
  let invalidDateCount = 0;
  let invalidTaxCount = 0;
  let missingMedNameCount = 0;
  let missingInvoiceCount = 0;
  
  const batchCounts = new Map<string, number>();
  let duplicateBatchCount = 0;

  const nameCol = getSourceCol('name');
  const batchCol = getSourceCol('batch_no');
  const expCol = getSourceCol('expiry_date');
  const dateCol = getSourceCol('date');
  const cgstCol = getSourceCol('cgst');
  const sgstCol = getSourceCol('sgst');
  const invoiceCol = getSourceCol('invoice_no');

  rows.forEach((row) => {
    // 1. Empty mandatory cells
    let hasEmptyMandatory = false;
    mandatoryFields.forEach(field => {
      const src = getSourceCol(field);
      if (src) {
        const val = row[src];
        if (val === undefined || val === null || String(val).trim() === '') {
          hasEmptyMandatory = true;
        }
      }
    });
    if (hasEmptyMandatory) emptyMandatoryCount++;

    // 2. Missing medicine name
    if (nameCol) {
      const val = row[nameCol];
      if (val === undefined || val === null || String(val).trim() === '') {
        missingMedNameCount++;
      }
    }

    // 3. Missing invoice no
    if (invoiceCol) {
      const val = row[invoiceCol];
      if (val === undefined || val === null || String(val).trim() === '') {
        missingInvoiceCount++;
      }
    }

    // 4. Invalid dates
    [expCol, dateCol].forEach(col => {
      if (col) {
        const valStr = String(row[col] || '').trim();
        if (valStr !== '') {
          const normalized = normalizeDate(valStr);
          if (!normalized || isNaN(Date.parse(normalized))) {
            invalidDateCount++;
          }
        }
      }
    });

    // 5. Invalid tax values
    [cgstCol, sgstCol].forEach(col => {
      if (col) {
        const valStr = String(row[col] || '').trim();
        if (valStr !== '') {
          const num = parseFloat(valStr);
          if (isNaN(num) || num < 0 || num > 100) {
            invalidTaxCount++;
          }
        }
      }
    });

    // 6. Duplicate batch numbers in the sheet
    if (nameCol && batchCol) {
      const medName = String(row[nameCol] || '').trim().toLowerCase();
      const batchNo = String(row[batchCol] || '').trim().toLowerCase();
      if (medName && batchNo) {
        const key = medName + '|||' + batchNo;
        const currentCount = batchCounts.get(key) || 0;
        if (currentCount > 0) {
          duplicateBatchCount++;
        }
        batchCounts.set(key, currentCount + 1);
      }
    }
  });

  if (emptyMandatoryCount > 0) {
    warnings.push({
      type: 'empty_mandatory',
      message: `${emptyMandatoryCount} rows contain empty values in mandatory fields.`,
      affectedCount: emptyMandatoryCount
    });
  }
  if (missingMedNameCount > 0) {
    warnings.push({
      type: 'missing_medicine_name',
      message: `${missingMedNameCount} rows are missing a medicine name.`,
      affectedCount: missingMedNameCount
    });
  }
  if (missingInvoiceCount > 0) {
    warnings.push({
      type: 'missing_invoice_number',
      message: `${missingInvoiceCount} rows are missing an invoice number.`,
      affectedCount: missingInvoiceCount
    });
  }
  if (invalidDateCount > 0) {
    warnings.push({
      type: 'invalid_dates',
      message: `${invalidDateCount} rows have invalid/unparsable date formats.`,
      affectedCount: invalidDateCount
    });
  }
  if (invalidTaxCount > 0) {
    warnings.push({
      type: 'invalid_tax_values',
      message: `${invalidTaxCount} rows have invalid tax percentages (not between 0 and 100).`,
      affectedCount: invalidTaxCount
    });
  }
  if (duplicateBatchCount > 0) {
    warnings.push({
      type: 'duplicate_batch_numbers',
      message: `${duplicateBatchCount} rows contain duplicate batch numbers for the same medicine in the file.`,
      affectedCount: duplicateBatchCount
    });
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

