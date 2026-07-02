import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

const prefixes = ['Amo', 'Cef', 'Azith', 'Tel', 'Ome', 'Pan', 'Rab', 'Diclo', 'Para', 'Cet', 'Lev', 'Mont', 'Aml', 'Rosu', 'Ator', 'Glim', 'Met', 'Sit', 'Vild', 'Ten', 'Dap', 'Emp', 'Lin', 'Ery', 'Clin', 'Pip', 'Taz', 'Mero', 'Imi', 'Vanc', 'Line', 'Tige', 'Col', 'Aci', 'Val', 'Fam', 'Gan', 'Cid', 'Fos', 'Riba', 'Sof', 'Vel', 'Led', 'Dac', 'Amp', 'Amox', 'Pen', 'Clox', 'Naf', 'Oxa', 'Meth', 'Carb', 'Tica', 'Azlo', 'Piv', 'Bac', 'Sul', 'Clav', 'Tazo', 'Avi', 'Rele', 'Vabo', 'Cil', 'Erta', 'Dori', 'Pani', 'Bia', 'Far', 'Sano', 'Trilo', 'Nove'];
const suffixes = ['clav', 'ox', 'ral', 'ma', 'praz', 'doc', 'cet', 'kast', 'dipine', 'statin', 'piride', 'formin', 'gliptin', 'flozin', 'mycin', 'bactam', 'penem', 'zolid', 'cycline', 'stin', 'vir', 'previr', 'asvir', 'buvir', 'cillin', 'zole', 'xacin', 'micin', 'kacin', 'pram', 'tine', 'pine', 'sartan', 'lol', 'pril', 'zosin', 'terol', 'lukast', 'pium', 'sone', 'solone', 'nide', 'lone', 'fenac', 'profen', 'xicam', 'coxib', 'tidine', 'prazole', 'setron', 'pitant', 'zine', 'mine', 'line', 'pam', 'lam', 'zepam', 'zolam', 'pride', 'done', 'conazole', 'fungin', 'fine'];
const strengths = ['10mg', '20mg', '40mg', '50mg', '100mg', '150mg', '200mg', '250mg', '400mg', '500mg', '650mg', '800mg', '1000mg', '1gm', '2gm', '5ml', '10ml', '20ml', '50mcg', '100mcg', '200mcg', '0.5mg', '1mg', '2mg', '2.5mg', '5mg', '25mg', '75mg'];
const itemTypes = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Cream', 'Drops', 'Powder', 'Sachet', 'Inhaler'];
const manufacturers = ['Cipla', 'Sun Pharma', 'Lupin', 'Dr. Reddys', 'Aurobindo', 'Intas', 'Glenmark', 'Torrent', 'Mankind', 'Alkem', 'Abbott', 'GSK', 'Pfizer', 'Sanofi', 'Novartis', 'Zydus Cadila', 'Macleods', 'Aristo', 'Emcure', 'Micro Labs', 'USV', 'Alembic', 'Wockhardt', 'J.B. Chemicals', 'FDC', 'Ipca', 'Biocon', 'Serum Institute'];
const apis = ['Paracetamol', 'Amoxycillin', 'Azithromycin', 'Cefixime', 'Cefpodoxime', 'Pantoprazole', 'Rabeprazole', 'Omeprazole', 'Diclofenac', 'Aceclofenac', 'Ibuprofen', 'Naproxen', 'Etoricoxib', 'Telmisartan', 'Amlodipine', 'Losartan', 'Olmesartan', 'Rosuvastatin', 'Atorvastatin', 'Glimepiride', 'Metformin', 'Sitagliptin', 'Teneligliptin', 'Dapagliflozin', 'Levocetirizine', 'Montelukast', 'Fexofenadine', 'Cetirizine', 'Thyroxine', 'Vitamin D3', 'Vitamin C', 'Multivitamin', 'Calcium', 'Iron', 'Zinc', 'B-Complex', 'Ranitidine', 'Ondansetron', 'Domperidone', 'Loperamide', 'ORS', 'Ciprofloxacin', 'Ofloxacin', 'Levofloxacin', 'Amikacin', 'Gentamicin', 'Fluconazole', 'Itraconazole', 'Ketoconazole', 'Clotrimazole', 'Miconazole', 'Terbinafine', 'Albendazole', 'Mebendazole', 'Ivermectin', 'Acyclovir', 'Valacyclovir', 'Oseltamivir', 'Remdesivir', 'Favipiravir', 'Dexamethasone', 'Prednisolone', 'Methylprednisolone', 'Deflazacort', 'Hydrocortisone', 'Fluticasone', 'Budesonide', 'Salbutamol', 'Formoterol', 'Ipratropium', 'Tiotropium', 'Glycopyrrolate', 'Insulin', 'Glipizide', 'Gliclazide', 'Pioglitazone', 'Vildagliptin', 'Saxagliptin', 'Linagliptin', 'Empagliflozin', 'Canagliflozin', 'Ertugliflozin'];
const schedules = ['None', 'H', 'H1', 'X'];

const random = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];

async function seedMassive() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  console.log('Generating 10,000 synthetic Indian medicines...');
  
  // Wrap in a transaction for maximum insertion speed
  await db.exec('BEGIN TRANSACTION');
  
  const stmt = await db.prepare(`
    INSERT INTO medicines 
    (name, api_reference, strength, packaging, item_type, manufacturer, marketed_by, manufactured_by, schedule_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const names = new Set();
  let count = 0;
  const TARGET = 10000;
  
  while (count < TARGET) {
    const brandName = random(prefixes) + random(suffixes) + (Math.random() > 0.5 ? ' ' + random(['Plus', 'Forte', 'SR', 'ER', 'D', 'O', 'M', 'A']) : '');
    const strength = random(strengths);
    
    const uniqueKey = brandName + ' ' + strength;
    if (names.has(uniqueKey)) continue; // ensure uniqueness
    names.add(uniqueKey);
    
    const mfg = random(manufacturers);
    const itemType = random(itemTypes);
    const pkg = itemType === 'Tablet' || itemType === 'Capsule' ? '10x10 ' + random(['Strips', 'Blister']) : '1 ' + random(['Bottle', 'Tube', 'Vial']);
    
    try {
      await stmt.run([
        brandName,
        random(apis) + (Math.random() > 0.7 ? ' + ' + random(apis) : ''),
        strength,
        pkg,
        itemType,
        mfg,
        mfg,
        mfg,
        random(schedules)
      ]);
      count++;
    } catch(e) {
      // Ignore unique constraints or other errors
    }
  }
  
  await stmt.finalize();
  await db.exec('COMMIT');
  await db.close();
  console.log('Successfully seeded ' + count + ' synthetic medicines into the database!');
}

seedMassive().catch(console.error);
