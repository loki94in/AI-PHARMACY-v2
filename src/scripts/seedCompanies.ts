import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

// ─── 75 Indian + Global Pharmaceutical Companies ───────────────────────────
const pharmaCompanies = [
  // Top Indian Pharma
  { name: 'Cipla Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'Sun Pharmaceutical Industries', city: 'Mumbai', type: 'pharma' },
  { name: 'Dr. Reddys Laboratories', city: 'Hyderabad', type: 'pharma' },
  { name: 'Lupin Limited', city: 'Mumbai', type: 'pharma' },
  { name: 'Aurobindo Pharma', city: 'Hyderabad', type: 'pharma' },
  { name: 'Alkem Laboratories', city: 'Mumbai', type: 'pharma' },
  { name: 'Torrent Pharmaceuticals', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Glenmark Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Mankind Pharma', city: 'New Delhi', type: 'pharma' },
  { name: 'Zydus Cadila', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Intas Pharmaceuticals', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Macleods Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Emcure Pharmaceuticals', city: 'Pune', type: 'pharma' },
  { name: 'Alembic Pharmaceuticals', city: 'Vadodara', type: 'pharma' },
  { name: 'Wockhardt Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'J.B. Chemicals & Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Micro Labs Ltd.', city: 'Bangalore', type: 'pharma' },
  { name: 'USV Private Limited', city: 'Mumbai', type: 'pharma' },
  { name: 'Aristo Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'FDC Limited', city: 'Mumbai', type: 'pharma' },
  { name: 'Ipca Laboratories', city: 'Mumbai', type: 'pharma' },
  { name: 'Biocon Limited', city: 'Bangalore', type: 'pharma' },
  { name: 'Cadila Pharmaceuticals', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Elder Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Unichem Laboratories', city: 'Mumbai', type: 'pharma' },
  { name: 'Strides Pharma Science', city: 'Bangalore', type: 'pharma' },
  { name: 'Granules India', city: 'Hyderabad', type: 'pharma' },
  { name: 'Divi Laboratories', city: 'Hyderabad', type: 'pharma' },
  { name: 'Natco Pharma', city: 'Hyderabad', type: 'pharma' },
  { name: 'Laurus Labs', city: 'Hyderabad', type: 'pharma' },
  { name: 'Suven Pharmaceuticals', city: 'Hyderabad', type: 'pharma' },
  { name: 'Gufic Biosciences', city: 'Mumbai', type: 'pharma' },
  { name: 'Himalaya Drug Company', city: 'Bangalore', type: 'pharma' },
  { name: 'Dabur India Ltd.', city: 'Ghaziabad', type: 'pharma' },
  { name: 'Hamdard Laboratories', city: 'New Delhi', type: 'pharma' },
  { name: 'Baidyanath Group', city: 'Kolkata', type: 'pharma' },
  { name: 'Zandu Pharmaceutical Works', city: 'Mumbai', type: 'pharma' },
  { name: 'Patanjali Ayurved Ltd.', city: 'Haridwar', type: 'pharma' },
  { name: 'Shree Baidyanath Ayurved Bhawan', city: 'Nagpur', type: 'pharma' },
  { name: 'Serum Institute of India', city: 'Pune', type: 'pharma' },
  { name: 'Bharat Biotech', city: 'Hyderabad', type: 'pharma' },
  { name: 'Piramal Pharma', city: 'Mumbai', type: 'pharma' },
  { name: 'Eris Lifesciences', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Indoco Remedies', city: 'Mumbai', type: 'pharma' },
  { name: 'Shreya Life Sciences', city: 'Aurangabad', type: 'pharma' },
  { name: 'Plethico Pharmaceuticals', city: 'Indore', type: 'pharma' },
  { name: 'Venus Remedies', city: 'Chandigarh', type: 'pharma' },
  { name: 'Morepen Laboratories', city: 'New Delhi', type: 'pharma' },
  { name: 'Windlas Biotech', city: 'Dehradun', type: 'pharma' },
  { name: 'Aarti Drugs', city: 'Mumbai', type: 'pharma' },
  // MNC Pharma with India presence
  { name: 'Abbott India Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'GlaxoSmithKline Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Pfizer Ltd. India', city: 'Mumbai', type: 'pharma' },
  { name: 'Sanofi India Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'Novartis India Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'AstraZeneca India', city: 'Bangalore', type: 'pharma' },
  { name: 'Roche Products India', city: 'Mumbai', type: 'pharma' },
  { name: 'Bayer Pharmaceuticals India', city: 'Mumbai', type: 'pharma' },
  { name: 'Boehringer Ingelheim India', city: 'Mumbai', type: 'pharma' },
  { name: 'Merck India Ltd.', city: 'Mumbai', type: 'pharma' },
  { name: 'MSD Pharmaceuticals India', city: 'Mumbai', type: 'pharma' },
  { name: 'Janssen India (J&J)', city: 'Mumbai', type: 'pharma' },
  { name: 'Eli Lilly India', city: 'Mumbai', type: 'pharma' },
  { name: 'Bristol-Myers Squibb India', city: 'Mumbai', type: 'pharma' },
  { name: 'Mylan Pharmaceuticals India', city: 'Hyderabad', type: 'pharma' },
  { name: 'Fresenius Kabi India', city: 'Pune', type: 'pharma' },
  { name: 'B. Braun Medical India', city: 'Ahmedabad', type: 'pharma' },
  { name: 'Becton Dickinson India', city: 'Gurgaon', type: 'pharma' },
  { name: 'Win-Medicare Pvt. Ltd.', city: 'New Delhi', type: 'pharma' },
  { name: 'Centaur Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
  { name: 'Systopic Laboratories', city: 'New Delhi', type: 'pharma' },
  { name: 'Psycorem Pharmaceuticals', city: 'Chandigarh', type: 'pharma' },
  { name: 'Biochem Pharmaceutical', city: 'Mumbai', type: 'pharma' },
  { name: 'Wallace Pharmaceuticals', city: 'Mumbai', type: 'pharma' },
];

// ─── 25 Indian + Global Cosmetic Companies ────────────────────────────────
const cosmeticCompanies = [
  { name: 'Hindustan Unilever Ltd.', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Procter & Gamble India', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Marico Limited', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Emami Limited', city: 'Kolkata', type: 'cosmetic' },
  { name: 'Godrej Consumer Products', city: 'Mumbai', type: 'cosmetic' },
  { name: 'CavinKare Pvt. Ltd.', city: 'Chennai', type: 'cosmetic' },
  { name: 'VLCC Health Care', city: 'Gurgaon', type: 'cosmetic' },
  { name: 'Biotique Ayurveda', city: 'New Delhi', type: 'cosmetic' },
  { name: 'Forest Essentials', city: 'New Delhi', type: 'cosmetic' },
  { name: 'Lotus Herbals', city: 'New Delhi', type: 'cosmetic' },
  { name: 'Himalaya Wellness (Cosmetics)', city: 'Bangalore', type: 'cosmetic' },
  { name: 'Shahnaz Husain Group', city: 'New Delhi', type: 'cosmetic' },
  { name: 'Jolen Creme Bleach (India)', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Revlon India', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Lakme (Unilever)', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Ponds India', city: 'Mumbai', type: 'cosmetic' },
  { name: "L'Oreal India Pvt. Ltd.", city: 'Mumbai', type: 'cosmetic' },
  { name: 'Nivea India (Beiersdorf)', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Johnson & Johnson Consumer India', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Neutrogena India', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Garnier India', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Olay India (P&G)', city: 'Mumbai', type: 'cosmetic' },
  { name: 'Dove India (Unilever)', city: 'Mumbai', type: 'cosmetic' },
  { name: 'WOW Skin Science', city: 'Bangalore', type: 'cosmetic' },
  { name: 'Mamaearth Honasa Consumer', city: 'Gurgaon', type: 'cosmetic' },
];

async function seedCompanies() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  const allCompanies = [...pharmaCompanies, ...cosmeticCompanies];
  console.log(`Seeding ${pharmaCompanies.length} pharma + ${cosmeticCompanies.length} cosmetic companies...`);

  await db.exec('BEGIN TRANSACTION');

  const stmt = await db.prepare(`
    INSERT OR IGNORE INTO distributors (name, city)
    VALUES (?, ?)
  `);

  let pharmaCount = 0;
  let cosmeticCount = 0;

  for (const company of allCompanies) {
    try {
      await stmt.run([company.name, company.city]);
      if (company.type === 'pharma') pharmaCount++;
      else cosmeticCount++;
    } catch (e: any) {
      console.error('Error inserting:', company.name, e.message);
    }
  }

  await stmt.finalize();
  await db.exec('COMMIT');

  const total = await db.get('SELECT COUNT(*) as c FROM distributors');
  console.log(`\n✅ Done!`);
  console.log(`   Pharma companies added: ${pharmaCount}`);
  console.log(`   Cosmetic companies added: ${cosmeticCount}`);
  console.log(`   Total distributors in DB: ${(total as any).c}`);

  await db.close();
}

seedCompanies().catch(console.error);
