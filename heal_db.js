import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function main() {
  const dbPath = './data/app.db';
  console.log(`Starting database FTS5 healing process for: ${dbPath}`);

  let db;
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  } catch (err) {
    console.error(`[Error] Failed to open database. If the server is running, you may need to stop it first.`);
    console.error(err.message);
    process.exit(1);
  }

  try {
    // 1. Drop existing triggers if they exist (to prevent trigger errors when recreating)
    console.log('Dropping existing triggers...');
    await db.exec(`DROP TRIGGER IF EXISTS medicines_ai`);
    await db.exec(`DROP TRIGGER IF EXISTS medicines_ad`);
    await db.exec(`DROP TRIGGER IF EXISTS medicines_au`);

    // 2. Create dummy FTS5 tables to satisfy SQLite's virtual table constructor
    console.log('Re-creating dummy FTS5 shadow tables...');
    await db.exec(`CREATE TABLE IF NOT EXISTS 'medicines_fts_data'(id INTEGER PRIMARY KEY, block BLOB)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS 'medicines_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID`);
    await db.exec(`CREATE TABLE IF NOT EXISTS 'medicines_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS 'medicines_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID`);

    // Clear any temporary/dummy data
    await db.exec(`DELETE FROM medicines_fts_data`);
    await db.exec(`DELETE FROM medicines_fts_idx`);
    await db.exec(`DELETE FROM medicines_fts_docsize`);
    await db.exec(`DELETE FROM medicines_fts_config`);

    // Initialize FTS5 headers to prevent 'invalid fts5 file format' error during DROP
    await db.run(`INSERT INTO medicines_fts_config(k, v) VALUES('version', 4)`);
    await db.run(`INSERT INTO medicines_fts_data(id, block) VALUES(10, x'000000000101010001010101')`);

    // 3. Drop the broken virtual table
    console.log('Dropping broken medicines_fts virtual table...');
    await db.exec(`DROP TABLE medicines_fts`);

    // 4. Drop the dummy shadow tables
    console.log('Cleaning up dummy shadow tables...');
    await db.exec(`DROP TABLE IF EXISTS medicines_fts_data`);
    await db.exec(`DROP TABLE IF EXISTS medicines_fts_idx`);
    await db.exec(`DROP TABLE IF EXISTS medicines_fts_docsize`);
    await db.exec(`DROP TABLE IF EXISTS medicines_fts_config`);

    // 5. Recreate the FTS5 virtual table fresh
    console.log('Creating fresh medicines_fts virtual table...');
    await db.exec(`CREATE VIRTUAL TABLE medicines_fts USING fts5(name, content='medicines', content_rowid='id', tokenize='trigram')`);

    // 6. Recreate triggers
    console.log('Re-creating triggers...');
    await db.exec(`
      CREATE TRIGGER medicines_ai AFTER INSERT ON medicines BEGIN
        INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
      END;
      CREATE TRIGGER medicines_ad AFTER DELETE ON medicines BEGIN
        INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
      END;
      CREATE TRIGGER medicines_au AFTER UPDATE ON medicines BEGIN
        INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
        INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
      END;
    `);

    // 7. Backfill from medicines table
    console.log('Backfilling FTS5 search index from medicines table...');
    const medCount = await db.get('SELECT COUNT(*) as cnt FROM medicines');
    if (medCount && medCount.cnt > 0) {
      await db.exec(`INSERT INTO medicines_fts(rowid, name) SELECT id, name FROM medicines`);
      console.log(`Successfully indexed ${medCount.cnt} medicines.`);
    } else {
      console.log('Medicines table is empty. No rows to backfill.');
    }

    console.log('Database FTS5 healing completed successfully! 🎉');
  } catch (err) {
    console.error('An error occurred during the healing process:', err.message);
  } finally {
    await db.close();
  }
}

main();
