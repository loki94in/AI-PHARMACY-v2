import { emailService } from '../src/services/emailService.js';
import { dbManager } from '../src/database/connection.js';

async function run() {
  console.log('Starting manual sync test from script...');
  try {
    const synced = await emailService.syncNewEmailsFromIMAP();
    console.log('Sync finished! Synced count:', synced);
  } catch (err) {
    console.error('Fatal sync error in test script:', err);
  } finally {
    await dbManager.close(true);
    console.log('Database connection closed.');
  }
}

run();
