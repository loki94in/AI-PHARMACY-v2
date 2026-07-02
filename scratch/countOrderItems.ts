import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const zipPath = path.resolve(__dirname, '..', 'MIGRATION SAMPEL', 'retailerdb_backup_Mon 06_22_2026_22_02_00.36.sql.zip');
const tempDir = path.resolve(__dirname, '..', 'data', 'temp_debug');

async function main() {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const sqlFilePath = path.join(tempDir, 'backup.sql');

  console.log('Decompressing GZIP...');
  const buffer = fs.readFileSync(zipPath);
  const decompressed = zlib.gunzipSync(buffer);
  fs.writeFileSync(sqlFilePath, decompressed);

  console.log('Reading COPY headers and lines...');
  const fileStream = fs.createReadStream(sqlFilePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inOrderItems = false;
  let countT = 0;
  let countF = 0;
  let totalLines = 0;

  for await (const line of rl) {
    if (line.startsWith('COPY public.order_item ')) {
      inOrderItems = true;
      continue;
    }

    if (line.startsWith('\\.')) {
      inOrderItems = false;
      continue;
    }

    if (inOrderItems) {
      totalLines++;
      const parts = line.split('\t');
      const deletedVal = parts[3]; // 4th column is index 3
      if (deletedVal === 't') {
        countT++;
      } else if (deletedVal === 'f') {
        countF++;
      }
    }
  }

  rl.close();
  fileStream.destroy();

  console.log(`\n=== Order Item deleted counts ===`);
  console.log(`Total lines read: ${totalLines}`);
  console.log(`Deleted (t): ${countT}`);
  console.log(`Non-deleted (f): ${countF}`);
  
  // Clean up
  try {
    fs.unlinkSync(sqlFilePath);
    fs.rmdirSync(tempDir);
  } catch (_) {}
}

main().catch(console.error);
