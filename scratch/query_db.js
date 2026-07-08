import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

async function main() {
  const dbPath = path.resolve('data', 'app.db');
  console.log('Connecting to:', dbPath);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  try {
    console.log('--- wa_admin_escalations ---');
    const escalations = await db.all("SELECT * FROM wa_admin_escalations ORDER BY id DESC LIMIT 5");
    console.log(escalations);

    console.log('--- staged_medicine_reviews ---');
    const reviews = await db.all("SELECT * FROM staged_medicine_reviews ORDER BY id DESC LIMIT 5");
    console.log(reviews);

    console.log('--- Searching for azetor 20 ---');
    const searchEsc = await db.all("SELECT * FROM wa_admin_escalations WHERE medicine_key LIKE '%azetor%'");
    console.log('Escalations matching azetor:', searchEsc);

    const searchRev = await db.all("SELECT * FROM staged_medicine_reviews WHERE lower(medicine_name) LIKE '%azetor%'");
    console.log('Reviews matching azetor:', searchRev);

    const searchMed = await db.all("SELECT * FROM medicines WHERE lower(name) LIKE '%azetor%'");
    console.log('Medicines matching azetor:', searchMed);

  } catch (err) {
    console.error(err);
  } finally {
    await db.close();
  }
}

main();
