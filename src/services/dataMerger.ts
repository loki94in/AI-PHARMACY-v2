import { EnrichedProductData } from './apiClients/baseApiClient.js';

export interface MergedMedicineResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
  }>;
  medicineInfo: {
    potentialName: string;
    strength?: string;
    batchNumber?: string;
    expiryDate?: string;
    mrp?: number;
    // Enhanced fields
    activeIngredients?: string[];
    indications?: string;
    dosage?: string;
    sideEffects?: string;
    warnings?: string;
    manufacturer?: string;
    enrichmentSource?: string;
    isEnriched: boolean;
  };
  matches: string[];
  fallbackUsed: boolean;
  auditLogged: boolean;
}

export function mergeOcrAndEnrichedData(
  ocrResult: any,
  enrichedData: EnrichedProductData | null
): MergedMedicineResult {
  const merged = { ...ocrResult };

  if (enrichedData) {
    merged.medicineInfo = {
      ...merged.medicineInfo,
      activeIngredients: enrichedData.activeIngredients,
      indications: enrichedData.indications,
      dosage: enrichedData.dosage,
      sideEffects: enrichedData.sideEffects,
      warnings: enrichedData.warnings,
      manufacturer: enrichedData.manufacturer || merged.medicineInfo.manufacturer,
      enrichmentSource: enrichedData.source,
      isEnriched: true
    };
  } else {
    merged.medicineInfo = {
      ...merged.medicineInfo,
      isEnriched: false
    };
  }

  return merged as MergedMedicineResult;
}
