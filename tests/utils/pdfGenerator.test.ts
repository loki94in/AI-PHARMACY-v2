import { createPdf } from '../../src/utils/pdfGenerator.js';
import os from 'os';
import fs from 'fs';
import path from 'path';

describe('PDF generation', () => {
  const outFile = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);

  afterAll(() => {
    // Clean up the temp file if it exists
    try { fs.unlinkSync(outFile); } catch (_) {}
  });

  test('creates a non‑empty PDF file', async () => {
    const data = [
      { name: 'MedA', date: '2023-01-01' },
      { name: 'MedB', date: '2023-02-15' },
    ];
    await createPdf(data, 'Test PDF', outFile);
    const stats = fs.statSync(outFile);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
  });
});
