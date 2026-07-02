// Failing test for missing pdfGenerator module
import { createPdf } from '../../src/utils/pdfGenerator.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('PDF Generator (missing)', () => {
  test('should generate a PDF file', async () => {
    const data = [{ name: 'Item1', date: '2023-01-01' }];
    const outPath = path.join(os.tmpdir(), 'test-missing.pdf');
    await createPdf(data, 'Test Title', outPath);
    const exists = fs.existsSync(outPath);
    expect(exists).toBe(true);
  });
});
