export interface EnrichedProductData {
  medicineName: string;
  activeIngredients?: string[];
  indications?: string;
  dosage?: string;
  sideEffects?: string;
  warnings?: string;
  manufacturer?: string;
  source: string;
}

export abstract class BaseApiClient {
  abstract name: string;
  abstract queryMedicine(medicineName: string): Promise<EnrichedProductData | null>;
}
