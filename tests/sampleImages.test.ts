import dotenv from 'dotenv';
dotenv.config();

import { aiCameraService } from '../src/services/aiCameraService.js';
import fs from 'fs';
import path from 'path';

describe('Real Image Batch Processing Test', () => {
  const sampleDir = path.resolve(process.cwd(), 'image sample');
  let dbPath: string;

  beforeAll(async () => {
    // Setup temporary database to allow the service to boot properly
    const os = await import('os');
    const { ensureSchema } = await import('../src/database.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-batch-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;
  });

  afterAll(async () => {
    await aiCameraService.terminate();
  });

  it('should process all valid images in the sample directory', async () => {
    if (!fs.existsSync(sampleDir)) {
      console.warn(`[Warning] Sample directory not found at ${sampleDir}`);
      return;
    }

    const files = fs.readdirSync(sampleDir);
    // Automatically filter for valid image formats (jpeg, jpg, png, etc.)
    const validImageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp'];
    
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return validImageExtensions.includes(ext);
    });

    console.log(`Found ${imageFiles.length} valid images to test in "${sampleDir}"`);

    for (const file of imageFiles) {
      const filePath = path.join(sampleDir, file);
      console.log(`\n----------------------------------------------------`);
      console.log(`Testing image: ${file}`);
      
      const imageBuffer = fs.readFileSync(filePath);
      
      // Process image
      const result = await aiCameraService.processImage(imageBuffer);
      
      console.log(`- Confidence:    ${result.confidence}%`);
      console.log(`- Engine Used:   ${result.fallbackUsed ? 'Tesseract (Fallback)' : 'PaddleOCR (AI)'}`);
      console.log(`- Detected Meds: ${result.matches.join(', ') || 'None found in DB'}`);
      console.log(`- Extracted Details: ${JSON.stringify(result.medicineInfo)}`);
      console.log(`- Extracted Text Snippet:`);
      console.log(result.text.split('\n').slice(0, 5).join('\n') + (result.text.split('\n').length > 5 ? '\n...' : ''));
    }
  }, 120000); // 120 seconds timeout for processing multiple images
});
