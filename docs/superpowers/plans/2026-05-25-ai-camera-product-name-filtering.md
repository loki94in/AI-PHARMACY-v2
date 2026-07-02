# AI Camera Product Name Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a ProductNameFilterService that filters AI Camera OCR results to show only product names registered in the inventory, with optional internet fallback for missing products.

**Architecture:** 
- Keep existing AI Camera Service unchanged (SRP)
- Create new ProductNameFilterService handling fuzzy matching against cached medicine names
- Service loads medicine names from `medicines.name` table on initialization
- Optional internet fallback to external API when local matches insufficient
- Test script updated to use filtering service instead of displaying raw OCR text

**Tech Stack:**
- TypeScript, Node.js
- SQLite (existing medicines table)
- Fuzzy string matching (Levenshtein distance)
- Optional: axios or native fetch for internet API calls
- Jest for unit testing

**File Structure:**
- Create: `src/services/productNameFilterService.ts`
- Modify: `test-ai-camera-images.mjs`
- Create: `tests/services/productNameFilterService.test.ts`

---

## Task 1: ProductNameFilterService - Initialization and Local Matching

**Files:**
- Create: `src/services/productNameFilterService.ts`
- Create: `tests/services/productNameFilterService.test.ts`

- [ ] **Step 1: Write the failing test for service initialization**

```typescript
import { ProductNameFilterService } from '../../../src/services/productNameFilterService';

describe('ProductNameFilterService', () => {
  let service: ProductNameFilterService;

  beforeEach(() => {
    service = new ProductNameFilterService();
  });

  test('should throw error if filterProductNames called before initialize', async () => {
    await expect(service.filterProductNames('test')).rejects.toThrow('not initialized');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/services/productNameFilterService.test.ts`
Expected: FAIL with "Cannot find module" or "ProductNameFilterService is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export class ProductNameFilterService {
  private medicineNames: string[] = [];
  private initialized: boolean = false;
  private dbPath: string;

  constructor(dbPath: string = './data/app.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const db = await open({ filename: this.dbPath, driver: sqlite3.Database });
    const rows = await db.all('SELECT DISTINCT name FROM medicines WHERE name IS NOT NULL');
    this.medicineNames = rows.map(row => row.name).filter(Boolean);
    await db.close();
    this.initialized = true;
  }

  async filterProductNames(ocrText: string): Promise<string[]> {
    if (!this.initialized) {
      throw new Error('ProductNameFilterService not initialized. Call initialize() first.');
    }
    
    // For now, return empty array - will implement matching logic next
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/services/productNameFilterService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/productNameFilterService.ts tests/services/productNameFilterService.test.ts
git commit -m "feat: create ProductNameFilterService with initialization"
```

## Task 2: ProductNameFilterService - Fuzzy Matching Logic

**Files:**
- Modify: `src/services/productNameFilterService.ts`
- Modify: `tests/services/productNameFilterService.test.ts`

- [ ] **Step 1: Write failing test for fuzzy matching**

```typescript
import { ProductNameFilterService } from '../../../src/services/productNameFilterService';

describe('ProductNameFilterService - Fuzzy Matching', () => {
  let service: ProductNameFilterService;
  const TEST_DB_PATH = './test-data/test-app.db';

  beforeEach(async () => {
    service = new ProductNameFilterService(TEST_DB_PATH);
    // Setup test database with sample medicines
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: TEST_DB_PATH, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      DELETE FROM medicines;
      INSERT INTO medicines (name) VALUES 
        ('Paracetamol 500mg'),
        ('Amoxicillin 250mg Capsule'),
        ('Cetirizine 10mg Tablet'),
        ('Atorvastatin Calcium 20mg');
    `);
    await db.close();
  });

  afterEach(async () => {
    // Cleanup test database
    const { unlink } = await import('fs');
    try {
      await unlink(TEST_DB_PATH);
    } catch {}
  });

  test('should return exact matches', async () => {
    await service.initialize();
    const result = await service.filterProductNames('Paracetamol 500mg');
    expect(result).toContain('Paracetamol 500mg');
  });

  test('should handle case insensitive matching', async () => {
    await service.initialize();
    const result = await service.filterProductNames('PARACETAMOL 500MG');
    expect(result).toContain('Paracetamol 500mg');
  });

  test('should return empty array for no matches', async () => {
    await service.initialize();
    const result = await service.filterProductNames('Nonexistent Drug 500mg');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/services/productNameFilterService.test.ts`
Expected: FAIL - matches return empty array

- [ ] **Step 3: Implement fuzzy matching logic**

```typescript
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Helper function to calculate similarity using Levenshtein distance
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  
  // Simple Levenshtein distance implementation
  const editDistance = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix: number[][] = [];
    
    // Initialize first row and column
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    // Fill the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
      matrix[i] = [];
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  };
  
  const distance = editDistance(s1.toLowerCase(), s2.toLowerCase());
  const maxLen = Math.max(s1.length, s2.length);
  return maxLen === 0 ? 1.0 : 1.0 - distance / maxLen;
}

export class ProductNameFilterService {
  private medicineNames: string[] = [];
  private initialized: boolean = false;
  private dbPath: string;
  private readonly DEFAULT_THRESHOLD = 0.8; // 80% similarity threshold

  constructor(dbPath: string = './data/app.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const db = await open({ filename: this.dbPath, driver: sqlite3.Database });
    const rows = await db.all('SELECT DISTINCT name FROM medicines WHERE name IS NOT NULL');
    this.medicineNames = rows.map(row => row.name).filter(Boolean);
    await db.close();
    this.initialized = true;
  }

  async filterProductNames(ocrText: string, threshold: number = this.DEFAULT_THRESHOLD): Promise<string[]> {
    if (!this.initialized) {
      throw new Error('ProductNameFilterService not initialized. Call initialize() first.');
    }
    
    if (!ocrText || ocrText.trim() === '') {
      return [];
    }
    
    const normalizedOcr = ocrText.toLowerCase().trim();
    const matches: string[] = [];
    
    for (const medicineName of this.medicineNames) {
      const similarityScore = similarity(normalizedOcr, medicineName.toLowerCase());
      if (similarityScore >= threshold) {
        matches.push(medicineName);
      }
    }
    
    // Sort by similarity score (descending) - best matches first
    return matches.sort((a, b) => {
      const scoreA = similarity(normalizedOcr, a.toLowerCase());
      const scoreB = similarity(normalizedOcr, b.toLowerCase());
      return scoreB - scoreA; // descending order
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/services/productNameFilterService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/productNameFilterService.ts tests/services/productNameFilterService.test.ts
git commit -m "feat: add fuzzy matching logic to ProductNameFilterService"
```