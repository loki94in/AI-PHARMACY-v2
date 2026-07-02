import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { ensureSchema } from '../database.js';
import { extractFromPdf, ExtractedMedicine } from '../extractor.js';
import { eventService } from '../services/eventService.js';
import { activityTracker } from '../utils/activityTracker.js';
import csvParser from 'csv-parser';
import * as XLSX from 'xlsx';
import XLSX_default from 'xlsx';
const XLSX_import = (XLSX as any).readFile ? XLSX : XLSX_default;
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getDbPath = () => process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export async function preScanCsv(filePath: string, onProgress?: (rowIdx: number) => void): Promise<{
  totalCount: number;
  existingCount: number;
  newCount: number;
  duplicateCount: number;
}> {
  const db = await dbManager.getConnection();
  const rows = await db.all('SELECT name FROM medicines');
  
  const existingNames = new Set<string>();
  for (const r of rows) {
    if (r.name) existingNames.add(r.name.toLowerCase().trim());
  }

  const seenInCsv = new Set<string>();
  let totalCount = 0;
  let existingCount = 0;
  let newCount = 0;
  let duplicateCount = 0;

  return new Promise((resolve, reject) => {
    let nameCol = '';
    let processedRows = 0;

    const readStream = fs.createReadStream(filePath);
    const parserStream = readStream.pipe(csvParser());

    parserStream.on('headers', (headers: string[]) => {
      nameCol = headers.find((c) => /name|brand/i.test(c)) ||
                headers.find((c) => /product|item|inn|title/i.test(c)) ||
                headers[0] || '';
    });

    parserStream.on('data', (row: any) => {
      processedRows++;
      if (onProgress && processedRows % 100 === 0) {
        onProgress(processedRows);
      }

      if (!nameCol) return;
      const nameRaw = row[nameCol];
      if (!nameRaw) return;

      const nameNorm = nameRaw.trim().replace(/\s+/g, ' ');
      if (!nameNorm) return;

      const nameKey = nameNorm.toLowerCase();

      totalCount++;
      if (seenInCsv.has(nameKey)) {
        duplicateCount++;
      } else {
        seenInCsv.add(nameKey);
        if (existingNames.has(nameKey)) {
          existingCount++;
        } else {
          newCount++;
        }
      }
    });

    parserStream.on('end', () => {
      resolve({
        totalCount,
        existingCount,
        newCount,
        duplicateCount
      });
    });

    parserStream.on('error', (err) => {
      reject(err);
    });
  });
}

// Helper to parse CSV headers and preview rows
async function readCsvPreview(filePath: string, maxRows = 10): Promise<{ headers: string[], rows: any[] }> {
  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    let headers: string[] = [];
    if (!fs.existsSync(filePath)) return resolve({ headers, rows });

    const stream = fs.createReadStream(filePath).pipe(csvParser());

    stream.on('headers', (h: string[]) => {
      headers = h;
    });

    stream.on('data', (row: any) => {
      if (rows.length < maxRows) {
        rows.push(row);
      } else {
        stream.destroy();
      }
    });

    stream.on('end', () => {
      resolve({ headers, rows });
    });

    stream.on('close', () => {
      resolve({ headers, rows });
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

async function getSuggestedMapping(headers: string[], db: any): Promise<Record<string, string>> {
  const suggested: Record<string, string> = {};
  const headerKey = headers.slice().sort().join(',');

  try {
    const matched = await db.get('SELECT mapping_json FROM catalog_mappings WHERE file_headers = ?', headerKey);
    if (matched && matched.mapping_json) {
      return JSON.parse(matched.mapping_json);
    }
  } catch (err) {
    console.warn('Smart learning mapping load failed:', err);
  }

  for (const h of headers) {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/name|brand|product|item|inn|title|description/i.test(norm)) {
      suggested[h] = 'name';
    } else if (/api|composition|generic|salt|formula|active|molecule/i.test(norm)) {
      suggested[h] = 'api_reference';
    } else if (/strength|dosage|potency|mg|ml/i.test(norm)) {
      suggested[h] = 'strength';
    } else if (/pack|dosageform|packaging|type|unit/i.test(norm)) {
      suggested[h] = 'packaging';
    } else if (/mfg|manufactur|applicant|vendor|supplier|company|maker/i.test(norm)) {
      suggested[h] = 'manufacturer';
    } else if (/mkt|market/i.test(norm)) {
      suggested[h] = 'marketed_by';
    } else if (/hsn/i.test(norm)) {
      suggested[h] = 'hsn_code';
    } else if (/schedule/i.test(norm)) {
      suggested[h] = 'schedule_type';
    } else if (/mrp|price|selling|rate/i.test(norm)) {
      suggested[h] = 'mrp';
    } else if (/cgst/i.test(norm)) {
      suggested[h] = 'cgst';
    } else if (/sgst|gst/i.test(norm)) {
      suggested[h] = 'sgst';
    } else if (/rack|shelf|location/i.test(norm)) {
      suggested[h] = 'rack';
    } else if (/qty|quantity|stock|count|avail/i.test(norm)) {
      suggested[h] = 'quantity';
    } else if (/batch|lot/i.test(norm)) {
      suggested[h] = 'batch_no';
    } else if (/exp/i.test(norm)) {
      suggested[h] = 'expiry_date';
    } else {
      suggested[h] = '';
    }
  }
  return suggested;
}

export async function runCatalogAnalysis(jobId: number) {
  const db = await open({ filename: getDbPath(), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 10000;');
  
  let updatedJob;
  try {
    updatedJob = await db.run(
      "UPDATE catalog_jobs SET status = 'processing_analysis', progress = 0, error_log = NULL WHERE id = ? AND status = 'pending_analysis'",
      jobId
    );
  } catch (err) {
    await db.close();
    throw err;
  }
  
  if (updatedJob.changes === 0) {
    await db.close();
    return;
  }

  let job;
  try {
    job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
  } catch (err) {
    await db.close();
    throw err;
  }

  if (!job) {
    await db.close();
    return;
  }

  eventService.broadcast('catalog_job_update', { id: jobId, status: 'processing', progress: 0 });

  try {
    const ext = path.extname(job.file_path).toLowerCase();
    let headers: string[] = [];
    let previewData: any[] = [];
    let totalCount = 0;
    let newCount = 0;
    let existingCount = 0;
    let duplicateCount = 0;

    // Fetch existing database medicines and aliases for duplication and new check
    const existingRows = await db.all('SELECT name FROM medicines');
    const existingNames = new Set<string>();
    for (const r of existingRows) {
      if (r.name) existingNames.add(r.name.toLowerCase().trim());
    }
    try {
      const aliasRows = await db.all('SELECT alias_name FROM medicine_aliases');
      for (const r of aliasRows) {
        if (r.alias_name) existingNames.add(r.alias_name.toLowerCase().trim());
      }
    } catch (e) {
      console.warn('Failed to load medicine aliases during analysis:', e);
    }

    if (ext === '.csv') {
      const csvPreview = await readCsvPreview(job.file_path, 100);
      headers = csvPreview.headers;
      
      const nameCol = headers.find((c) => /name|brand/i.test(c)) ||
                      headers.find((c) => /product|item|inn|title/i.test(c)) ||
                      headers[0] || '';

      const seenNames = new Set<string>();
      previewData = csvPreview.rows.map(row => {
        const nameRaw = nameCol ? row[nameCol] : '';
        const nameNorm = nameRaw ? nameRaw.trim().replace(/\s+/g, ' ').toLowerCase() : '';
        let status = 'new';
        if (nameNorm) {
          if (seenNames.has(nameNorm)) {
            status = 'duplicate';
          } else {
            seenNames.add(nameNorm);
            if (existingNames.has(nameNorm)) {
              status = 'updated';
            }
          }
        }
        return {
          ...row,
          __is_existing: status === 'updated',
          __status: status
        };
      });

      // Compute actual counts using preScanCsv
      const scanResult = await preScanCsv(job.file_path, (rowIdx) => {
        db.run('UPDATE catalog_jobs SET total_count = ? WHERE id = ?', [rowIdx, jobId]);
        eventService.broadcast('catalog_job_progress', {
          id: jobId,
          progress: 0,
          total_count: rowIdx,
          status: 'processing_analysis'
        });
      });
      totalCount = scanResult.totalCount;
      newCount = scanResult.newCount;
      existingCount = scanResult.existingCount;
      duplicateCount = scanResult.duplicateCount;
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX_import.readFile(job.file_path);
      const sheetName = workbook.SheetNames[0];
      if (sheetName) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX_import.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
        if (sheetData.length > 0) {
          headers = sheetData[0].map((h: any, idx: number) => h ? String(h).trim() : `Column_${idx + 1}`);
          
          const nameColIdx = sheetData[0].findIndex((c: any) => 
            /name|brand/i.test(String(c)) || 
            /product|item|inn|title/i.test(String(c))
          );
          const finalNameColIdx = nameColIdx !== -1 ? nameColIdx : 0;

          const seenNames = new Set<string>();
          previewData = sheetData.slice(1, 101).map((row: any[]) => {
            const rowObj: Record<string, any> = {};
            headers.forEach((header, idx) => {
              rowObj[header] = row[idx] !== undefined ? row[idx] : '';
            });
            const nameRaw = row[finalNameColIdx] !== undefined ? String(row[finalNameColIdx]).trim().replace(/\s+/g, ' ') : '';
            const nameNorm = nameRaw.toLowerCase().trim();
            let status = 'new';
            if (nameNorm) {
              if (seenNames.has(nameNorm)) {
                status = 'duplicate';
              } else {
                seenNames.add(nameNorm);
                if (existingNames.has(nameNorm)) {
                  status = 'updated';
                }
              }
            }
            rowObj.__is_existing = status === 'updated';
            rowObj.__status = status;
            return rowObj;
          });
          totalCount = Math.max(0, sheetData.length - 1);

          // Calculate statistics
          const seenNamesAll = new Set<string>();

          sheetData.slice(1).forEach((row: any[]) => {
            if (!row || row[finalNameColIdx] === undefined) return;
            const nameRaw = String(row[finalNameColIdx]).trim().replace(/\s+/g, ' ');
            if (!nameRaw) return;
            const nameKey = nameRaw.toLowerCase();
            if (seenNamesAll.has(nameKey)) {
              duplicateCount++;
            } else {
              seenNamesAll.add(nameKey);
              if (existingNames.has(nameKey)) {
                existingCount++;
              } else {
                newCount++;
              }
            }
          });
        }
      }
    } else if (ext === '.pdf') {
      const extracted = await extractFromPdf(job.file_path);
      const seenNames = new Set<string>();
      previewData = extracted.slice(0, 100).map(item => {
        const nameNorm = String(item.name).trim().replace(/\s+/g, ' ').toLowerCase();
        let status = 'new';
        if (nameNorm) {
          if (seenNames.has(nameNorm)) {
            status = 'duplicate';
          } else {
            seenNames.add(nameNorm);
            if (existingNames.has(nameNorm)) {
              status = 'updated';
            }
          }
        }
        return {
          'Product Name': item.name,
          'Composition': item.api_reference || '',
          'Strength': item.strength || '',
          'Packaging': item.packaging_type || '',
          'Manufacturer': item.manufacturer || '',
          'Marketed By': item.marketed_by || '',
          __is_existing: status === 'updated',
          __status: status
        };
      });
      headers = ['Product Name', 'Composition', 'Strength', 'Packaging', 'Manufacturer', 'Marketed By'];
      totalCount = extracted.length;

      // Calculate statistics
      const seenNamesAll = new Set<string>();
      extracted.forEach((item) => {
        const nameRaw = String(item.name).trim().replace(/\s+/g, ' ');
        if (!nameRaw) return;
        const nameKey = nameRaw.toLowerCase();
        if (seenNamesAll.has(nameKey)) {
          duplicateCount++;
        } else {
          seenNamesAll.add(nameKey);
          if (existingNames.has(nameKey)) {
            existingCount++;
          } else {
            newCount++;
          }
        }
      });
    } else {
      throw new Error('Unsupported file format.');
    }

    // Duplicate Catalog Detection Jaccard Similarity Check
    let matchedPreviousJobId: number | null = null;
    let newlyDetectedColumns: string[] = [];
    let pastSuggestedMapping: Record<string, string> | null = null;

    try {
      const pastJobs = await db.all(
        "SELECT id, file_path, original_filename, extracted_data, mapping_config FROM catalog_jobs WHERE id != ? AND status IN ('done', 'waiting_for_mapping', 'ready_for_review') ORDER BY id DESC",
        jobId
      );

      if (headers.length > 0) {
        for (const pj of pastJobs) {
          if (!pj.extracted_data) continue;
          try {
            const extracted = JSON.parse(pj.extracted_data);
            const pastHeaders = (extracted.headers as string[]) || [];
            
            const set1 = new Set(headers.map(h => h.toLowerCase().trim()));
            const set2 = new Set(pastHeaders.map(h => h.toLowerCase().trim()));
            const intersection = new Set([...set1].filter(x => set2.has(x)));
            const union = new Set([...set1, ...set2]);
            const headerSimilarity = union.size > 0 ? intersection.size / union.size : 0;
            
            let nameSimilarity = 0;
            const nameCol1 = headers.find(c => /name|brand/i.test(c)) || headers[0];
            const nameCol2 = pastHeaders.find((c: string) => /name|brand/i.test(c)) || pastHeaders[0];
            
            if (previewData.length > 0 && extracted.previewData && extracted.previewData.length > 0) {
              const names1 = previewData.map(r => String(r[nameCol1] || '').toLowerCase().trim()).filter(Boolean);
              const names2 = extracted.previewData.map((r: any) => String(r[nameCol2] || '').toLowerCase().trim()).filter(Boolean);
              
              const nSet1 = new Set(names1);
              const nSet2 = new Set(names2);
              const nIntersection = new Set([...nSet1].filter(x => nSet2.has(x)));
              const nUnion = new Set([...nSet1, ...nSet2]);
              nameSimilarity = nUnion.size > 0 ? nIntersection.size / nUnion.size : 0;
            }

            if (headerSimilarity > 0.7 || nameSimilarity > 0.8) {
              matchedPreviousJobId = pj.id;
              newlyDetectedColumns = headers.filter(h => !set2.has(h.toLowerCase().trim()));
              
              if (pj.mapping_config) {
                pastSuggestedMapping = JSON.parse(pj.mapping_config);
              } else if (extracted.suggestedMapping) {
                pastSuggestedMapping = extracted.suggestedMapping;
              }
              console.log(`[CatalogWorker] Match found: Past Job #${pj.id} (${pj.original_filename}). Header overlap: ${Math.round(headerSimilarity*100)}%, Name overlap: ${Math.round(nameSimilarity*100)}%`);
              break;
            }
          } catch (e) {
            console.warn(`[CatalogWorker] Past job #${pj.id} comparison failed:`, e);
          }
        }
      }
    } catch (pastErr) {
      console.warn('[CatalogWorker] Failed to query past jobs for duplicate detection:', pastErr);
    }

    const suggestedMapping = pastSuggestedMapping || await getSuggestedMapping(headers, db);

    const extractedJson = JSON.stringify({ 
      headers, 
      previewData, 
      suggestedMapping,
      matchedPreviousJobId,
      newlyDetectedColumns
    });

    await db.run(
      `UPDATE catalog_jobs SET status = 'waiting_for_mapping', extracted_data = ?, total_count = ?, new_count = ?, existing_count = ?, duplicate_count = ?, matched_previous_job_id = ?, newly_detected_columns = ? WHERE id = ?`,
      [
        extractedJson, 
        totalCount, 
        newCount, 
        existingCount, 
        duplicateCount, 
        matchedPreviousJobId, 
        JSON.stringify(newlyDetectedColumns),
        jobId
      ]
    );

    eventService.broadcast('catalog_job_update', { 
      id: jobId, 
      status: 'waiting_for_mapping', 
      progress: 100,
      total_count: totalCount,
      new_count: newCount,
      existing_count: existingCount,
      duplicate_count: duplicateCount
    });
  } catch (err: any) {
    console.error('Analysis failed', err);
    try {
      await db.run("UPDATE catalog_jobs SET status = 'failed', error_log = ? WHERE id = ?", [err.message || 'Unknown error', jobId]);
    } catch (dbErr) {
      console.error('Failed to log catalog analysis failure to DB:', dbErr);
    }
    eventService.broadcast('catalog_job_update', { id: jobId, status: 'failed', error: err.message });
  } finally {
    await db.close();
  }
}

export async function runCatalogImport(jobId: number) {
  const db = await open({ filename: getDbPath(), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 10000;');
  await db.run('PRAGMA journal_mode = WAL;');
  await db.run('PRAGMA synchronous = NORMAL;');
  
  // Use a state lock to prevent concurrent ingestion of the same job
  let updatedJob;
  try {
    updatedJob = await db.run(
      "UPDATE catalog_jobs SET status = 'processing', progress = 0, error_log = NULL WHERE id = ? AND status = 'pending'",
      jobId
    );
  } catch (err) {
    await db.close();
    throw err;
  }
  
  if (updatedJob.changes === 0) {
    // Already running or not pending
    try {
      const checkJob = await db.get('SELECT status FROM catalog_jobs WHERE id = ?', jobId);
      if (checkJob && checkJob.status === 'processing') {
        console.log(`[Worker] Job ${jobId} is already being processed. Skipping duplicate run.`);
      }
    } catch (e) {}
    await db.close();
    return;
  }

  let job;
  try {
    job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
  } catch (err) {
    await db.close();
    throw err;
  }

  if (!job) {
    await db.close();
    throw new Error('Catalog job not found');
  }

  eventService.broadcast('catalog_job_update', { id: jobId, status: 'processing', progress: 0 });

  try {
    const ext = path.extname(job.file_path).toLowerCase();
    
    // Parse mappings configuration
    const mapping = JSON.parse(job.mapping_config || '{}');

    // --- Header-presence guard ---
    // Verify every mapped CSV column is actually present in this file's headers.
    // If any are missing the distributor may have renamed columns — route to
    // waiting_for_mapping so the user can re-map, rather than silently mis-importing.
    if (ext === '.csv') {
      const preview = await readCsvPreview(job.file_path, 1);
      const actualHeaders = new Set(preview.headers);
      const missingMappedColumns = Object.keys(mapping).filter(col => col && !actualHeaders.has(col));
      if (missingMappedColumns.length > 0) {
        console.warn(`[CatalogWorker] Job ${jobId}: mapped columns missing from file headers: ${missingMappedColumns.join(', ')}. Routing to waiting_for_mapping.`);
        await db.run(
          "UPDATE catalog_jobs SET status = 'waiting_for_mapping', error_log = ? WHERE id = ?",
          [`Missing mapped columns: ${missingMappedColumns.join(', ')}`, jobId]
        );
        eventService.broadcast('catalog_job_update', { id: jobId, status: 'waiting_for_mapping' });
        return;
      }
    }


    // Alter medicines schema for custom fields dynamically
    const tableInfo = await db.all('PRAGMA table_info(medicines)');
    const existingMedicinesCols = tableInfo.map(c => c.name.toLowerCase());

    for (const [csvCol, targetCol] of Object.entries(mapping)) {
      if (targetCol && String(targetCol).startsWith('custom_col_')) {
        const dbColName = String(targetCol).substring(11).trim().replace(/\s+/g, '_').toLowerCase();
        if (dbColName && !existingMedicinesCols.includes(dbColName)) {
          try {
            await db.run(`ALTER TABLE medicines ADD COLUMN "${dbColName}" TEXT`);
            existingMedicinesCols.push(dbColName);
            console.log(`[CatalogWorker] Dynamically added custom column "${dbColName}" to medicines table.`);
          } catch (alterErr: any) {
            console.error(`[CatalogWorker] Failed to add custom column ${dbColName}:`, alterErr.message);
          }
        }
      }
    }

    const customMappings = Object.entries(mapping)
      .filter(([csvCol, targetCol]) => targetCol && String(targetCol).startsWith('custom_col_'))
      .map(([csvCol, targetCol]) => ({
        csvCol,
        dbCol: String(targetCol).substring(11).trim().replace(/\s+/g, '_').toLowerCase()
      }));

    const nameCol = Object.keys(mapping).find(key => mapping[key] === 'name');
    const apiCols = Object.keys(mapping).filter(key => mapping[key] === 'api_reference');
    const metadataCols = Object.keys(mapping).filter(key => mapping[key] === 'metadata');
    const strCol = Object.keys(mapping).find(key => mapping[key] === 'strength');
    const pkgCol = Object.keys(mapping).find(key => mapping[key] === 'packaging');
    const mfgCol = Object.keys(mapping).find(key => mapping[key] === 'manufacturer');
    const mktCol = Object.keys(mapping).find(key => mapping[key] === 'marketed_by');
    const hsnCol = Object.keys(mapping).find(key => mapping[key] === 'hsn_code');
    const schCol = Object.keys(mapping).find(key => mapping[key] === 'schedule_type');
    const mrpCol = Object.keys(mapping).find(key => mapping[key] === 'mrp');
    const cgstCol = Object.keys(mapping).find(key => mapping[key] === 'cgst');
    const sgstCol = Object.keys(mapping).find(key => mapping[key] === 'sgst');
    const rackCol = Object.keys(mapping).find(key => mapping[key] === 'rack');
    
    // Stock mapping columns
    const qtyCol = Object.keys(mapping).find(key => mapping[key] === 'quantity');
    const batchCol = Object.keys(mapping).find(key => mapping[key] === 'batch_no');
    const expCol = Object.keys(mapping).find(key => mapping[key] === 'expiry_date');

    const rows: any[] = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX_import.readFile(job.file_path);
      const sheetName = workbook.SheetNames[0];
      if (sheetName) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX_import.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
        if (sheetData.length > 0) {
          const headers = sheetData[0].map((h: any, idx: number) => h ? String(h).trim() : `Column_${idx + 1}`);
          const excelRows = sheetData.slice(1).map((row: any[]) => {
            const rowObj: Record<string, any> = {};
            headers.forEach((header, idx) => {
              rowObj[header] = row[idx] !== undefined ? row[idx] : '';
            });
            return rowObj;
          });
          rows.push(...excelRows);
        }
      }
    } else if (ext === '.pdf') {
      const extracted = await extractFromPdf(job.file_path);
      const pdfRows = extracted.map(item => ({
        'Product Name': item.name,
        'Composition': item.api_reference || '',
        'Strength': item.strength || '',
        'Packaging': item.packaging_type || '',
        'Manufacturer': item.manufacturer || '',
        'Marketed By': item.marketed_by || ''
      }));
      rows.push(...pdfRows);
    }

    // Dynamic row counting for CSV progress tracking
    let totalToProcess = 1;
    if (ext === '.csv') {
      totalToProcess = await new Promise<number>((resolve) => {
        let count = 0;
        const countStream = fs.createReadStream(job.file_path);
        countStream
          .pipe(csvParser())
          .on('data', () => { count++; })
          .on('end', () => {
            countStream.destroy();
          })
          .on('close', () => {
            // Wait for file lock to fully release on Windows
            setTimeout(() => resolve(count), 500);
          })
          .on('error', () => resolve(1));
      });
    } else {
      totalToProcess = rows.length;
    }

    await db.run('UPDATE catalog_jobs SET total_count = ? WHERE id = ?', [totalToProcess, jobId]);

    // Fetch existing database medicines and aliases for duplication check
    const dbRows = await db.all('SELECT id, name FROM medicines');
    const existingMedicinesMap = new Map<string, number>();
    for (const r of dbRows) {
      if (r.name) existingMedicinesMap.set(r.name.toLowerCase().trim(), r.id);
    }
    try {
      const aliasRows = await db.all('SELECT alias_name, medicine_id FROM medicine_aliases');
      for (const r of aliasRows) {
        if (r.alias_name) existingMedicinesMap.set(r.alias_name.toLowerCase().trim(), r.medicine_id);
      }
    } catch (e) {
      console.warn('Failed to load medicine aliases during import:', e);
    }

    const batchSize = 1000;
    let batch: any[] = [];
    let processedCount = job.processed_count || 0;
    let newCount = job.new_count || 0;
    let existingCount = job.existing_count || 0;
    let duplicateCount = job.duplicate_count || 0;
    const addedNames = new Set<string>();

    const insertBatch = async (items: any[]) => {
      await activityTracker.waitUntilIdle();
      await db.run('BEGIN TRANSACTION');
      for (const item of items) {
        const key = item.name.toLowerCase().trim();
        if (addedNames.has(key)) {
          duplicateCount++;
          continue;
        }
        addedNames.add(key);

        let medId = existingMedicinesMap.get(key);

        // Check if API composition is missing or incomplete, requiring review
        const isApiMissing = !item.api_reference || item.api_reference.trim() === '';
        if (isApiMissing) {
          let dbHasApi = false;
          if (medId) {
            const dbMed = await db.get('SELECT api_reference FROM medicines WHERE id = ?', medId);
            if (dbMed && dbMed.api_reference && dbMed.api_reference.trim() !== '') {
              dbHasApi = true;
            }
          }
          
          if (!dbHasApi) {
            // Stage for review!
            await db.run(
              'INSERT INTO staged_medicine_reviews (job_id, medicine_name, status, original_row_data) VALUES (?, ?, ?, ?)',
              [jobId, item.name, 'pending', JSON.stringify(item)]
            );
            continue;
          }
        }

        if (medId) {
          existingCount++;
          // Update / Merge existing medicine mapping fields
          const updates: string[] = [];
          const params: any[] = [];

          if (item.api_reference !== undefined) { updates.push("api_reference = COALESCE(NULLIF(api_reference, ''), ?)"); params.push(item.api_reference); }
          if (item.strength !== undefined) { updates.push("strength = COALESCE(NULLIF(strength, ''), ?)"); params.push(item.strength); }
          if (item.packaging !== undefined) { updates.push("packaging = COALESCE(NULLIF(packaging, ''), ?)"); params.push(item.packaging); }
          if (item.manufacturer !== undefined) { updates.push("manufacturer = COALESCE(NULLIF(manufacturer, ''), ?)"); params.push(item.manufacturer); }
          if (item.marketed_by !== undefined) { updates.push("marketed_by = COALESCE(NULLIF(marketed_by, ''), ?)"); params.push(item.marketed_by); }
          if (item.hsn_code !== undefined) { updates.push("hsn_code = COALESCE(NULLIF(hsn_code, ''), ?)"); params.push(item.hsn_code); }
          if (item.schedule_type !== undefined) { updates.push("schedule_type = COALESCE(NULLIF(schedule_type, ''), ?)"); params.push(item.schedule_type); }
          if (item.mrp !== undefined) { updates.push("mrp = COALESCE(NULLIF(mrp, 0), ?)"); params.push(item.mrp); }
          if (item.cgst !== undefined) { updates.push("cgst_per = COALESCE(NULLIF(cgst_per, 0), ?)"); params.push(item.cgst); }
          if (item.sgst !== undefined) { updates.push("sgst_per = COALESCE(NULLIF(sgst_per, 0), ?)"); params.push(item.sgst); }
          if (item.rack !== undefined) { updates.push("rack = COALESCE(NULLIF(rack, ''), ?)"); params.push(item.rack); }
          if (item.metadata !== undefined) { updates.push("metadata = COALESCE(NULLIF(metadata, ''), ?)"); params.push(item.metadata); }

          // Custom columns update
          for (const cm of customMappings) {
            if (item[cm.dbCol] !== undefined) {
              updates.push(`"${cm.dbCol}" = COALESCE(NULLIF("${cm.dbCol}", ''), ?)`);
              params.push(item[cm.dbCol]);
            }
          }

          if (updates.length > 0) {
            params.push(medId);
            await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, ...params);
          }
        } else {
          newCount++;
          // Create new product record in Product Master
          const columns = ['name', 'api_reference', 'strength', 'packaging', 'manufacturer', 'marketed_by', 'hsn_code', 'schedule_type', 'mrp', 'cgst_per', 'sgst_per', 'rack', 'metadata'];
          const placeholders = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?'];
          const params = [
            item.name,
            item.api_reference || null,
            item.strength || null,
            item.packaging || null,
            item.manufacturer || null,
            item.marketed_by || null,
            item.hsn_code || null,
            item.schedule_type || null,
            item.mrp || 0,
            item.cgst || 0,
            item.sgst || 0,
            item.rack || null,
            item.metadata || null
          ];

          for (const cm of customMappings) {
            columns.push(`"${cm.dbCol}"`);
            placeholders.push('?');
            params.push(item[cm.dbCol] !== undefined ? item[cm.dbCol] : null);
          }

          const insertRes = await db.run(
            `INSERT INTO medicines (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
            params
          );
          medId = insertRes.lastID!;
          existingMedicinesMap.set(key, medId);
        }

        // Handle inventory stock insertion if stock fields are mapped
        if (item.quantity !== undefined || item.batch_no !== undefined || item.expiry_date !== undefined) {
          const qty = parseInt(item.quantity) || 0;
          const batchNo = (item.batch_no || 'B-CATALOG').trim();
          const expiry = item.expiry_date || '2028-12-31';
          const mrpVal = parseFloat(item.mrp) || 0;

          const existingInv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, batchNo]);
          if (existingInv) {
            await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [qty, existingInv.id]);
          } else {
            await db.run(
              'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp) VALUES (?, ?, ?, ?, ?)',
              [medId, qty, batchNo, expiry, mrpVal]
            );
          }
        }
      }
      await db.run('COMMIT');
    };

    const processRowObject = (row: any) => {
      if (!nameCol) return null;
      const name = String(row[nameCol] || '').trim();
      if (!name) return null; // Required validation

      const nameNorm = name.replace(/\s+/g, ' ');
      
      const res: any = { name: nameNorm };
      if (apiCols.length > 0) {
        res.api_reference = apiCols
          .map(col => String(row[col] || '').trim())
          .filter(Boolean)
          .join(' + ');
      }
      if (metadataCols.length > 0) {
        const metadataObj: Record<string, string> = {};
        for (const col of metadataCols) {
          metadataObj[col] = String(row[col] || '').trim();
        }
        res.metadata = JSON.stringify(metadataObj);
      }
      if (strCol) res.strength = String(row[strCol] || '').trim();
      if (pkgCol) res.packaging = String(row[pkgCol] || '').trim();
      if (mfgCol) res.manufacturer = String(row[mfgCol] || '').trim();
      if (mktCol) res.marketed_by = String(row[mktCol] || '').trim();
      if (hsnCol) res.hsn_code = String(row[hsnCol] || '').trim();
      if (schCol) res.schedule_type = String(row[schCol] || '').trim();
      if (mrpCol) res.mrp = parseFloat(row[mrpCol]) || 0;
      if (cgstCol) res.cgst = parseFloat(row[cgstCol]) || 0;
      if (sgstCol) res.sgst = parseFloat(row[sgstCol]) || 0;
      if (rackCol) res.rack = String(row[rackCol] || '').trim();
      
      // Stock mapping
      if (qtyCol) res.quantity = parseInt(row[qtyCol]) || 0;
      if (batchCol) res.batch_no = String(row[batchCol] || '').trim();
      if (expCol) res.expiry_date = String(row[expCol] || '').trim();
      
      // Custom mappings
      for (const cm of customMappings) {
        if (row[cm.csvCol] !== undefined) {
          res[cm.dbCol] = String(row[cm.csvCol] || '').trim();
        }
      }
      
      return res;
    };





    let lastProgressTime = Date.now();

    if (ext === '.csv') {
      const readStream = fs.createReadStream(job.file_path);
      const csvStream = readStream.pipe(csvParser());
      readStream.on('error', (err) => {
        csvStream.destroy(new Error(`Failed to read stream for import: ${err.message}`));
      });

      let currentLine = 0;
      for await (const row of csvStream) {
        currentLine++;
        if (currentLine <= processedCount) {
          continue;
        }

        const parsed = processRowObject(row);
        if (parsed) {
          batch.push(parsed);
        }
        processedCount = currentLine;

        if (batch.length >= batchSize) {
          await insertBatch(batch);
          batch = [];
        }

        const shouldUpdateProgress = (processedCount === totalToProcess) || (processedCount % 1000 === 0) || (Date.now() - lastProgressTime > 3000);
        if (shouldUpdateProgress) {
          lastProgressTime = Date.now();
          const currentJob = await db.get('SELECT status FROM catalog_jobs WHERE id = ?', jobId);
          if (currentJob && currentJob.status === 'paused') {
            if (batch.length > 0) {
              await insertBatch(batch);
              batch = [];
            }
            const progress = Math.min(99, Math.round((processedCount / totalToProcess) * 100));
            await db.run('UPDATE catalog_jobs SET progress = ?, new_count = ?, existing_count = ?, duplicate_count = ?, processed_count = ? WHERE id = ?', [progress, newCount, existingCount, duplicateCount, processedCount, jobId]);
            eventService.broadcast('catalog_job_progress', { id: jobId, progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
            eventService.broadcast('catalog_job_update', { id: jobId, status: 'paused', progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
            readStream.destroy();
            return;
          }

          const progress = Math.min(99, Math.round((processedCount / totalToProcess) * 100));
          await db.run('UPDATE catalog_jobs SET progress = ?, new_count = ?, existing_count = ?, duplicate_count = ?, processed_count = ? WHERE id = ?', [progress, newCount, existingCount, duplicateCount, processedCount, jobId]);
          eventService.broadcast('catalog_job_progress', { id: jobId, progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
        }
      }
    } else {
      // PDF and Excel rows in memory
      let currentLine = 0;
      for (const row of rows) {
        currentLine++;
        if (currentLine <= processedCount) {
          continue;
        }

        const parsed = processRowObject(row);
        if (parsed) {
          batch.push(parsed);
        }
        processedCount = currentLine;

        if (batch.length >= batchSize) {
          await insertBatch(batch);
          batch = [];
        }

        const shouldUpdateProgress = (processedCount === totalToProcess) || (processedCount % 1000 === 0) || (Date.now() - lastProgressTime > 3000);
        if (shouldUpdateProgress) {
          lastProgressTime = Date.now();
          const currentJob = await db.get('SELECT status FROM catalog_jobs WHERE id = ?', jobId);
          if (currentJob && currentJob.status === 'paused') {
            if (batch.length > 0) {
              await insertBatch(batch);
              batch = [];
            }
            const progress = Math.min(99, Math.round((processedCount / totalToProcess) * 100));
            await db.run('UPDATE catalog_jobs SET progress = ?, new_count = ?, existing_count = ?, duplicate_count = ?, processed_count = ? WHERE id = ?', [progress, newCount, existingCount, duplicateCount, processedCount, jobId]);
            eventService.broadcast('catalog_job_progress', { id: jobId, progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
            eventService.broadcast('catalog_job_update', { id: jobId, status: 'paused', progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
            return;
          }

          const progress = Math.min(99, Math.round((processedCount / totalToProcess) * 100));
          await db.run('UPDATE catalog_jobs SET progress = ?, new_count = ?, existing_count = ?, duplicate_count = ?, processed_count = ? WHERE id = ?', [progress, newCount, existingCount, duplicateCount, processedCount, jobId]);
          eventService.broadcast('catalog_job_progress', { id: jobId, progress, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
        }
      }
    }

    if (batch.length > 0) {
      await insertBatch(batch);
    }

    await db.run("UPDATE catalog_jobs SET status = 'done', progress = 100, new_count = ?, existing_count = ?, duplicate_count = ?, processed_count = ? WHERE id = ?", [newCount, existingCount, duplicateCount, processedCount, jobId]);
    eventService.broadcast('catalog_job_update', { id: jobId, status: 'done', progress: 100, new_count: newCount, existing_count: existingCount, duplicate_count: duplicateCount, total_count: totalToProcess });
  } catch (err: any) {
    console.error('Batch import failed', err);
    try {
      await db.run("UPDATE catalog_jobs SET status = 'failed', error_log = ? WHERE id = ?", [err.message || 'Unknown error', jobId]);
    } catch (dbErr) {
      console.error('Failed to log catalog import failure to DB:', dbErr);
    }
    eventService.broadcast('catalog_job_update', { id: jobId, status: 'failed', error: err.message });
  } finally {
    await db.close();
  }
}

let isWorking = false;
const failedDiscoveryAttempts = new Map<string, number>();
const DISCOVERY_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// Loop to poll jobs
export async function startWorker() {
  // Reset stuck jobs on startup to allow resuming
  try {
    const db = await dbManager.getConnection();
    const result1 = await db.run("UPDATE catalog_jobs SET status = 'pending' WHERE status = 'processing'");
    const result2 = await db.run("UPDATE catalog_jobs SET status = 'pending_analysis' WHERE status = 'processing_analysis'");
    if ((result1.changes && result1.changes > 0) || (result2.changes && result2.changes > 0)) {
      console.log(`[Worker] Reset ${result1.changes || 0} stuck processing jobs and ${result2.changes || 0} stuck analysis jobs to pending/pending_analysis.`);
    }
  } catch (err) {
    console.error('[Worker] Failed to reset stuck catalog jobs on startup:', err);
  }

  // ponytail: concurrency lock to avoid CPU/memory leak
  setInterval(async () => {
    if (isWorking) {
      return;
    }
    isWorking = true;
    let db;
    try {
      db = await dbManager.getConnection();
      
      const analysisJob = await db.get(`SELECT * FROM catalog_jobs WHERE status='pending_analysis' ORDER BY id ASC LIMIT 1`);
      if (analysisJob) {
        console.log(`[Worker] Found pending analysis job ${analysisJob.id}, triggering runCatalogAnalysis.`);
        await runCatalogAnalysis(analysisJob.id);
      } else {
        const job = await db.get(`SELECT * FROM catalog_jobs WHERE status='pending' ORDER BY id ASC LIMIT 1`);
        if (job) {
          console.log(`[Worker] Found pending job ${job.id}, triggering runCatalogImport.`);
          await runCatalogImport(job.id);
        } else {
          // Process staged reviews background enrichment
          const pendingReviews = await db.all(
            "SELECT * FROM staged_medicine_reviews WHERE status = 'pending' AND screenshot_path IS NULL ORDER BY id ASC LIMIT 50"
          );
          
          const pendingReview = pendingReviews.find(r => {
            const lastAttempt = failedDiscoveryAttempts.get(r.medicine_name);
            return !lastAttempt || (Date.now() - lastAttempt > DISCOVERY_RETRY_DELAY_MS);
          });

          if (pendingReview) {
            console.log(`[Worker] Found pending medicine review for "${pendingReview.medicine_name}", starting Google discovery...`);
            const { googleSearchService } = await import('../services/googleSearchService.js');
            const searchResult = await googleSearchService.discoverMedicineInfo(pendingReview.medicine_name);
            
            if (searchResult) {
              const extractedJson = JSON.stringify({
                api_reference: searchResult.api_reference || '',
                strength: searchResult.strength || '',
                manufacturer: searchResult.manufacturer || '',
                dosage_form: searchResult.dosage_form || '',
                pack_info: searchResult.pack_info || '',
                therapeutic_class: searchResult.therapeutic_class || ''
              });

              await db.run(
                "UPDATE staged_medicine_reviews SET screenshot_path = ?, raw_ocr_text = ?, extracted_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [
                  searchResult.screenshot_path || null,
                  searchResult.raw_text || null,
                  extractedJson,
                  pendingReview.id
                ]
              );
              console.log(`[Worker] Enriched medicine review for "${pendingReview.medicine_name}".`);
              
              failedDiscoveryAttempts.delete(pendingReview.medicine_name);

              eventService.broadcast('catalog_review_updated', {
                jobId: pendingReview.job_id,
                reviewId: pendingReview.id,
                medicineName: pendingReview.medicine_name,
                status: 'enriched'
              });
            } else {
              console.log(`[Worker] Google discovery failed or throttled for "${pendingReview.medicine_name}".`);
              failedDiscoveryAttempts.set(pendingReview.medicine_name, Date.now());
            }
          }
        }
      }
    } catch (err) {
      console.error('Worker polling interval error:', err);
    } finally {
      isWorking = false;
    }
  }, 10000);
}
