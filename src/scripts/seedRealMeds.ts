import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

const companiesData = [
  {
    manufacturer: 'Cipla',
    brands: [
      { base: 'Okacet', api: 'Cetirizine', types: ['Tablet', 'Syrup'], strengths: ['10mg', '5ml'] },
      { base: 'Montair LC', api: 'Montelukast + Levocetirizine', types: ['Tablet', 'Syrup', 'Kid Tab'], strengths: ['10mg+5mg', '4mg+2.5mg'] },
      { base: 'Azee', api: 'Azithromycin', types: ['Tablet', 'Syrup'], strengths: ['250mg', '500mg', '100mg/5ml', '200mg/5ml'] },
      { base: 'Ciplox', api: 'Ciprofloxacin', types: ['Tablet', 'Eye Drops', 'Ointment'], strengths: ['250mg', '500mg', '0.3%'] },
      { base: 'Ciplox TZ', api: 'Ciprofloxacin + Tinidazole', types: ['Tablet'], strengths: ['500mg+600mg'] },
      { base: 'Seroflo', api: 'Salmeterol + Fluticasone', types: ['Inhaler', 'Rotacap'], strengths: ['125', '250', '500'] },
      { base: 'Asthalin', api: 'Salbutamol', types: ['Inhaler', 'Syrup', 'Tablet'], strengths: ['100mcg', '2mg', '4mg'] },
      { base: 'Budecort', api: 'Budesonide', types: ['Inhaler', 'Respules'], strengths: ['100mcg', '200mcg', '0.5mg', '1mg'] },
      { base: 'Ipravent', api: 'Ipratropium', types: ['Inhaler', 'Respules'], strengths: ['20mcg', '250mcg'] },
      { base: 'Duolin', api: 'Levosalbutamol + Ipratropium', types: ['Inhaler', 'Respules'], strengths: ['50mcg+20mcg'] },
      { base: 'Omnacortil', api: 'Prednisolone', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['5mg', '10mg', '20mg', '30mg', '40mg'] },
      { base: 'Cresar', api: 'Telmisartan', types: ['Tablet'], strengths: ['20mg', '40mg', '80mg'] },
      { base: 'Cresar H', api: 'Telmisartan + HCTZ', types: ['Tablet'], strengths: ['40mg+12.5mg', '80mg+12.5mg'] },
      { base: 'Urimax', api: 'Tamsulosin', types: ['Capsule'], strengths: ['0.4mg'] },
      { base: 'Urimax D', api: 'Tamsulosin + Dutasteride', types: ['Capsule'], strengths: ['0.4mg+0.5mg'] },
      { base: 'Nicip', api: 'Nimesulide', types: ['Tablet'], strengths: ['100mg'] },
      { base: 'Cipzen', api: 'Serratiopeptidase', types: ['Tablet'], strengths: ['10mg', 'D'] },
      { base: 'Sorbitrate', api: 'Isosorbide Dinitrate', types: ['Tablet'], strengths: ['5mg', '10mg'] }
    ]
  },
  {
    manufacturer: 'Sun Pharma',
    brands: [
      { base: 'Volini', api: 'Diclofenac', types: ['Gel', 'Spray'], strengths: ['30gm', '50gm', '100gm', '50ml'] },
      { base: 'Revital H', api: 'Multivitamin', types: ['Capsule'], strengths: ['10s', '30s'] },
      { base: 'Pantosec', api: 'Pantoprazole', types: ['Tablet', 'Injection'], strengths: ['40mg', 'D SR', 'Injection'] },
      { base: 'Strocit', api: 'Citicoline', types: ['Tablet', 'Injection', 'Syrup'], strengths: ['500mg', 'Plus'] },
      { base: 'Glimy', api: 'Glimepiride', types: ['Tablet'], strengths: ['1mg', '2mg', '3mg', '4mg'] },
      { base: 'Glimy M', api: 'Glimepiride + Metformin', types: ['Tablet'], strengths: ['1mg', '2mg', 'Forte'] },
      { base: 'Repace', api: 'Losartan', types: ['Tablet'], strengths: ['25mg', '50mg', 'H'] },
      { base: 'Trika', api: 'Alprazolam', types: ['Tablet'], strengths: ['0.25mg', '0.5mg', '1mg'] },
      { base: 'Sustain', api: 'Progesterone', types: ['Capsule', 'Injection'], strengths: ['100mg', '200mg', '300mg', '400mg SR'] },
      { base: 'Olmesar', api: 'Olmesartan', types: ['Tablet'], strengths: ['20mg', '40mg', 'A', 'H'] },
      { base: 'Valparin', api: 'Sodium Valproate', types: ['Tablet', 'Syrup'], strengths: ['200mg', 'Chrono 300', 'Chrono 500'] },
      { base: 'Risdone', api: 'Risperidone', types: ['Tablet', 'Syrup'], strengths: ['1mg', '2mg', '3mg', '4mg'] },
      { base: 'Ropark', api: 'Ropinirole', types: ['Tablet'], strengths: ['0.25mg', '0.5mg', '1mg', '2mg'] },
      { base: 'Oxetol', api: 'Oxcarbazepine', types: ['Tablet', 'Syrup'], strengths: ['150mg', '300mg', '600mg'] },
      { base: 'Clopilet', api: 'Clopidogrel', types: ['Tablet'], strengths: ['75mg', '150mg', 'A 75'] }
    ]
  },
  {
    manufacturer: 'Dr. Reddys',
    brands: [
      { base: 'Omez', api: 'Omeprazole', types: ['Capsule'], strengths: ['10mg', '20mg', '40mg'] },
      { base: 'Omez D', api: 'Omeprazole + Domperidone', types: ['Capsule'], strengths: ['20mg+10mg'] },
      { base: 'Omez DSR', api: 'Omeprazole + Domperidone SR', types: ['Capsule'], strengths: ['20mg+30mg'] },
      { base: 'Stamlo', api: 'Amlodipine', types: ['Tablet'], strengths: ['2.5mg', '5mg', '10mg', 'Beta', 'T'] },
      { base: 'Atarax', api: 'Hydroxyzine', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['10mg', '25mg', '6mg/ml'] },
      { base: 'Nise', api: 'Nimesulide', types: ['Tablet', 'Gel'], strengths: ['100mg', '30gm'] },
      { base: 'Razo', api: 'Rabeprazole', types: ['Tablet'], strengths: ['20mg', 'D', 'L'] },
      { base: 'Econorm', api: 'Saccharomyces boulardii', types: ['Sachet', 'Capsule'], strengths: ['250mg'] },
      { base: 'Aldactone', api: 'Spironolactone', types: ['Tablet'], strengths: ['25mg', '50mg'] },
      { base: 'Cresp', api: 'Darbepoetin alfa', types: ['Injection'], strengths: ['25mcg', '40mcg'] },
      { base: 'Ciprofar', api: 'Ciprofloxacin', types: ['Tablet'], strengths: ['250mg', '500mg'] },
      { base: 'Ketorol', api: 'Ketorolac', types: ['Tablet', 'Injection', 'Gel'], strengths: ['10mg', 'DT'] }
    ]
  },
  {
    manufacturer: 'Abbott',
    brands: [
      { base: 'Thyronorm', api: 'Thyroxine', types: ['Tablet'], strengths: ['12.5mcg', '25mcg', '50mcg', '75mcg', '100mcg', '125mcg', '150mcg'] },
      { base: 'Duphaston', api: 'Dydrogesterone', types: ['Tablet'], strengths: ['10mg'] },
      { base: 'Brufen', api: 'Ibuprofen', types: ['Tablet', 'Syrup'], strengths: ['200mg', '400mg', '600mg'] },
      { base: 'Creon', api: 'Pancreatin', types: ['Capsule'], strengths: ['10000', '25000', '40000'] },
      { base: 'Limcee', api: 'Vitamin C', types: ['Tablet'], strengths: ['500mg'] },
      { base: 'Duvadilan', api: 'Isoxsuprine', types: ['Tablet', 'Injection', 'Retard'], strengths: ['10mg', '40mg'] },
      { base: 'Pevesca', api: 'Pregabalin', types: ['Capsule'], strengths: ['75mg', '150mg', 'Plus', 'SR'] },
      { base: 'Heptral', api: 'Ademetionine', types: ['Tablet', 'Injection'], strengths: ['400mg'] },
      { base: 'Udiliv', api: 'Ursodeoxycholic Acid', types: ['Tablet'], strengths: ['150mg', '300mg', '450mg', '600mg'] },
      { base: 'Vertin', api: 'Betahistine', types: ['Tablet'], strengths: ['8mg', '16mg', '24mg'] },
      { base: 'Zolfresh', api: 'Zolpidem', types: ['Tablet'], strengths: ['5mg', '10mg'] },
      { base: 'Prothiaden', api: 'Dosulepin', types: ['Tablet'], strengths: ['25mg', '50mg', '75mg'] }
    ]
  },
  {
    manufacturer: 'Lupin',
    brands: [
      { base: 'Liofen', api: 'Baclofen', types: ['Tablet'], strengths: ['10mg', '25mg', 'XL'] },
      { base: 'Softovac', api: 'Isabgol + Senna', types: ['Powder'], strengths: ['100gm', '250gm', 'SF'] },
      { base: 'Tricort', api: 'Triamcinolone', types: ['Tablet', 'Injection'], strengths: ['4mg', '40mg/ml'] },
      { base: 'Lupigest', api: 'Progesterone', types: ['Capsule', 'Injection'], strengths: ['100mg', '200mg', '300mg', '400mg SR'] },
      { base: 'Ondanset', api: 'Ondansetron', types: ['Tablet', 'Syrup', 'Injection'], strengths: ['4mg', '8mg'] },
      { base: 'Tonact', api: 'Atorvastatin', types: ['Tablet'], strengths: ['10mg', '20mg', '40mg', '80mg', 'TG', 'Plus'] },
      { base: 'Akurit', api: 'Rifampicin + Isoniazid', types: ['Tablet'], strengths: ['2', '3', '4'] },
      { base: 'Rablet', api: 'Rabeprazole', types: ['Tablet'], strengths: ['10mg', '20mg', 'D', 'L'] },
      { base: 'Starpress', api: 'Metoprolol', types: ['Tablet'], strengths: ['25mg XL', '50mg XL', 'AM'] }
    ]
  },
  {
    manufacturer: 'Alkem',
    brands: [
      { base: 'Pan', api: 'Pantoprazole', types: ['Tablet', 'Injection'], strengths: ['20mg', '40mg'] },
      { base: 'Pan D', api: 'Pantoprazole + Domperidone', types: ['Capsule'], strengths: ['40mg+30mg'] },
      { base: 'Taxim', api: 'Cefotaxime', types: ['Injection'], strengths: ['250mg', '500mg', '1gm'] },
      { base: 'Taxim O', api: 'Cefixime', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['100mg', '200mg', 'Forte', 'CV'] },
      { base: 'Clavam', api: 'Amoxicillin + Clavulanic Acid', types: ['Tablet', 'Syrup', 'Injection'], strengths: ['375mg', '625mg', 'Bid', 'Forte'] },
      { base: 'A to Z', api: 'Multivitamin', types: ['Capsule', 'Syrup', 'Drops'], strengths: ['Gold', 'NS', 'Woman'] },
      { base: 'Wikoryl', api: 'Paracetamol + CPM + Phenylephrine', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['AF', 'DS'] },
      { base: 'Ceftas', api: 'Cefixime', types: ['Tablet', 'Syrup'], strengths: ['100mg', '200mg', 'CV'] },
      { base: 'Alzolam', api: 'Alprazolam', types: ['Tablet'], strengths: ['0.25mg', '0.5mg', '1mg'] },
      { base: 'Levera', api: 'Levetiracetam', types: ['Tablet', 'Syrup', 'Injection'], strengths: ['250mg', '500mg', '750mg', '1000mg', 'XR'] },
      { base: 'Uprise D3', api: 'Vitamin D3', types: ['Capsule', 'Sachet', 'Syrup'], strengths: ['2K', '60K'] }
    ]
  },
  {
    manufacturer: 'GSK',
    brands: [
      { base: 'Augmentin', api: 'Amoxicillin + Clavulanic Acid', types: ['Tablet', 'Syrup', 'Injection'], strengths: ['375mg', '625 Duo', '1000 Duo', 'DDS'] },
      { base: 'Calpol', api: 'Paracetamol', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['500mg', '650mg', 'T', '250 Suspension'] },
      { base: 'Zantac', api: 'Ranitidine', types: ['Tablet', 'Injection'], strengths: ['150mg', '300mg'] },
      { base: 'Zinat', api: 'Cefuroxime', types: ['Tablet', 'Syrup'], strengths: ['250mg', '500mg'] },
      { base: 'Betnovate', api: 'Betamethasone', types: ['Cream', 'Ointment'], strengths: ['C', 'N', 'GM'] },
      { base: 'Dermovate', api: 'Clobetasol', types: ['Cream', 'Ointment'], strengths: ['0.05%'] },
      { base: 'Ventolin', api: 'Salbutamol', types: ['Inhaler', 'Syrup', 'Respirator Solution'], strengths: ['100mcg'] },
      { base: 'Bactroban', api: 'Mupirocin', types: ['Ointment'], strengths: ['2%'] },
      { base: 'Flixonase', api: 'Fluticasone', types: ['Nasal Spray'], strengths: ['50mcg'] },
      { base: 'T-Bact', api: 'Mupirocin', types: ['Ointment'], strengths: ['2%'] },
      { base: 'Eltroxin', api: 'Thyroxine', types: ['Tablet'], strengths: ['25mcg', '50mcg', '100mcg'] }
    ]
  },
  {
    manufacturer: 'Pfizer',
    brands: [
      { base: 'Becosules', api: 'B-Complex + Vitamin C', types: ['Capsule', 'Syrup'], strengths: ['Z', 'Performance'] },
      { base: 'Corex', api: 'Chlorpheniramine + Dextromethorphan', types: ['Syrup'], strengths: ['DX', 'LS'] },
      { base: 'Gelusil', api: 'Aluminium + Magnesium + Simethicone', types: ['Liquid', 'Tablet'], strengths: ['MPS'] },
      { base: 'Minipress', api: 'Prazosin', types: ['Tablet'], strengths: ['XL 2.5mg', 'XL 5mg'] },
      { base: 'Dolonex', api: 'Piroxicam', types: ['Tablet', 'Injection', 'Gel'], strengths: ['20mg', 'DT'] },
      { base: 'Zithromax', api: 'Azithromycin', types: ['Tablet', 'Syrup'], strengths: ['250mg', '500mg'] },
      { base: 'Norvasc', api: 'Amlodipine', types: ['Tablet'], strengths: ['5mg', '10mg'] },
      { base: 'Viagra', api: 'Sildenafil', types: ['Tablet'], strengths: ['50mg', '100mg'] },
      { base: 'Lyrica', api: 'Pregabalin', types: ['Capsule'], strengths: ['75mg', '150mg'] },
      { base: 'Dalacin C', api: 'Clindamycin', types: ['Capsule', 'Injection'], strengths: ['150mg', '300mg'] }
    ]
  },
  {
    manufacturer: 'Sanofi',
    brands: [
      { base: 'Allegra', api: 'Fexofenadine', types: ['Tablet', 'Suspension'], strengths: ['120mg', '180mg', 'M'] },
      { base: 'Soframycin', api: 'Framycetin', types: ['Cream'], strengths: ['1%'] },
      { base: 'Clexane', api: 'Enoxaparin', types: ['Injection PFS'], strengths: ['20mg', '40mg', '60mg'] },
      { base: 'Lantus', api: 'Insulin Glargine', types: ['Pen', 'Vial'], strengths: ['100 IU/ml'] },
      { base: 'Amaryl', api: 'Glimepiride', types: ['Tablet'], strengths: ['1mg', '2mg', '3mg', 'M 1', 'M 2', 'MV 2'] },
      { base: 'Plavix', api: 'Clopidogrel', types: ['Tablet'], strengths: ['75mg'] },
      { base: 'Targocid', api: 'Teicoplanin', types: ['Injection'], strengths: ['200mg', '400mg'] },
      { base: 'Cardace', api: 'Ramipril', types: ['Tablet'], strengths: ['1.25mg', '2.5mg', '5mg', '10mg', 'H', 'AM'] },
      { base: 'Enterogermina', api: 'Bacillus Clausii', types: ['Vial', 'Capsule'], strengths: ['2 Billion'] },
      { base: 'Frisium', api: 'Clobazam', types: ['Tablet'], strengths: ['5mg', '10mg', '20mg'] }
    ]
  },
  {
    manufacturer: 'Torrent',
    brands: [
      { base: 'Shelcal', api: 'Calcium + Vitamin D3', types: ['Tablet', 'Syrup'], strengths: ['500', '250', 'HD', 'XT', 'M'] },
      { base: 'Losar', api: 'Losartan', types: ['Tablet'], strengths: ['25mg', '50mg', 'H', 'A'] },
      { base: 'Nikoran', api: 'Nicorandil', types: ['Tablet', 'Injection'], strengths: ['5mg', '10mg', 'OD'] },
      { base: 'Amlopres', api: 'Amlodipine', types: ['Tablet'], strengths: ['2.5mg', '5mg', 'AT', 'L', 'TL'] },
      { base: 'Chymoral', api: 'Trypsin Chymotrypsin', types: ['Tablet'], strengths: ['Forte', 'Plus'] },
      { base: 'Dytor', api: 'Torsemide', types: ['Tablet', 'Injection'], strengths: ['5mg', '10mg', '20mg', 'Plus'] },
      { base: 'Unienzyme', api: 'Fungal Diastase + Papain', types: ['Tablet', 'Liquid'], strengths: ['Pro'] },
      { base: 'Veloz', api: 'Rabeprazole', types: ['Tablet'], strengths: ['20mg', 'D', 'L'] },
      { base: 'Nexpro', api: 'Esomeprazole', types: ['Tablet', 'Injection'], strengths: ['20mg', '40mg', 'RD', 'L'] },
      { base: 'Azulix', api: 'Glimepiride', types: ['Tablet'], strengths: ['1mg', '2mg', 'MF', 'MV'] }
    ]
  },
  {
    manufacturer: 'Glenmark',
    brands: [
      { base: 'Telma', api: 'Telmisartan', types: ['Tablet'], strengths: ['20mg', '40mg', '80mg', 'H', 'AM', 'LN'] },
      { base: 'Ascoril', api: 'Bromhexine + Terbutaline', types: ['Syrup'], strengths: ['LS', 'D Plus', 'Flu'] },
      { base: 'Candid', api: 'Clotrimazole', types: ['Cream', 'Dusting Powder', 'Ear Drops'], strengths: ['1%', 'B', 'V'] },
      { base: 'Alex', api: 'Dextromethorphan + CPM', types: ['Syrup', 'Lozenges'], strengths: ['Cough', 'Junior'] },
      { base: 'Momate', api: 'Mometasone', types: ['Cream', 'Ointment', 'Lotion'], strengths: ['0.1%', 'F', 'S'] },
      { base: 'Elovera', api: 'Aloe Vera + Vitamin E', types: ['Cream', 'Lotion', 'Body Wash'], strengths: ['IMF'] },
      { base: 'Zaha', api: 'Azithromycin', types: ['Tablet', 'Eye Drops'], strengths: ['500mg'] },
      { base: 'Deriva', api: 'Adapalene', types: ['Gel'], strengths: ['CMS', 'B'] }
    ]
  },
  {
    manufacturer: 'Mankind',
    brands: [
      { base: 'Moxikind', api: 'Amoxicillin + Clavulanic Acid', types: ['Tablet', 'Syrup'], strengths: ['CV 625', 'CV 375', 'CV Forte'] },
      { base: 'Glimisave', api: 'Glimepiride', types: ['Tablet'], strengths: ['M1', 'M2', 'MV2'] },
      { base: 'Gudcef', api: 'Cefpodoxime', types: ['Tablet', 'Syrup'], strengths: ['200', '100', 'CV', 'Plus'] },
      { base: 'Nurokind', api: 'Mecobalamin', types: ['Tablet', 'Injection', 'Syrup'], strengths: ['OD', 'Plus', 'Gold', 'LC'] },
      { base: 'Telmikind', api: 'Telmisartan', types: ['Tablet'], strengths: ['40', 'H', 'AM'] },
      { base: 'Prega News', api: 'HCG Kit', types: ['Test Kit'], strengths: ['1 Kit'] },
      { base: 'Unwanted 72', api: 'Levonorgestrel', types: ['Tablet'], strengths: ['1.5mg'] },
      { base: 'Amlokind', api: 'Amlodipine', types: ['Tablet'], strengths: ['5mg', 'AT'] },
      { base: 'Zenflox', api: 'Ofloxacin', types: ['Tablet', 'Eye Drops', 'Infusion'], strengths: ['200', '400', 'OZ'] }
    ]
  },
  {
    manufacturer: 'Zydus Cadila',
    brands: [
      { base: 'Dexona', api: 'Dexamethasone', types: ['Tablet', 'Injection'], strengths: ['0.5mg'] },
      { base: 'Pantocid', api: 'Pantoprazole', types: ['Tablet', 'Injection'], strengths: ['40', 'DSR', 'IT'] },
      { base: 'Atocor', api: 'Atorvastatin', types: ['Tablet'], strengths: ['10', '20', '40'] },
      { base: 'Nucoxia', api: 'Etoricoxib', types: ['Tablet'], strengths: ['60', '90', '120', 'MR'] },
      { base: 'Deriphyllin', api: 'Etofylline + Theophylline', types: ['Tablet', 'Injection', 'Syrup'], strengths: ['Retard 150', 'Retard 300'] },
      { base: 'Ocid', api: 'Omeprazole', types: ['Capsule', 'Injection'], strengths: ['20'] },
      { base: 'Thrombophob', api: 'Heparin', types: ['Ointment'], strengths: ['Gel', 'Ointment'] },
      { base: 'Vivitra', api: 'Trastuzumab', types: ['Injection'], strengths: ['440mg'] },
      { base: 'Pencom', api: 'Benzathine Penicillin', types: ['Injection'], strengths: ['12 Lac'] }
    ]
  },
  {
    manufacturer: 'Macleods',
    brands: [
      { base: 'Macpod', api: 'Cefpodoxime', types: ['Tablet', 'Syrup'], strengths: ['200', '100', 'CV'] },
      { base: 'Macladin', api: 'Clarithromycin', types: ['Tablet', 'Syrup'], strengths: ['250', '500'] },
      { base: 'T-Minic', api: 'Phenylephrine + CPM', types: ['Syrup', 'Drops'], strengths: ['Oral Drops'] },
      { base: 'Sensur', api: 'Ayurvedic', types: ['Lotion', 'Ointment'], strengths: ['Roll-on'] },
      { base: 'Montemac', api: 'Montelukast', types: ['Tablet'], strengths: ['10', 'L'] },
      { base: 'Defza', api: 'Deflazacort', types: ['Tablet', 'Syrup'], strengths: ['6', '24', '30'] },
      { base: 'Tenlimac', api: 'Teneligliptin', types: ['Tablet'], strengths: ['20', 'M'] },
      { base: 'Vogli', api: 'Voglibose', types: ['Tablet'], strengths: ['0.2', '0.3', 'M'] }
    ]
  },
  {
    manufacturer: 'Aristo',
    brands: [
      { base: 'Monocef', api: 'Ceftriaxone', types: ['Injection'], strengths: ['1gm', '500mg', '250mg', 'O'] },
      { base: 'Monocef O', api: 'Cefpodoxime', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['200', '100', 'CV'] },
      { base: 'Rcinex', api: 'Rifampicin + Isoniazid', types: ['Tablet'], strengths: ['300', '600'] },
      { base: 'Feburic', api: 'Febuxostat', types: ['Tablet'], strengths: ['40', '80'] },
      { base: 'Aristozyme', api: 'Fungal Diastase + Pepsin', types: ['Syrup', 'Capsule'], strengths: ['200ml'] },
      { base: 'Megalfa', api: 'Mecobalamin', types: ['Capsule', 'Injection'], strengths: ['Plus'] },
      { base: 'Cefadrox', api: 'Cefadroxil', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['500', '250'] },
      { base: 'Omnatax', api: 'Cefotaxime', types: ['Injection'], strengths: ['1gm', '500mg', '250mg'] }
    ]
  },
  {
    manufacturer: 'USV',
    brands: [
      { base: 'Ecosprin', api: 'Aspirin', types: ['Tablet'], strengths: ['75', '150', '325', 'AV', 'Gold'] },
      { base: 'Glycomet', api: 'Metformin', types: ['Tablet'], strengths: ['250', '500', '850', '1gm SR', 'GP 1', 'GP 2', 'Trio'] },
      { base: 'Tazloc', api: 'Telmisartan', types: ['Tablet'], strengths: ['40', 'H', 'AM'] },
      { base: 'Jalra', api: 'Vildagliptin', types: ['Tablet'], strengths: ['50', 'M'] },
      { base: 'Pioz', api: 'Pioglitazone', types: ['Tablet'], strengths: ['15', '30', 'MFG'] },
      { base: 'M.V.I.', api: 'Multivitamin', types: ['Injection'], strengths: ['10ml'] }
    ]
  },
  {
    manufacturer: 'Alembic',
    brands: [
      { base: 'Azithral', api: 'Azithromycin', types: ['Tablet', 'Syrup', 'Liquid', 'Injection'], strengths: ['500', '250', '200 Liquid'] },
      { base: 'Althrocin', api: 'Erythromycin', types: ['Tablet', 'Liquid'], strengths: ['250', '500'] },
      { base: 'Wikoryl', api: 'Paracetamol + CPM + Phenylephrine', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['AF', 'DS'] },
      { base: 'Zeet', api: 'Dextromethorphan + CPM', types: ['Syrup', 'Lozenges'], strengths: ['Expectorant', 'Cough'] },
      { base: 'Udiliv', api: 'Ursodeoxycholic Acid', types: ['Tablet'], strengths: ['150', '300'] }
    ]
  },
  {
    manufacturer: 'FDC',
    brands: [
      { base: 'Electral', api: 'ORS', types: ['Powder', 'Liquid'], strengths: ['21.8gm', '4.4gm', 'Tetrapack'] },
      { base: 'Zifi', api: 'Cefixime', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['200', '100', 'CV', 'O'] },
      { base: 'Zefu', api: 'Cefuroxime', types: ['Tablet', 'Syrup'], strengths: ['500', '250'] },
      { base: 'Enerzal', api: 'Energy Drink', types: ['Powder', 'Liquid'], strengths: ['Orange', 'Apple'] },
      { base: 'Pyrimon', api: 'Chloramphenicol + Dexamethasone', types: ['Eye Drops'], strengths: ['5ml'] }
    ]
  },
  {
    manufacturer: 'Intas',
    brands: [
      { base: 'Zoryl', api: 'Glimepiride', types: ['Tablet'], strengths: ['M1', 'M2', 'MV2'] },
      { base: 'Lofam', api: 'Lorazepam', types: ['Tablet'], strengths: ['1mg', '2mg'] },
      { base: 'Concor', api: 'Bisoprolol', types: ['Tablet'], strengths: ['2.5', '5', 'AM'] },
      { base: 'Bilypsa', api: 'Saroglitazar', types: ['Tablet'], strengths: ['4mg'] },
      { base: 'Hifenac', api: 'Aceclofenac', types: ['Tablet', 'Gel'], strengths: ['P', 'MR', 'D'] }
    ]
  },
  {
    manufacturer: 'Micro Labs',
    brands: [
      { base: 'Dolo', api: 'Paracetamol', types: ['Tablet', 'Syrup', 'Drops'], strengths: ['650', '500', 'Cold', '120 Suspension'] },
      { base: 'Amlong', api: 'Amlodipine', types: ['Tablet'], strengths: ['2.5', '5', '10', 'A', 'MT'] },
      { base: 'Tenepride', api: 'Teneligliptin', types: ['Tablet'], strengths: ['20', 'M'] },
      { base: 'Tripride', api: 'Glimepiride+Metformin+Pioglitazone', types: ['Tablet'], strengths: ['1', '2'] },
      { base: 'Eldoper', api: 'Loperamide', types: ['Tablet'], strengths: ['2mg'] },
      { base: 'Lubrex', api: 'Carboxymethylcellulose', types: ['Eye Drops'], strengths: ['0.5%'] }
    ]
  },
  {
    manufacturer: 'Wockhardt',
    brands: [
      { base: 'Wosulin', api: 'Human Insulin', types: ['Vial', 'Pen'], strengths: ['30/70', 'R', 'N'] },
      { base: 'Wokadine', api: 'Povidone Iodine', types: ['Ointment', 'Gargle', 'Scrub'], strengths: ['10%', '5%', '2% Gargle'] },
      { base: 'Sparx', api: 'Sparfloxacin', types: ['Tablet'], strengths: ['200'] },
      { base: 'Nadibact', api: 'Nadifloxacin', types: ['Cream'], strengths: ['1%'] },
      { base: 'Pelox', api: 'Pefloxacin', types: ['Tablet', 'Injection'], strengths: ['400'] }
    ]
  },
  {
    manufacturer: 'Biocon',
    brands: [
      { base: 'Insugen', api: 'Human Insulin', types: ['Vial', 'Pen'], strengths: ['30/70', 'R', 'N'] },
      { base: 'Basalog', api: 'Insulin Glargine', types: ['Vial', 'Pen'], strengths: ['100 IU/ml'] },
      { base: 'Krabeva', api: 'Bevacizumab', types: ['Injection'], strengths: ['100', '400'] },
      { base: 'Canmab', api: 'Trastuzumab', types: ['Injection'], strengths: ['440'] }
    ]
  }
];

async function seedRealMeds() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  console.log('Replacing synthetic medicines with real Indian brand names...');
  
  await db.exec('BEGIN TRANSACTION');

  // Delete all synthetic entries (keep first 43)
  console.log('Deleting synthetic medicines (id > 43)...');
  await db.exec('DELETE FROM medicines WHERE id > 43');
  
  const stmt = await db.prepare(`
    INSERT INTO medicines 
    (name, api_reference, strength, packaging, item_type, manufacturer, marketed_by, manufactured_by, schedule_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let inserted = 0;
  
  for (const company of companiesData) {
    for (const brand of company.brands) {
      for (const type of brand.types) {
        for (const strength of brand.strengths) {
          
          let fullName = brand.base;
          if (strength && strength !== '1 Kit' && !strength.includes('gm') && !strength.includes('ml')) {
            // Append strength to name for distinct variants, e.g. "Pan 40"
            const numPart = strength.match(/^[0-9.]+/);
            if (numPart) {
              if(!fullName.includes(numPart[0])) {
                 fullName += ' ' + numPart[0];
              }
            } else {
              fullName += ' ' + strength;
            }
          }

          let pkg = '10x10 Strips';
          if (type === 'Syrup' || type === 'Liquid' || type === 'Suspension') pkg = '100ml Bottle';
          if (type === 'Injection') pkg = '1 Vial/Ampoule';
          if (type === 'Cream' || type === 'Ointment' || type === 'Gel') pkg = '1 Tube';
          if (type === 'Drops' || type === 'Eye Drops' || type === 'Ear Drops') pkg = '5ml Bottle';
          if (type === 'Inhaler' || type === 'Spray') pkg = '1 Inhaler';
          if (type === 'Powder' || type === 'Sachet') pkg = '1 Sachet';
          if (type === 'Pen' || type === 'Kit') pkg = '1 Kit/Pen';
          
          let schedule = 'None';
          if (['Azithromycin', 'Amoxicillin', 'Cefixime', 'Cefpodoxime', 'Ceftriaxone'].some(s => brand.api.includes(s))) schedule = 'H1';
          else if (['Alprazolam', 'Zolpidem', 'Lorazepam', 'Clobazam'].some(s => brand.api.includes(s))) schedule = 'X';
          else if (['Telmisartan', 'Amlodipine', 'Glimepiride', 'Metformin', 'Pregabalin', 'Thyroxine'].some(s => brand.api.includes(s))) schedule = 'H';
          
          try {
            await stmt.run([
              fullName,
              brand.api,
              strength,
              pkg,
              type,
              company.manufacturer,
              company.manufacturer,
              company.manufacturer,
              schedule
            ]);
            inserted++;
          } catch(e:any) {
             if(!e.message.includes('UNIQUE')) console.error(e.message);
          }
        }
      }
    }
  }

  await stmt.finalize();
  await db.exec('COMMIT');
  
  const count = await db.get('SELECT COUNT(*) as c FROM medicines');
  console.log(`✅ Success! Seeded ${inserted} real branded medicine variants.`);
  console.log(`✅ Total medicines in database: ${(count as any).c}`);
  
  await db.close();
}

seedRealMeds().catch(console.error);
