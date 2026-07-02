#!/usr/bin/env tsx

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

/**
 * Build custom dictionary from existing medicine database
 * for improved Tesseract.js OCR accuracy in offline mode
 */
async function buildMedicineDict() {
  try {
    const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'app.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // Get all medicine names
    const medicines = await db.all('SELECT name FROM medicines WHERE name IS NOT NULL AND name <> ""');
    await db.close();

    if (medicines.length === 0) {
      console.warn('No medicines found in database');
      return;
    }

    // Extract words from medicine names for dictionary
    const words = new Set<string>();

    medicines.forEach(m => {
      if (!m.name) return;

      // Split on common delimiters and add to word set
      // Include alphanumeric characters, hyphens, and common medicine abbreviations
      const parts = m.name
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [];

      parts.forEach(part => {
        // Skip very short words (likely not meaningful)
        if (part.length >= 2) {
          words.add(part);
        }
      });

      // Also add common medicine suffixes/prefixes that might be OCR'd separately
      const commonPatterns = [
        'mg', 'ml', 'g', 'tablet', 'capsule', 'syrup', 'injection', 'drops',
        'forte', 'plus', 'max', 'sr', 'xr', 'lt', 'od', 'bd', 'tds', 'qid'
      ];

      commonPatterns.forEach(pattern => {
        if (m.name.toLowerCase().includes(pattern)) {
          words.add(pattern);
        }
      });
    });

    // Add common OCR confusion characters that should be allowed
    // These help Tesseract distinguish between similar characters
    words.add('i'); words.add('l'); words.add('1'); // Often confused
    words.add('o'); words.add('0'); // Often confused
    words.add('s'); words.add('5'); // Often confused

    // Write dictionary file
    const dictPath = path.resolve(process.cwd(), 'data', 'medicine_dict.txt');
    const dictContent = Array.from(words).sort().join('\n');

    // Ensure data directory exists
    const dataDir = path.dirname(dictPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    await fs.promises.writeFile(dictPath, dictContent);
    console.log(`✅ Medicine dictionary built successfully:`);
    console.log(`   - Source: ${medicines.length} medicine names`);
    console.log(`   - Dictionary: ${words.size} unique words`);
    console.log(`   - Saved to: ${dictPath}`);

    // Also create patterns file for common medicine formats
    const patternsPath = path.resolve(process.cwd(), 'data', 'medicine_patterns.txt');
    const patterns = [
      '\\d+\\.?\\d*\\s*mg',           // 500mg, 10.5mg
      '\\d+\\.?\\d*\\s*ml',           // 10ml, 5.5ml
      '\\d+\\.?\\d*\\s*g',            // 1g, 0.5g
      '\\d+\\s*tablet',               // 1 tablet
      '\\d+\\s*cap',                  // 2 cap
      '\\d+\\s*days?',                // 5 days
      'rex\\s*\\d+',                  // Rex 50
      '[a-z]+\\s*forte',              // Amoxil Forte
      '[a-z]+\\s*plus'                // Cetirizine Plus
    ];

    await fs.promises.writeFile(patternsPath, patterns.join('\n'));
    console.log(`✅ Medicine patterns file created: ${patternsPath}`);

  } catch (error) {
    console.error('❌ Failed to build medicine dictionary:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildMedicineDict().catch(console.error);
}

export default buildMedicineDict;