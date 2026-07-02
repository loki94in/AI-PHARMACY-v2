import { runManualMigration, migrationStatus } from '../src/worker/migrationWorker.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const fileName = 'retailerdb_backup_Mon 06_22_2026_22_02_00.36.sql.zip';
  console.log('Starting migration for:', fileName);
  
  // Start migration
  await runManualMigration(fileName, 'inventory');

  // Monitor status
  const interval = setInterval(() => {
    console.log(`Progress: ${migrationStatus.progress}% | Message: ${migrationStatus.message} | Errors: ${migrationStatus.errorCount}`);
    if (!migrationStatus.active) {
      clearInterval(interval);
      console.log('Migration finished!');
      console.log('Final Status:', JSON.stringify(migrationStatus, null, 2));
      process.exit(migrationStatus.progress === 100 ? 0 : 1);
    }
  }, 2000);
}

main().catch(console.error);
