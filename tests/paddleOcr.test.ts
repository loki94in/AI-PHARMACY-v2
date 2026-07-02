import dotenv from 'dotenv';
dotenv.config();

import vm from 'vm';
// Fix Jest VM Float32Array instanceof checks for native ONNX Runtime addon
Object.defineProperty(Float32Array, Symbol.hasInstance, {
  value: (inst: any) => inst && inst.constructor && inst.constructor.name === 'Float32Array'
});

import { onnxOcrService } from '../src/services/onnxOcrService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';
import fs from 'fs';
import path from 'path';

describe('PaddleOCR Service and AI Camera Service Integration', () => {
  const dummyBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    const os = await import('os');
    const { ensureSchema } = await import('../src/database.js');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddleocr-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;
  });

  afterAll(async () => {
    await aiCameraService.terminate();
    await onnxOcrService.unloadModel();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('onnxOcrService.checkAvailability should execute and return a boolean', async () => {
    const isAvailable = await onnxOcrService.checkAvailability();
    expect(typeof isAvailable).toBe('boolean');
    console.log(`[Test] PaddleOCR availability check result: ${isAvailable}`);
  }, 90000);

  test('aiCameraService.processImage should process image and return results (PaddleOCR or Tesseract.js fallback)', async () => {
    // Process dummy image
    const result = await aiCameraService.processImage(dummyBase64Image);
    
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(Array.isArray(result.words)).toBe(true);
    expect(result.medicineInfo).toBeDefined();
    expect(result.matches).toBeDefined();
    expect(typeof result.fallbackUsed).toBe('boolean');
    
    console.log('[Test] OCR Processed text:', JSON.stringify(result.text));
    console.log('[Test] OCR Confidence:', result.confidence);
    console.log('[Test] Fallback used:', result.fallbackUsed);
  }, 90000); // 90s timeout for OCR initialization if running for first time
});
