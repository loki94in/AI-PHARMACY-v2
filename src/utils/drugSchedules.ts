/**
 * Drug schedule reference data & matchers — SINGLE SOURCE OF TRUTH.
 *
 * Real retail drug schedules of India's Drugs and Cosmetics Rules, 1945:
 *   Schedule H1 — 46 drugs, Gazette Notification GSR 588(E) dated 30-08-2013.
 *   Schedule X  — 16 habit-forming substances appended to the Rules.
 *   Schedule H  — ~536 drugs, consolidated list under the Drugs and Cosmetics
 *                 (2nd Amendment) Rules 2006, plus common antibiotic molecules
 *                 covered by the schedule's explicit "Antibiotics" class entry.
 *
 * Consumers:
 *   - scripts/classifyDrugSchedules.ts   (offline backfill of medicines.schedule_type)
 *   - services/scheduleResearchService.ts (Google SERP screenshot → OCR → word match)
 */

// ── Schedule H1 — GSR 588(E) dated 30-08-2013 (46 drugs + salts/preparations) ──
export const SCHEDULE_H1: string[] = [
  'alprazolam', 'balofloxacin', 'buprenorphine', 'capreomycin', 'cefdinir',
  'cefditoren', 'cefepime', 'cefetamet', 'cefixime', 'cefoperazone',
  'cefotaxime', 'cefpirome', 'cefpodoxime', 'ceftazidime', 'ceftibuten',
  'ceftizoxime', 'ceftriaxone', 'chlordiazepoxide', 'clofazimine', 'codeine',
  'cycloserine', 'diazepam', 'diphenoxylate', 'doripenem', 'ertapenem',
  'ethambutol', 'ethionamide', 'faropenem', 'gemifloxacin', 'imipenem',
  'isoniazid', 'levofloxacin', 'meropenem', 'midazolam', 'moxifloxacin',
  'nitrazepam', 'pentazocine', 'prulifloxacin', 'pyrazinamide', 'rifabutin',
  'rifampicin', 'rifampin', 'aminosalicylate', 'sparfloxacin', 'thiacetazone',
  'tramadol', 'zolpidem',
];

// ── Schedule X — appendix to the Drugs and Cosmetics Rules, 1945 (16 substances) ──
export const SCHEDULE_X: string[] = [
  'amobarbital', 'amphetamine', 'barbital', 'cyclobarbital', 'dexamphetamine',
  'ethchlorvynol', 'glutethimide', 'ketamine', 'meprobamate',
  'methamphetamine', 'methylphenidate', 'methylphenobarbital', 'pentobarbital',
  'phencyclidine', 'phenmetrazine', 'secobarbital',
];

// ── Schedule H — consolidated list, Drugs and Cosmetics (2nd Amendment) Rules 2006 ──
// Concrete molecules from the official notification (salt qualifiers stripped,
// standard INN spelling synonyms kept where the notification lists variant forms).
export const SCHEDULE_H: string[] = [
  // A
  'abacavir', 'abciximab', 'acamprosate', 'acebutolol', 'aclarubicin',
  'albendazole', 'alclometasone', 'acyclovir', 'adenosine', 'alendronate',
  'allopurinol', 'chymotrypsin', 'alprostadil', 'amantadine', 'amifostine',
  'amikacin', 'amiloride', 'amineptine', 'aminoglutethimide', 'aminosalicylic',
  'amiodarone', 'amitriptyline', 'amlodipine', 'amoscanate', 'amoxapine',
  'amrinone', 'analgin', 'apraclonidine', 'aprotinin', 'arteether',
  'artemether', 'artesunate', 'articaine', 'atenolol', 'atracurium',
  'atorvastatin', 'auranofin', 'azathioprine', 'aztreonam',
  // B
  'bacampicillin', 'baclofen', 'balsalazide', 'bambuterol', 'barbituric',
  'basiliximab', 'benazepril', 'benidipine', 'benserazide', 'betahistine',
  'bethanidine', 'bezafibrate', 'bicalutamide', 'biclotymol', 'bifonazole',
  'bimatoprost', 'biperiden', 'bitoscanate', 'bleomycin', 'brimonidine',
  'bromhexine', 'bromocriptine', 'budesonide', 'bulaquine', 'bupivacaine',
  'bupropion', 'buspirone', 'butenafine', 'butorphanol',
  // C
  'cabergoline', 'dobesilate', 'candesartan', 'capecitabine', 'captopril',
  'carbidopa', 'carbocisteine', 'carboplatin', 'carboquone', 'carisoprodol',
  'carnitine', 'carteolol', 'carvedilol', 'cefadroxyl', 'cefazolin',
  'cefuroxime', 'celecoxib', 'centchroman', 'centbutindole', 'centpropazine',
  'cetirizine', 'chlormezanone', 'chlorpheniramine', 'chlorpromazine',
  'chlorzoxazone', 'ciclopirox', 'cimetidine', 'cinnarizine', 'ciprofloxacin',
  'cisplatin', 'citalopram', 'clarithromycin', 'clavulanic', 'clidinium',
  'clindamycin', 'clobazam', 'clobetasol', 'clobetasone', 'clofibrate',
  'clonazepam', 'clonidine', 'clopamide', 'clopidogrel', 'clostebol',
  'clotrimazole', 'clozapine', 'colchicine', 'cotrimoxazole', 'cyclandelate',
  'cyclosporin',
  // D
  'daclizumab', 'danazol', 'dapsone', 'desloratadine', 'desogestrel',
  'dexrazoxane', 'dextranomer', 'dextromethorphan', 'dextropropoxyphene',
  'diazoxide', 'diclofenac', 'dicyclomine', 'didanosine', 'digoxin',
  'dilazep', 'diltiazem', 'dinoprostone', 'dipivefrin', 'pamidronate',
  'disopyramide', 'docetaxel', 'domperidone', 'donepezil', 'dopamine',
  'dothiepin', 'dosulepin', 'doxapram', 'doxazosin', 'doxepin', 'doxorubicin',
  // E–G
  'ebastine', 'econazole', 'efavirenz', 'enalapril', 'epinephrine',
  'adrenaline', 'epirubicin', 'eptifibatide', 'ergotamine', 'esomeprazole',
  'estradiol', 'estramustine', 'etanercept', 'ethacridine', 'ethamsylate',
  'ethinylestradiol', 'ethinyloestradiol', 'etidronate', 'etodolac',
  'etomidate', 'etoposide', 'exemestane', 'famciclovir', 'famotidine',
  'fenbendazole', 'fenofibrate', 'fexofenadine', 'finasteride', 'flavoxate',
  'fluorouracil', 'fludarabine', 'flufenamic', 'flunarizine', 'fluoxetine',
  'flupenthixol', 'fluphenazine', 'flurazepam', 'flurbiprofen', 'flutamide',
  'fluticasone', 'fluvoxamine', 'formestane', 'fosinopril', 'fosphenytoin',
  'fotemustine', 'gabapentin', 'galanthamine', 'gallamine', 'ganciclovir',
  'ganirelix', 'gatifloxacin', 'gemcitabine', 'gemfibrozil', 'gemtuzumab',
  'gliclazide', 'glimepiride', 'glucagon', 'glycopyrrolate', 'glydiazinamide',
  'goserelin', 'granisetron', 'guanethidine', 'gugulipid',
  // H–I
  'haloperidol', 'heparin', 'hyaluronidase', 'hydroxyzine', 'ibuprofen',
  'idebenone', 'indapamide', 'imipramine', 'indinavir', 'indomethacin',
  'insulin', 'interferon', 'iobitridol', 'iohexol', 'iopamidol', 'iomeprol',
  'iopromide', 'irbesartan', 'irinotecan', 'isepamicin', 'isocarboxazid',
  'isoflurane', 'isosorbide', 'isotretinoin', 'isoxsuprine', 'itopride',
  // K–L
  'ketoconazole', 'ketoprofen', 'ketorolac', 'labetalol', 'lacidipine',
  'lamivudine', 'lamotrigine', 'latanoprost', 'leflunomide', 'lercanidipine',
  'letrozole', 'leuprolide', 'levamisole', 'levarterenol', 'levobunolol',
  'levocetirizine', 'levodopa', 'lidoflazine', 'linezolid', 'lithium',
  'lofepramine', 'loperamide', 'lorazepam', 'losartan', 'loteprednol',
  'lovastatin', 'loxapine',
  // M
  'mebendazole', 'mebeverine', 'medroxyprogesterone', 'mefenamic',
  'mefloquine', 'megestrol', 'melitracen', 'meloxicam', 'mephenesin',
  'mephentermine', 'mesterolone', 'metaxalone', 'methicillin',
  'methocarbamol', 'methotrexate', 'metoclopramide', 'metoprolol',
  'metrizamide', 'metronidazole', 'mexiletine', 'mianserin', 'miconazole',
  'mifepristone', 'milrinone', 'miltefosine', 'minocycline', 'minoxidil',
  'mirtazapine', 'misoprostol', 'mitoxantrone', 'mizolastine', 'moclobemide',
  'mometasone', 'montelukast', 'morphazinamide', 'mosapride', 'mycophenolate',
  // N–O
  'nadifloxacin', 'nadolol', 'nafarelin', 'nalidixic', 'naproxen', 'natamycin',
  'nateglinide', 'nebivolol', 'nebumetone', 'nelfinavir', 'netilmicin',
  'nevirapine', 'nicergoline', 'nicorandil', 'nifedipine', 'nimesulide',
  'nimustine', 'nitroglycerin', 'norethisterone', 'norfloxacin',
  'octylonium', 'ofloxacin', 'olanzapine', 'omeprazole', 'ornidazole',
  'orphenadrine', 'oxazepam', 'oxcarbazepine', 'oxethazaine', 'oxiconazole',
  'oxolinic', 'oxprenolol', 'oxybutynin', 'oxyfedrine', 'oxymetazoline',
  'oxyphenbutazone', 'oxytocin',
  // P
  'paclitaxel', 'pancuronium', 'pantoprazole', 'parecoxib', 'paroxetine',
  'penicillamine', 'pentoxifylline', 'pepleomycin', 'phenelzine',
  'phenobarbital', 'phenobarbitone', 'phenylbutazone', 'pimozide', 'pindolol',
  'pioglitazone', 'piracetam', 'piroxicam', 'polidocanol', 'poractant',
  'praziquantel', 'prednisolone', 'prenoxdiazin', 'promazine', 'promegestone',
  'propafenone', 'propranolol', 'propofol', 'protriptyline',
  // Q–R
  'quetiapine', 'quinapril', 'quinidine', 'rabeprazole', 'racecadotril',
  'raloxifene', 'ramipril', 'ranitidine', 'rauwolfia', 'reboxetine',
  'repaglinide', 'reproterol', 'rilmenidine', 'riluzole', 'risperidone',
  'ritonavir', 'ritodrine', 'rituximab', 'rivastigmine', 'rocuronium',
  'ropinirole', 'rosoxacin', 'rosiglitazone',
  // S
  'salbutamol', 'sulfasalazine', 'sulphasalazine', 'sulphapyridine',
  'calcitonin', 'saquinavir', 'satranidazole', 'secnidazole',
  'serratiopeptidase', 'sertraline', 'sibutramine', 'sildenafil', 'simvastatin',
  'sirolimus', 'sisomicin', 'picosulphate', 'cromoglycate', 'valproate',
  'somatostatin', 'somatotropin', 'sotalol', 'spectinomycin',
  'spironolactone', 'stavudine', 'sucralfate', 'sulphadoxine',
  'sulphamethoxine', 'sulphamethoxypyridazine', 'sulphaphenazole',
  'sulpiride', 'sulprostone', 'sumatriptan',
  // T–Z
  'tacrine', 'tamsulosin', 'trapidil', 'tegaserod', 'teicoplanin',
  'telmisartan', 'temozolomide', 'terazosin', 'terbutaline', 'terfenadine',
  'terizidone', 'terlipressin', 'testosterone', 'thalidomide',
  'thiocolchicoside', 'thiopropazate', 'tiaprofenic', 'tibolone', 'timolol',
  'tinidazole', 'tizanidine', 'tobramycin', 'tolfenamic', 'topiramate',
  'topotecan', 'tranexamic', 'tranylcypromine', 'trazodone', 'tretinoin',
  'trifluperazine', 'trifluoperazine', 'trifluperidol', 'triflusal',
  'trimetazidine', 'trimipramine', 'dicitrate', 'tromantadine', 'urokinase',
  'valsartan', 'vasopressin', 'vecuronium', 'venlafaxine', 'verapamil',
  'verteporfin', 'vincristine', 'vinblastine', 'vindesine', 'vinorelbine',
  'xipamide', 'zidovudine', 'ziprasidone', 'zoledronic', 'zopiclone',
  'zuclopenthixol',
  // Antibiotics class entry — the notification's explicit "Antibiotics" item puts
  // every antibiotic under Schedule H; below are the common ones not separately
  // named in the 2006 consolidated list (older penicillins, macrolides,
  // tetracyclines, aminoglycosides, nitrofurans etc.).
  'amoxicillin', 'ampicillin', 'cloxacillin', 'dicloxacillin',
  'flucloxacillin', 'cephalexin', 'cefalexin', 'cephradine', 'cefaclor',
  'cefprozil', 'azithromycin', 'erythromycin', 'roxithromycin', 'doxycycline',
  'tetracycline', 'oxytetracycline', 'gentamicin', 'lincomycin',
  'chloramphenicol', 'pefloxacin', 'lomefloxacin', 'furazolidone',
  'mupirocin', 'polymyxin', 'colistin', 'vancomycin', 'benzathine',
  'piperacillin', 'tazobactam', 'sulbactam',
];

export const SCHEDULE_X_SET = new Set(SCHEDULE_X);
export const SCHEDULE_H1_SET = new Set(SCHEDULE_H1);
export const SCHEDULE_H_SET = new Set(SCHEDULE_H);

/**
 * Filler words that carry NO drug identity (user contract: log what we ignore).
 * English function words + pharma label/pack words + commerce noise that Google
 * results add. Molecule-like words are deliberately NOT here.
 */
export const STOP_WORDS = new Set<string>([
  // function words
  'a', 'an', 'the', 'of', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should', 'must',
  'do', 'does', 'did', 'not', 'no', 'yes', 'and', 'or', 'but', 'for', 'with',
  'without', 'in', 'on', 'to', 'by', 'at', 'from', 'as', 'it', 'its', 'this',
  'that', 'these', 'those', 'there', 'here', 'what', 'which', 'who', 'how',
  'why', 'when', 'where', 'all', 'any', 'each', 'every', 'other', 'more',
  'most', 'some', 'such', 'than', 'then', 'them', 'they', 'their', 'you',
  'your', 'we', 'our', 'us', 'he', 'she', 'his', 'her', 'if', 'so', 'also',
  'very', 'just', 'about', 'into', 'over', 'under', 'between', 'per',
  // pharma label / pack / dosage words
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'strip', 'strips', 'bottle', 'vial', 'amp', 'ampoule', 'sachet', 'sachets',
  'packet', 'pack', 'packs', 'box', 'carton', 'tube', 'jar', 'can', 'cans',
  'ml', 'mg', 'mcg', 'gm', 'gram', 'grams', 'kg', 'iu', 'units', 'unit',
  'dose', 'dosage', 'doses', 'syp', 'syrup', 'susp', 'suspension', 'elixir',
  'drops', 'drop', 'inj', 'injection', 'infusion', 'ointment', 'cream', 'gel',
  'lotion', 'spray', 'powder', 'granules', 'sachet1', 'dt', 'sr', 'xl', 'er',
  'od', 'hs', 'bd', 'tds', 'qid', 'sos', 'strength', 'composition', 'salt',
  'salts', 'formulation', 'formulations', 'brand', 'brands', 'generic',
  'generics', 'medicine', 'medicines', 'drug', 'drugs', 'pharma', 'price',
  'prices', 'buy', 'online', 'order', 'india', 'uses', 'use', 'used', 'side',
  'effects', 'effect', 'benefits', 'review', 'reviews', 'mrp', 'gst', 'h1',
  'schedule', 'schedules', 'ltd', 'pvt', 'inc', 'llp', 'company', 'companies',
  'manufacturer', 'manufacturers', 'marketer', 'marketers', 'supplier',
  'distributor', 'list', 'page', 'results', 'www', 'com', 'http', 'https',
]);

/** Device/equipment SKUs are not medicines — a genuine drug name never contains these. */
export const DEVICE_WORDS: RegExp = /\b(syringes|syringe|needles|needle|pouches|pouch|lancets|lancet)\b|\binsulin\s+pen\b/;

/** Cosmetic/personal-care markers — used only as a soft hint; human still decides. */
export const COSMETIC_MARKERS = new Set<string>([
  'soap', 'shampoo', 'conditioner', 'perfume', 'deodorant', 'lipstick',
  'kajal', 'talcum', 'talc', 'diaper', 'sanitizer', 'moisturizer',
  'facewash', 'shower', 'detergent', 'toothpaste', 'mouthwash',
]);

export type ScheduleType = 'X' | 'H1' | 'H';

/** Whole-token normalization: non-alphanumerics become separators. */
export function tokenize(text: unknown): string[] {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Strict classifier for master data: X > H1 > H (stricter wins), null otherwise. */
export function classifyText(text: unknown): ScheduleType | null {
  const tokens = tokenize(text);
  for (const t of tokens) if (SCHEDULE_X_SET.has(t)) return 'X';
  for (const t of tokens) if (SCHEDULE_H1_SET.has(t)) return 'H1';
  for (const t of tokens) if (SCHEDULE_H_SET.has(t)) return 'H';
  return null;
}

/** Strict row classifier that also skips device SKUs. */
export function classifyRow(name: unknown, genericName: unknown): ScheduleType | null {
  const hay = `${name} ${genericName || ''}`;
  if (DEVICE_WORDS.test(String(hay).toLowerCase())) return null;
  return classifyText(hay);
}

export interface WordMatch {
  word: string;          // the token as found in the source text
  keyword: string;       // official list keyword it corresponds to
  schedule: ScheduleType;
  exact: boolean;        // true = literal set hit, false = typo-similar suggestion
  distance: number;      // Levenshtein distance (0 when exact)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Typo tolerance for OCR noise: distance ≤2 on long words, ≤1 on medium. */
function fuzzyBudget(tokenLen: number): number {
  if (tokenLen >= 7) return 2;
  if (tokenLen >= 5) return 1;
  return 0;
}

/**
 * Match free-text tokens against the three schedule lists.
 * Exact hits first; then typo-similar suggestions (OCR noise like
 * "offloxocin" → ofloxacin). Stop words must be removed by the caller.
 */
export function findScheduleMatches(tokens: string[]): { matches: WordMatch[]; hasExact: boolean } {
  const matches: WordMatch[] = [];
  const seen = new Set<string>();
  const allSets: Array<[Set<string>, ScheduleType]> = [
    [SCHEDULE_X_SET, 'X'],
    [SCHEDULE_H1_SET, 'H1'],
    [SCHEDULE_H_SET, 'H'],
  ];

  for (const token of tokens) {
    if (token.length < 4 || /^\d+$/.test(token)) continue;

    // Exact hits — one per token, strictest schedule wins.
    let exactHit = false;
    for (const [set, schedule] of allSets) {
      if (set.has(token)) {
        const key = `${token}|${schedule}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ word: token, keyword: token, schedule, exact: true, distance: 0 });
        }
        exactHit = true;
        break;
      }
    }
    if (exactHit) continue;

    // Fuzzy suggestions — capped at distance budget; skip when an exact hit
    // already exists elsewhere in the text to keep noise down.
    const budget = fuzzyBudget(token.length);
    if (!budget) continue;
    let best: { keyword: string; schedule: ScheduleType; distance: number } | null = null;
    for (const [set, schedule] of allSets) {
      for (const kw of set) {
        if (Math.abs(kw.length - token.length) > budget) continue;
        const d = levenshtein(token, kw);
        if (d > 0 && d <= budget && (!best || d < best.distance)) {
          best = { keyword: kw, schedule, distance: d };
        }
      }
    }
    if (best && best.distance === 1) {
      // Distance-1 hits must share the first letter to count as OCR noise.
      if (best.keyword[0] !== token[0]) best = null;
    }
    if (best) {
      const key = `${token}|${best.keyword}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ word: token, keyword: best.keyword, schedule: best.schedule, exact: false, distance: best.distance });
      }
    }
  }

  const hasExact = matches.some((m) => m.exact);
  return { matches: hasExact ? matches.filter((m) => m.exact) : matches, hasExact };
}

/** Build ONE Google search query from user-entered medicine fields. */
export function buildSearchQuery(input: { name?: string | null; packaging?: string | null; manufacturer?: string | null }): string {
  const clean = (s: string | null | undefined) => {
    const v = String(s || '').trim();
    return !v || v.toLowerCase() === 'null' ? '' : v; // legacy imports carry literal 'null' strings
  };
  const parts = [
    clean(input.name),
    clean(input.packaging),
    clean(input.manufacturer),
    'medicine composition salt',
  ];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ');
}
