import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Tesseract from 'tesseract.js';
import AdmZip from 'adm-zip';
import cron from 'node-cron';
import { Jimp } from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const TEMP_DIR = path.join(BASE_UPLOAD_DIR, 'temp');
const IMPORTANT_DIR = path.join(BASE_UPLOAD_DIR, 'important');

// Ensure directories exist
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(IMPORTANT_DIR)) fs.mkdirSync(IMPORTANT_DIR, { recursive: true });

export class ImageArchiveService {
  // Common Schedule H1, Narcotic, and Sleeping Pill keywords in India
  private restrictedKeywords = [
    'schedule h1', 'schedule h', 'narcotic', 'psychotropic',
    'alprazolam', 'diazepam', 'lorazepam', 'clonazepam', 'nitrazepam',
    'tramadol', 'codeine', 'zolpidem', 'buprenorphine', 'fentanyl',
    'morphine', 'ketamine', 'phenobarbital', 'midazolam'
  ];

  /**
   * Initializes the Cron Jobs for automatic cleanup and archiving.
   */
  public initJobs() {
    // Run every day at 1:00 AM to clean temp files older than 6 months (180 days)
    cron.schedule('0 1 * * *', () => {
      console.log('Running daily cleanup job for temporary images...');
      this.cleanTemporaryImages(180);
    });

    // Run on the 1st of every month at 2:00 AM to zip the previous month's important files
    cron.schedule('0 2 1 * *', () => {
      console.log('Running monthly archiving job for important images...');
      this.zipMonthlyImportantImages();
    });

    console.log('Image Archive Service background jobs initialized.');
  }

  /**
   * Uses AI OCR to classify an image. If it contains restricted keywords, it moves it to the important folder.
   * Returns true if marked important, false otherwise.
   */
  public async processAndRouteImage(filePath: string): Promise<string | null> {
    try {
      if (!fs.existsSync(filePath)) return null;

      // Use Tesseract to read text from the image
      console.log(`Analyzing image with AI (OCR): ${filePath}`);
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
      const lowerText = text.toLowerCase();

      // Check against restricted guidelines
      const isRestricted = this.restrictedKeywords.some(kw => lowerText.includes(kw));

      const fileName = path.basename(filePath);
      
      let targetPath: string;
      if (isRestricted) {
        // Move to important folder organized by current YYYY-MM
        const date = new Date();
        const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const targetDir = path.join(IMPORTANT_DIR, monthFolder);
        
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        targetPath = path.join(targetDir, fileName);
      } else {
        // Move to temp folder
        targetPath = path.join(TEMP_DIR, fileName);
      }

      // Compress and save to target path, then delete original if they are different
      try {
        const image = await Jimp.read(filePath);
        if (image.width > 800) {
          image.resize({ w: 800 });
        }
        const compressedBuffer = await image.getBuffer('image/jpeg');
        await fs.promises.writeFile(targetPath, compressedBuffer);
        if (filePath !== targetPath) {
          fs.unlinkSync(filePath);
        }
      } catch (compressErr) {
        console.error('Failed to compress routed image with Jimp, renaming instead:', compressErr);
        if (filePath !== targetPath) {
          fs.renameSync(filePath, targetPath);
        }
      }

      if (isRestricted) {
        console.log(`[AI Auto-Detect] Image flagged as H1/Narcotic and compressed/moved to: ${targetPath}`);
      } else {
        console.log(`[AI Auto-Detect] Image marked as temporary and compressed/stored in: ${targetPath}`);
      }
      return targetPath;

    } catch (err) {
      console.error('Error in processAndRouteImage:', err);
      // Default to temp if OCR fails
      const targetPath = path.join(TEMP_DIR, path.basename(filePath));
      try {
        const image = await Jimp.read(filePath);
        if (image.width > 800) {
          image.resize({ w: 800 });
        }
        const compressedBuffer = await image.getBuffer('image/jpeg');
        await fs.promises.writeFile(targetPath, compressedBuffer);
        if (filePath !== targetPath) {
          fs.unlinkSync(filePath);
        }
      } catch (compressErr) {
        if (filePath !== targetPath) {
          fs.renameSync(filePath, targetPath);
        }
      }
      return targetPath;
    }
  }

  /**
   * Manually flag a file as important and move it to the correct folder
   */
  public markAsImportant(fileName: string): boolean {
    const tempPath = path.join(TEMP_DIR, fileName);
    if (!fs.existsSync(tempPath)) return false;

    const date = new Date();
    const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const targetDir = path.join(IMPORTANT_DIR, monthFolder);
    
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    fs.renameSync(tempPath, path.join(targetDir, fileName));
    return true;
  }

  /**
   * Deletes files in the temp folder older than specific days (default 180 days = ~6 months)
   */
  public cleanTemporaryImages(daysOld: number = 180) {
    try {
      const now = Date.now();
      const cutoff = now - (daysOld * 24 * 60 * 60 * 1000);

      const files = fs.readdirSync(TEMP_DIR);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      
      console.log(`Cleanup complete. Deleted ${deletedCount} temporary images older than ${daysOld} days.`);
    } catch (err) {
      console.error('Error during temp cleanup:', err);
    }
  }

  /**
   * Zips the previous month's important folder and deletes the raw folder
   */
  public zipMonthlyImportantImages() {
    try {
      // Determine previous month
      const date = new Date();
      date.setMonth(date.getMonth() - 1);
      const prevMonthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const targetDir = path.join(IMPORTANT_DIR, prevMonthFolder);
      if (!fs.existsSync(targetDir)) {
        console.log(`No important folder found for ${prevMonthFolder} to zip.`);
        return;
      }

      const zipName = `H1_Rx_Archive_${prevMonthFolder}.zip`;
      const zipPath = path.join(IMPORTANT_DIR, zipName);

      const zip = new AdmZip();
      zip.addLocalFolder(targetDir);
      zip.writeZip(zipPath);

      console.log(`Successfully created archive: ${zipPath}`);

      // Delete the uncompressed folder
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`Deleted raw folder to save space: ${targetDir}`);
    } catch (err) {
      console.error('Error during monthly zipping:', err);
    }
  }
}

export const imageArchiveService = new ImageArchiveService();
