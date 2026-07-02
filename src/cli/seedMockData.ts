import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const DOCTORS = [
  { name: 'Dr. Aditi Sharma', degree: 'MBBS, MD', reg_no: 'REG-10293', hospital: 'City General Hospital', phone: '9876543210', address: '12 Medical Lane, Delhi', speciality: 'General Physician' },
  { name: 'Dr. Rajesh Verma', degree: 'MBBS, DCH', reg_no: 'REG-58473', hospital: 'Sunshine Clinic', phone: '9876543211', address: '45 Park Avenue, Mumbai', speciality: 'Pediatrician' },
  { name: 'Dr. Lisa Cuddy', degree: 'MD, MHA', reg_no: 'REG-98721', hospital: 'Princeton-Plainsboro', phone: '9876543212', address: 'Princeton, NJ', speciality: 'Endocrinologist' },
  { name: 'Dr. Gregory House', degree: 'MD', reg_no: 'REG-00001', hospital: 'Princeton-Plainsboro', phone: '9876543213', address: 'Princeton, NJ', speciality: 'Infectious Disease' },
  { name: 'Dr. Priya Patel', degree: 'MBBS, DNB', reg_no: 'REG-29384', hospital: 'Apollo Health City', phone: '9876543214', address: 'Jubilee Hills, Hyderabad', speciality: 'Gynecologist' },
  { name: 'Dr. Amit Shah', degree: 'MBBS, MS (Ortho)', reg_no: 'REG-83920', hospital: 'Fortis Hospital', phone: '9876543215', address: 'Bannerghatta Road, Bangalore', speciality: 'Orthopedic Surgeon' }
];

const CUSTOMERS = [
  { name: 'Ramesh Kumar', phone: '9123456780', address: 'Sec 12, Dwarka, Delhi', notes: 'Regular patient for Metformin' },
  { name: 'Suresh Gupta', phone: '9123456781', address: 'Mulund West, Mumbai', notes: 'Prefers strip sales' },
  { name: 'Anita Desai', phone: '9123456782', address: 'Banjara Hills, Hyderabad', notes: 'Needs WhatsApp receipts' },
  { name: 'Robert Downey', phone: '9123456783', address: 'Malibu, CA', notes: 'Loves blueberries' },
  { name: 'Tony Stark', phone: '9123456784', address: 'Stark Tower, NY', notes: 'Frequent buyer of cardiac medicines' },
  { name: 'Bruce Wayne', phone: '9123456785', address: 'Wayne Manor, Gotham', notes: 'Pays always with Credit/UPI' },
  { name: 'Clark Kent', phone: '9123456786', address: 'Smallville, Kansas', notes: 'Allergic to Kryptonite' },
  { name: 'Hermione Granger', phone: '9123456787', address: 'Hampstead, London', notes: 'Very intelligent, checks expiry' },
  { name: 'Harry Potter', phone: '9123456788', address: 'Privet Drive, Surrey', notes: 'Scar care products' },
  { name: 'John Doe', phone: '9123456789', address: 'General Area, City', notes: 'Standard walk-in customer profile' }
];

const DISTRIBUTORS = [
  { name: 'City Pharma Distributors', contact: '9000100020', address: 'Daryaganj, Delhi', gstin: '07AAAAA1111A1Z1', city: 'Delhi', email: 'city@pharma.com' },
  { name: 'Apollo Wholesale Drugs', contact: '9000100021', address: 'Begumpet, Hyderabad', gstin: '36BBBBB2222B2Z2', city: 'Hyderabad', email: 'apollo@wholesale.com' },
  { name: 'MedPlus Distribution Logistics', contact: '9000100022', address: 'Peenya, Bangalore', gstin: '29CCCCC3333C3Z3', city: 'Bangalore', email: 'medplus@dist.com' }
];

const MEDICINE_TEMPLATES = [
  { name: 'Paracetamol 650mg', comp: 'Paracetamol IP', cat: 'Analgesic', pkg: '10 Tablets/Strip' },
  { name: 'Ibuprofen 400mg', comp: 'Ibuprofen IP', cat: 'NSAID', pkg: '15 Tablets/Strip' },
  { name: 'Amoxicillin 500mg', comp: 'Amoxicillin Trihydrate', cat: 'Antibiotic', pkg: '10 Capsules/Strip' },
  { name: 'Metformin 500mg ER', comp: 'Metformin Hydrochloride', cat: 'Anti-Diabetic', pkg: '15 Tablets/Strip' },
  { name: 'Atorvastatin 10mg', comp: 'Atorvastatin Calcium', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Omeprazole 20mg', comp: 'Omeprazole Magnesium', cat: 'Gastrointestinal', pkg: '14 Capsules/Strip' },
  { name: 'Azithromycin 500mg', comp: 'Azithromycin Dihydrate', cat: 'Antibiotic', pkg: '3 Tablets/Strip' },
  { name: 'Cetirizine 10mg', comp: 'Cetirizine Dihydrochloride', cat: 'Anti-Allergic', pkg: '10 Tablets/Strip' },
  { name: 'Pantoprazole 40mg', comp: 'Pantoprazole Sodium', cat: 'Gastrointestinal', pkg: '15 Tablets/Strip' },
  { name: 'Amlodipine 5mg', comp: 'Amlodipine Besylate', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Montelukast 10mg', comp: 'Montelukast Sodium', cat: 'Respiratory', pkg: '10 Tablets/Strip' },
  { name: 'Losartan 50mg', comp: 'Losartan Potassium', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Gabapentin 300mg', comp: 'Gabapentin USP', cat: 'Neurology', pkg: '10 Capsules/Strip' },
  { name: 'Metoprolol Succinate 25mg', comp: 'Metoprolol Succinate ER', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Levothyroxine 50mcg', comp: 'Levothyroxine Sodium', cat: 'Thyroid', pkg: '100 Tablets/Bottle' },
  { name: 'Prednisolone 5mg', comp: 'Prednisolone IP', cat: 'Steroid', pkg: '10 Tablets/Strip' },
  { name: 'Vitamin D3 60K', comp: 'Cholecalciferol', cat: 'Vitamins', pkg: '4 Softgels/Strip' },
  { name: 'Vitamin C 500mg', comp: 'Ascorbic Acid', cat: 'Vitamins', pkg: '15 Chewables/Strip' },
  { name: 'Zinc 50mg', comp: 'Zinc Gluconate', cat: 'Minerals', pkg: '30 Tablets/Bottle' },
  { name: 'Clopidogrel 75mg', comp: 'Clopidogrel Bisulfate', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Telmisartan 40mg', comp: 'Telmisartan IP', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Rosuvastatin 10mg', comp: 'Rosuvastatin Calcium', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Glimepiride 2mg', comp: 'Glimepiride USP', cat: 'Anti-Diabetic', pkg: '15 Tablets/Strip' },
  { name: 'Voglibose 0.3mg', comp: 'Voglibose IP', cat: 'Anti-Diabetic', pkg: '10 Tablets/Strip' },
  { name: 'Sitagliptin 100mg', comp: 'Sitagliptin Phosphate', cat: 'Anti-Diabetic', pkg: '10 Tablets/Strip' },
  { name: 'Spironolactone 25mg', comp: 'Spironolactone IP', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Furosemide 40mg', comp: 'Furosemide IP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Digoxin 0.25mg', comp: 'Digoxin USP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Warfarin 5mg', comp: 'Warfarin Sodium', cat: 'Anticoagulant', pkg: '30 Tablets/Bottle' },
  { name: 'Phenytoin 100mg', comp: 'Phenytoin Sodium ER', cat: 'Neurology', pkg: '10 Capsules/Strip' },
  { name: 'Carbamazepine 200mg', comp: 'Carbamazepine CR', cat: 'Neurology', pkg: '10 Tablets/Strip' },
  { name: 'Valproate Sodium 500mg', comp: 'Sodium Valproate / Valproic Acid', cat: 'Neurology', pkg: '10 Tablets/Strip' },
  { name: 'Levetiracetam 500mg', comp: 'Levetiracetam IP', cat: 'Neurology', pkg: '10 Tablets/Strip' },
  { name: 'Diazepam 5mg', comp: 'Diazepam IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Lorazepam 2mg', comp: 'Lorazepam USP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Alprazolam 0.5mg', comp: 'Alprazolam IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Clonazepam 1mg', comp: 'Clonazepam IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Zolpidem 10mg', comp: 'Zolpidem Tartrate', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Amitriptyline 25mg', comp: 'Amitriptyline Hydrochloride', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Sertraline 50mg', comp: 'Sertraline Hydrochloride', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Fluoxetine 20mg', comp: 'Fluoxetine Hydrochloride', cat: 'Psychiatry', pkg: '14 Capsules/Strip' },
  { name: 'Escitalopram 10mg', comp: 'Escitalopram Oxalate', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Duloxetine 30mg', comp: 'Duloxetine Hydrochloride', cat: 'Psychiatry', pkg: '10 Capsules/Strip' },
  { name: 'Venlafaxine 75mg XR', comp: 'Venlafaxine Hydrochloride ER', cat: 'Psychiatry', pkg: '10 Capsules/Strip' },
  { name: 'Bupropion 150mg XL', comp: 'Bupropion Hydrochloride ER', cat: 'Psychiatry', pkg: '30 Tablets/Bottle' },
  { name: 'Quetiapine 100mg', comp: 'Quetiapine Fumarate', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Olanzapine 5mg', comp: 'Olanzapine IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Risperidone 2mg', comp: 'Risperidone USP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Aripiprazole 15mg', comp: 'Aripiprazole IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Haloperidol 5mg', comp: 'Haloperidol IP', cat: 'Psychiatry', pkg: '10 Tablets/Strip' },
  { name: 'Metoclopramide 10mg', comp: 'Metoclopramide Hydrochloride', cat: 'Gastrointestinal', pkg: '10 Tablets/Strip' },
  { name: 'Domperidone 10mg', comp: 'Domperidone Maleate', cat: 'Gastrointestinal', pkg: '10 Tablets/Strip' },
  { name: 'Ondansetron 4mg', comp: 'Ondansetron Hydrochloride', cat: 'Gastrointestinal', pkg: '10 Tablets/Strip' },
  { name: 'Ranitidine 150mg', comp: 'Ranitidine Hydrochloride', cat: 'Gastrointestinal', pkg: '15 Tablets/Strip' },
  { name: 'Famotidine 20mg', comp: 'Famotidine IP', cat: 'Gastrointestinal', pkg: '14 Tablets/Strip' },
  { name: 'Rabeprazole 20mg', comp: 'Rabeprazole Sodium', cat: 'Gastrointestinal', pkg: '10 Tablets/Strip' },
  { name: 'Esomeprazole 40mg', comp: 'Esomeprazole Magnesium', cat: 'Gastrointestinal', pkg: '15 Capsules/Strip' },
  { name: 'Sucralfate Suspension', comp: 'Sucralfate 1g/10ml', cat: 'Gastrointestinal', pkg: '200ml Bottle' },
  { name: 'Lactulose Liquid', comp: 'Lactulose USP 10g/15ml', cat: 'Gastrointestinal', pkg: '150ml Bottle' },
  { name: 'Loperamide 2mg', comp: 'Loperamide Hydrochloride', cat: 'Gastrointestinal', pkg: '10 Capsules/Strip' },
  { name: 'Bisacodyl 5mg', comp: 'Bisacodyl IP', cat: 'Gastrointestinal', pkg: '10 Tablets/Strip' },
  { name: 'Psyllium Husk Powder', comp: 'Ispaghula Husk', cat: 'Gastrointestinal', pkg: '100g Jar' },
  { name: 'Metronidazole 400mg', comp: 'Metronidazole IP', cat: 'Antibiotic', pkg: '15 Tablets/Strip' },
  { name: 'Tinidazole 500mg', comp: 'Tinidazole IP', cat: 'Antibiotic', pkg: '4 Tablets/Strip' },
  { name: 'Ciprofloxacin 500mg', comp: 'Ciprofloxacin Hydrochloride', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Offloxacin 200mg', comp: 'Ofloxacin IP', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Levofloxacin 500mg', comp: 'Levofloxacin Hemihydrate', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Moxifloxacin 400mg', comp: 'Moxifloxacin Hydrochloride', cat: 'Antibiotic', pkg: '5 Tablets/Strip' },
  { name: 'Doxycycline 100mg', comp: 'Doxycycline Hyclate', cat: 'Antibiotic', pkg: '10 Capsules/Strip' },
  { name: 'Minocycline 50mg', comp: 'Minocycline Hydrochloride', cat: 'Antibiotic', pkg: '10 Capsules/Strip' },
  { name: 'Tetracycline 250mg', comp: 'Tetracycline Hydrochloride', cat: 'Antibiotic', pkg: '10 Capsules/Strip' },
  { name: 'Erythromycin 500mg', comp: 'Erythromycin Stearate', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Clarithromycin 250mg', comp: 'Clarithromycin IP', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Roxithromycin 150mg', comp: 'Roxithromycin IP', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Cephalexin 500mg', comp: 'Cephalexin Monohydrate', cat: 'Antibiotic', pkg: '10 Capsules/Strip' },
  { name: 'Cefuroxime 500mg', comp: 'Cefuroxime Axetil', cat: 'Antibiotic', pkg: '6 Tablets/Strip' },
  { name: 'Cefpodoxime 200mg', comp: 'Cefpodoxime Proxetil', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Cefixime 200mg', comp: 'Cefixime Trihydrate', cat: 'Antibiotic', pkg: '10 Tablets/Strip' },
  { name: 'Amoxiclav 625mg', comp: 'Amoxicillin + Clavulanate Potassium', cat: 'Antibiotic', pkg: '6 Tablets/Strip' },
  { name: 'Dexamethasone 0.5mg', comp: 'Dexamethasone IP', cat: 'Steroid', pkg: '10 Tablets/Strip' },
  { name: 'Hydrocortisone 100mg Inj', comp: 'Hydrocortisone Sodium Succinate', cat: 'Steroid', pkg: 'Vial' },
  { name: 'Salbutamol Inhaler', comp: 'Salbutamol Sulfate', cat: 'Respiratory', pkg: '200 MDIs' },
  { name: 'Fluticasone Nasal Spray', comp: 'Fluticasone Propionate', cat: 'Respiratory', pkg: '120 Metred Sprays' },
  { name: 'Levocetirizine 5mg', comp: 'Levocetirizine Dihydrochloride', cat: 'Anti-Allergic', pkg: '10 Tablets/Strip' },
  { name: 'Fexofenadine 120mg', comp: 'Fexofenadine Hydrochloride', cat: 'Anti-Allergic', pkg: '10 Tablets/Strip' },
  { name: 'Promethazine 25mg', comp: 'Promethazine Hydrochloride', cat: 'Anti-Allergic', pkg: '10 Tablets/Strip' },
  { name: 'Aspirin 75mg Gastro-resistant', comp: 'Aspirin IP', cat: 'Cardiovascular', pkg: '14 Tablets/Strip' },
  { name: 'Enalapril 5mg', comp: 'Enalapril Maleate', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Ramipril 2.5mg', comp: 'Ramipril IP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Carvedilol 6.25mg', comp: 'Carvedilol IP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Nifedipine 20mg Retard', comp: 'Nifedipine Retard', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Hydrochlorothiazide 12.5mg', comp: 'Hydrochlorothiazide IP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Torsemide 10mg', comp: 'Torsemide IP', cat: 'Cardiovascular', pkg: '15 Tablets/Strip' },
  { name: 'Simvastatin 20mg', comp: 'Simvastatin USP', cat: 'Cardiovascular', pkg: '10 Tablets/Strip' },
  { name: 'Glipizide 5mg', comp: 'Glipizide IP', cat: 'Anti-Diabetic', pkg: '10 Tablets/Strip' },
  { name: 'Pioglitazone 15mg', comp: 'Pioglitazone Hydrochloride', cat: 'Anti-Diabetic', pkg: '15 Tablets/Strip' },
  { name: 'Acarbose 50mg', comp: 'Acarbose IP', cat: 'Anti-Diabetic', pkg: '10 Tablets/Strip' },
  { name: 'Vildagliptin 50mg', comp: 'Vildagliptin IP', cat: 'Anti-Diabetic', pkg: '15 Tablets/Strip' },
  { name: 'Empagliflozin 10mg', comp: 'Empagliflozin', cat: 'Anti-Diabetic', pkg: '10 Tablets/Strip' },
  { name: 'Dapagliflozin 10mg', comp: 'Dapagliflozin', cat: 'Anti-Diabetic', pkg: '14 Tablets/Strip' }
];

async function seed() {
  console.log(`Ensuring schema at: ${DB_PATH}`);
  await ensureSchema(DB_PATH);
  console.log(`Connecting to database...`);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  try {
    console.log('Clearing existing mock data table contents to prevent duplicate test runs...');
    await db.exec(`
      DELETE FROM sale_items;
      DELETE FROM sales_invoices;
      DELETE FROM purchase_items;
      DELETE FROM purchases;
      DELETE FROM return_items;
      DELETE FROM expiry_returns_tracking;
      DELETE FROM returns;
      DELETE FROM inventory_master;
      DELETE FROM medicines;
      DELETE FROM doctors;
      DELETE FROM customers;
      DELETE FROM distributors;
    `);

    console.log('Inserting Doctors...');
    const doctorIds: number[] = [];
    for (const doc of DOCTORS) {
      const res = await db.run(
        `INSERT INTO doctors (name, degree, reg_no, hospital, phone, address, speciality) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [doc.name, doc.degree, doc.reg_no, doc.hospital, doc.phone, doc.address, doc.speciality]
      );
      doctorIds.push(res.lastID!);
    }

    console.log('Inserting Patients/Customers...');
    const customerIds: number[] = [];
    for (const cust of CUSTOMERS) {
      const res = await db.run(
        `INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)`,
        [cust.name, cust.phone, cust.address, cust.notes]
      );
      customerIds.push(res.lastID!);
    }

    console.log('Inserting Distributors...');
    const distributorIds: number[] = [];
    for (const dist of DISTRIBUTORS) {
      const res = await db.run(
        `INSERT INTO distributors (name, contact, address, gstin, city, email) VALUES (?, ?, ?, ?, ?, ?)`,
        [dist.name, dist.contact, dist.address, dist.gstin, dist.city, dist.email]
      );
      distributorIds.push(res.lastID!);
    }

    console.log('Inserting 100 Common Medicines & Core Inventory...');
    const medicineIds: number[] = [];
    const inventoryIds: number[] = [];
    
    // We will register all 100 medicines
    for (let i = 0; i < MEDICINE_TEMPLATES.length; i++) {
      const med = MEDICINE_TEMPLATES[i];
      const mrp = parseFloat((15 + Math.random() * 450).toFixed(2));
      const res = await db.run(
        `INSERT INTO medicines (name, api_reference, mrp, category, packaging) VALUES (?, ?, ?, ?, ?)`,
        [med.name, med.comp, mrp, med.cat, med.pkg]
      );
      const medId = res.lastID!;
      medicineIds.push(medId);

      // Create 1-2 batches per medicine
      const numBatches = Math.random() > 0.4 ? 2 : 1;
      for (let b = 0; b < numBatches; b++) {
        const batchNo = `BT-${10000 + Math.floor(Math.random() * 90000)}`;
        const rackLoc = `${['A','B','C','D','E'][Math.floor(Math.random() * 5)]}-${1 + Math.floor(Math.random() * 8)}`;
        
        // Expiry setup: expired, near-expiry, or future
        let expiryDateStr = '12/2028';
        const rnd = Math.random();
        if (rnd < 0.05) {
          // expired
          expiryDateStr = '10/2024';
        } else if (rnd < 0.15) {
          // near-expiry (soon to be 2026-06/07)
          expiryDateStr = '07/2026';
        } else {
          // far future
          expiryDateStr = `12/202${7 + Math.floor(Math.random() * 3)}`;
        }

        const qty = 30 + Math.floor(Math.random() * 470);
        const costPrice = parseFloat((mrp * 0.72).toFixed(2)); // ~28% margin

        const invRes = await db.run(
          `INSERT INTO inventory_master (medicine_id, quantity, rack_location, batch_no, expiry_date, unit_price, cost_price, mrp, reorder_level)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [medId, qty, rackLoc, batchNo, expiryDateStr, mrp, costPrice, mrp, 15]
        );
        inventoryIds.push(invRes.lastID!);
      }
    }

    console.log('Inserting Mock Purchase Bills...');
    // Seed 15 purchase bills from distributors
    for (let p = 1; p <= 15; p++) {
      const distId = distributorIds[Math.floor(Math.random() * distributorIds.length)];
      const invNo = `PUR-2026-${1000 + p}`;
      const date = new Date(Date.now() - (Math.random() * 60 * 24 * 60 * 60 * 1000)).toISOString(); // last 60 days
      
      const numItems = 3 + Math.floor(Math.random() * 8);
      let totalAmount = 0;

      const purRes = await db.run(
        `INSERT INTO purchases (distributor_id, invoice_no, date, total_amount, status) VALUES (?, ?, ?, ?, 'PUBLISHED')`,
        [distId, invNo, date, 0]
      );
      const purchaseId = purRes.lastID!;

      for (let i = 0; i < numItems; i++) {
        const medId = medicineIds[Math.floor(Math.random() * medicineIds.length)];
        // Get inventory details
        const invRow = await db.get(`SELECT batch_no, cost_price, mrp FROM inventory_master WHERE medicine_id = ?`, [medId]);
        const batch = invRow ? invRow.batch_no : `BT-PUR${p}`;
        const cost = invRow ? invRow.cost_price : 25.0;
        const mrp = invRow ? invRow.mrp : 35.0;
        const qty = 50 + Math.floor(Math.random() * 150);
        const itemTotal = qty * cost;
        totalAmount += itemTotal;

        await db.run(
          `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [purchaseId, medId, batch, '12/2029', qty, cost, mrp]
        );
      }

      await db.run(`UPDATE purchases SET total_amount = ? WHERE id = ?`, [totalAmount, purchaseId]);
    }

    console.log('Inserting 100 Sales Invoices spanning 30 days...');
    for (let s = 1; s <= 100; s++) {
      const invNo = `INV-2026-${10000 + s}`;
      const customerId = Math.random() > 0.3 ? customerIds[Math.floor(Math.random() * customerIds.length)] : null;
      const doctorId = Math.random() > 0.4 ? doctorIds[Math.floor(Math.random() * doctorIds.length)] : null;
      const date = new Date(Date.now() - (Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(); // last 30 days
      const paymentMedium = ['CASH', 'UPI', 'CARD', 'CREDIT'][Math.floor(Math.random() * 4)];

      const invRes = await db.run(
        `INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount, tax_amount, payment_medium)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [invNo, customerId, doctorId, date, 0, 0, paymentMedium]
      );
      const invoiceId = invRes.lastID!;

      const numItems = 1 + Math.floor(Math.random() * 5);
      let subtotal = 0;

      for (let i = 0; i < numItems; i++) {
        // Pick a random inventory item
        const randInvId = inventoryIds[Math.floor(Math.random() * inventoryIds.length)];
        const invRow = await db.get(
          `SELECT im.id, im.medicine_id, im.unit_price, im.batch_no, m.name 
           FROM inventory_master im
           JOIN medicines m ON im.medicine_id = m.id
           WHERE im.id = ?`,
          [randInvId]
        );

        if (invRow) {
          const qty = 1 + Math.floor(Math.random() * 5);
          const rate = invRow.unit_price;
          const discount = Math.random() > 0.7 ? 10 : 0; // 10% discount sometimes
          const itemTotal = qty * rate * (1 - discount / 100);
          subtotal += itemTotal;

          await db.run(
            `INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, mrp, batch_no, discount_per)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [invoiceId, invRow.id, qty, rate, rate, invRow.batch_no, discount]
          );
        }
      }

      const tax = parseFloat((subtotal * 0.05).toFixed(2));
      const grandTotal = subtotal + tax;

      await db.run(
        `UPDATE sales_invoices SET total_amount = ?, tax_amount = ? WHERE id = ?`,
        [grandTotal, tax, invoiceId]
      );
    }

    console.log('Inserting Returns & Expiry Return Tracking entries...');
    // Create 5 return bills
    for (let r = 1; r <= 5; r++) {
      const returnNo = `RET-2026-${1000 + r}`;
      const type = r % 2 === 0 ? 'sale' : 'purchase';
      const distId = distributorIds[Math.floor(Math.random() * distributorIds.length)];
      const date = new Date(Date.now() - (Math.random() * 15 * 24 * 60 * 60 * 1000)).toISOString();
      const amount = 150.0 + Math.random() * 850.0;

      const retRes = await db.run(
        `INSERT INTO returns (return_no, type, date, total_amount, distributor_id) VALUES (?, ?, ?, ?, ?)`,
        [returnNo, type, date, amount, type === 'purchase' ? distId : null]
      );
      const returnId = retRes.lastID!;

      // Add a couple of random item returns
      const medId1 = medicineIds[Math.floor(Math.random() * medicineIds.length)];
      const medId2 = medicineIds[Math.floor(Math.random() * medicineIds.length)];
      
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price)
         VALUES (?, ?, 'B-RET', 5, 20.0, 30.0, 150.0)`,
        [returnId, medId1]
      );

      if (type === 'purchase') {
        // insert expiry tracking entry
        await db.run(
          `INSERT INTO expiry_returns_tracking (return_id, distributor_id, original_amount, expected_credit_amount, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [returnId, distId, amount, amount * 0.97]
        );
      }
    }

    console.log('Database Seeding Completed Successfully!');
  } catch (error) {
    console.error('Seeding failed with error:', error);
  } finally {
    await db.close();
  }
}

seed();
