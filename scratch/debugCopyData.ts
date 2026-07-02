import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';
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

  let inOrders = false;
  let inOrderItems = false;
  let orderCount = 0;
  let itemCount = 0;

  for await (const line of rl) {
    if (line.startsWith('COPY public.orders ')) {
      console.log('\n--- Orders COPY Header ---');
      console.log(line);
      inOrders = true;
      continue;
    }
    if (line.startsWith('COPY public.order_item ')) {
      console.log('\n--- Order Item COPY Header ---');
      console.log(line);
      inOrderItems = true;
      continue;
    }

    if (line.startsWith('\\.')) {
      inOrders = false;
      inOrderItems = false;
      continue;
    }

    if (inOrders && orderCount < 5) {
      console.log(`Order data: ${line}`);
      orderCount++;
    }
    if (inOrderItems && itemCount < 5) {
      console.log(`Item data: ${line}`);
      itemCount++;
    }

    if (orderCount >= 5 && itemCount >= 5) {
      break;
    }
  }

  rl.close();
  fileStream.destroy();
  
  // Clean up
  try {
    fs.unlinkSync(sqlFilePath);
    fs.rmdirSync(tempDir);
  } catch (_) {}
}

main().catch(console.error);
