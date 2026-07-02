import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

const popularMeds = [
  { name: 'Dolo 650', api: 'Paracetamol', strength: '650mg', manufacturer: 'Micro Labs', type: 'Tablet', schedule: null },
  { name: 'Calpol 500', api: 'Paracetamol', strength: '500mg', manufacturer: 'GSK', type: 'Tablet', schedule: null },
  { name: 'Pan 40', api: 'Pantoprazole', strength: '40mg', manufacturer: 'Alkem', type: 'Tablet', schedule: null },
  { name: 'Pan D', api: 'Pantoprazole + Domperidone', strength: '40mg+30mg', manufacturer: 'Alkem', type: 'Capsule', schedule: null },
  { name: 'Augmentin 625 Duo', api: 'Amoxycillin + Clavulanic Acid', strength: '625mg', manufacturer: 'GSK', type: 'Tablet', schedule: 'H1' },
  { name: 'Monocef O 200', api: 'Cefpodoxime', strength: '200mg', manufacturer: 'Aristo', type: 'Tablet', schedule: 'H1' },
  { name: 'Azithral 500', api: 'Azithromycin', strength: '500mg', manufacturer: 'Alembic', type: 'Tablet', schedule: 'H1' },
  { name: 'Allegra 120', api: 'Fexofenadine', strength: '120mg', manufacturer: 'Sanofi', type: 'Tablet', schedule: null },
  { name: 'Okacet', api: 'Cetirizine', strength: '10mg', manufacturer: 'Cipla', type: 'Tablet', schedule: null },
  { name: 'Montair LC', api: 'Montelukast + Levocetirizine', strength: '10mg+5mg', manufacturer: 'Cipla', type: 'Tablet', schedule: 'H' },
  { name: 'Ascoril LS', api: 'Ambroxol + Levosalbutamol + Guaifenesin', strength: 'Syrup', manufacturer: 'Glenmark', type: 'Syrup', schedule: null },
  { name: 'Corex DX', api: 'Chlorpheniramine + Dextromethorphan', strength: 'Syrup', manufacturer: 'Pfizer', type: 'Syrup', schedule: null },
  { name: 'Thyronorm 50', api: 'Thyroxine', strength: '50mcg', manufacturer: 'Abbott', type: 'Tablet', schedule: 'H' },
  { name: 'Ecosprin 75', api: 'Aspirin', strength: '75mg', manufacturer: 'USV', type: 'Tablet', schedule: null },
  { name: 'Clopilet', api: 'Clopidogrel', strength: '75mg', manufacturer: 'Sun Pharma', type: 'Tablet', schedule: 'H' },
  { name: 'Telma 40', api: 'Telmisartan', strength: '40mg', manufacturer: 'Glenmark', type: 'Tablet', schedule: 'H' },
  { name: 'Telma H', api: 'Telmisartan + Hydrochlorothiazide', strength: '40mg+12.5mg', manufacturer: 'Glenmark', type: 'Tablet', schedule: 'H' },
  { name: 'Glycomet GP 1', api: 'Glimepiride + Metformin', strength: '1mg+500mg', manufacturer: 'USV', type: 'Tablet', schedule: 'H' },
  { name: 'Glycomet GP 2', api: 'Glimepiride + Metformin', strength: '2mg+500mg', manufacturer: 'USV', type: 'Tablet', schedule: 'H' },
  { name: 'Janumet 50/500', api: 'Sitagliptin + Metformin', strength: '50mg+500mg', manufacturer: 'MSD', type: 'Tablet', schedule: 'H' },
  { name: 'Udapa 10', api: 'Dapagliflozin', strength: '10mg', manufacturer: 'Cipla', type: 'Tablet', schedule: 'H' },
  { name: 'Cilacar 10', api: 'Cilnidipine', strength: '10mg', manufacturer: 'J.B. Chemicals', type: 'Tablet', schedule: 'H' },
  { name: 'Voveran SR 100', api: 'Diclofenac', strength: '100mg', manufacturer: 'Novartis', type: 'Tablet', schedule: 'H' },
  { name: 'Zerodol SP', api: 'Aceclofenac + Serratiopeptidase + Paracetamol', strength: '100mg+15mg+325mg', manufacturer: 'Ipca', type: 'Tablet', schedule: null },
  { name: 'Ultracet', api: 'Tramadol + Paracetamol', strength: '37.5mg+325mg', manufacturer: 'Janssen', type: 'Tablet', schedule: 'H1' },
  { name: 'Aciloc 150', api: 'Ranitidine', strength: '150mg', manufacturer: 'Cadila', type: 'Tablet', schedule: null },
  { name: 'Omez 20', api: 'Omeprazole', strength: '20mg', manufacturer: 'Dr. Reddys', type: 'Capsule', schedule: null },
  { name: 'Eldoper', api: 'Loperamide', strength: '2mg', manufacturer: 'Micro Labs', type: 'Tablet', schedule: null },
  { name: 'Electral', api: 'ORS', strength: 'Sachet', manufacturer: 'FDC', type: 'Powder', schedule: null },
  { name: 'Taxim O 200', api: 'Cefixime', strength: '200mg', manufacturer: 'Alkem', type: 'Tablet', schedule: 'H1' },
  { name: 'Azee 500', api: 'Azithromycin', strength: '500mg', manufacturer: 'Cipla', type: 'Tablet', schedule: 'H1' },
  { name: 'Betadine 5%', api: 'Povidone Iodine', strength: '5%', manufacturer: 'Win-Medicare', type: 'Ointment', schedule: null },
  { name: 'Soframycin', api: 'Framycetin', strength: '1%', manufacturer: 'Sanofi', type: 'Cream', schedule: null },
  { name: 'Atarax 25', api: 'Hydroxyzine', strength: '25mg', manufacturer: 'Dr. Reddys', type: 'Tablet', schedule: 'H' },
  { name: 'Evion 400', api: 'Vitamin E', strength: '400mg', manufacturer: 'P&G', type: 'Capsule', schedule: null },
  { name: 'Becosules', api: 'B-Complex + Vitamin C', strength: 'Cap', manufacturer: 'Pfizer', type: 'Capsule', schedule: null },
  { name: 'Shelcal 500', api: 'Calcium + Vitamin D3', strength: '500mg+250IU', manufacturer: 'Torrent', type: 'Tablet', schedule: null },
  { name: 'Limcee 500', api: 'Vitamin C', strength: '500mg', manufacturer: 'Abbott', type: 'Tablet', schedule: null },
  { name: 'A to Z Gold', api: 'Multivitamin', strength: 'Cap', manufacturer: 'Alkem', type: 'Capsule', schedule: null },
  { name: 'Dexona', api: 'Dexamethasone', strength: '0.5mg', manufacturer: 'Zydus', type: 'Tablet', schedule: 'H' },
  { name: 'Liv 52', api: 'Ayurvedic Liver Tonic', strength: 'Tab', manufacturer: 'Himalaya', type: 'Tablet', schedule: null },
  { name: 'Volini', api: 'Diclofenac Diethylamine', strength: 'Gel', manufacturer: 'Sun Pharma', type: 'Gel', schedule: null },
  { name: 'Vicks Vaporub', api: 'Camphor + Menthol + Eucalyptus', strength: 'Ointment', manufacturer: 'P&G', type: 'Ointment', schedule: null }
];

async function seed() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  console.log('Seeding top Indian medicines...');
  
  const stmt = await db.prepare(`
    INSERT INTO medicines 
    (name, api_reference, strength, item_type, manufacturer, marketed_by, manufactured_by, schedule_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let count = 0;
  for (const med of popularMeds) {
    try {
      await stmt.run([
        med.name,
        med.api,
        med.strength,
        med.type,
        med.manufacturer,
        med.manufacturer,
        med.manufacturer,
        med.schedule
      ]);
      count++;
    } catch(e:any) {
      if(!e.message.includes('UNIQUE')) console.error(e.message);
    }
  }
  
  await stmt.finalize();
  await db.close();
  console.log('Successfully seeded ' + count + ' medicines into the database!');
}

seed().catch(console.error);
