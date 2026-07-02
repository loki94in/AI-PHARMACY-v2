import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'temp');
const RAW_DIR = path.resolve(__dirname, '..', '..', 'catalogue', 'raw');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

// Multer storage config
const ALLOWED_UPLOAD_EXTENSIONS = /\.(csv|xlsx?|pdf|zip|jpg|jpeg|png|gif|bmp|tiff?)$/i;
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + sanitized);
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_EXTENSIONS.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

const router = express.Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const tempPath = req.file.path;
    const originalName = req.file.originalname || path.basename(tempPath);

    // Save copy in raw directory
    const timestamp = Date.now();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const rawFileName = `${timestamp}-${sanitizedName}`;
    const rawPath = path.join(RAW_DIR, rawFileName);

    fs.copyFileSync(tempPath, rawPath);
    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.warn('Failed to delete temporary upload file:', err);
    }

    const ext = path.extname(originalName).toLowerCase();
    if (!['.csv', '.xlsx', '.xls', '.pdf'].includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file format. Please upload a CSV, PDF, or Excel file.' });
    }

    const db = await dbManager.getConnection();

    // Insert job into catalog_jobs with 'pending_analysis' status
    const result = await db.run(
      `INSERT INTO catalog_jobs (file_path, original_filename, status) VALUES (?, ?, 'pending_analysis')`,
      [rawPath, originalName]
    );
    const jobId = result.lastID as number;
    await dbManager.close();

    // Trigger analysis asynchronously inline to speed it up
    import('../worker/catalogWorker.js')
      .then(({ runCatalogAnalysis }) => {
        runCatalogAnalysis(jobId).catch(err => console.error('Background catalog analysis failed:', err));
      })
      .catch(err => console.error('Failed to load runCatalogAnalysis from worker:', err));

    res.json({
      success: true,
      jobId,
      status: 'pending_analysis'
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Internal server error during upload' });
  }
});

export default router;
