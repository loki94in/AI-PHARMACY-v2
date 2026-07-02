import { BaseApiClient, EnrichedProductData } from './baseApiClient.js';

export class OpenFdaClient extends BaseApiClient {
  name = 'OpenFDA';
  private static cooldownUntil = 0;

  async queryMedicine(medicineName: string): Promise<EnrichedProductData | null> {
    if (!medicineName || medicineName.length < 3) return null;

    // Check if we are currently in a rate-limit cooldown period
    const now = Date.now();
    if (now < OpenFdaClient.cooldownUntil) {
      console.warn(`[OpenFDA] Circuit breaker active. Cooldown in progress until ${new Date(OpenFdaClient.cooldownUntil).toLocaleTimeString()}. Skipping query for: ${medicineName}`);
      return null;
    }

    // Check if this is a cosmetic product that we should NOT query OpenFDA for
    const lowerName = medicineName.toLowerCase();
    const isExceptionSoap = 
      lowerName.includes('ketokonazol') || 
      lowerName.includes('ketoconazole') || 
      lowerName.includes('acnestart') || 
      lowerName.includes('kz soap') || 
      lowerName.includes('kz plus') ||
      (lowerName.includes('kz') && lowerName.includes('soap'));

    if (!isExceptionSoap) {
      const cosmeticKeywords = [
        'lotion', 'shampoo', 'oil', 'cream', 'soap', 'body wash', 'face wash', 'facewash',
        'moisturizer', 'moisturiser', 'sunscreen', 'perfume', 'deodorant', 'body spray',
        'lip balm', 'toothpaste', 'toothbrush', 'powder', 'gel', 'scrub', 'conditioner', 'cleanser'
      ];
      if (cosmeticKeywords.some(keyword => lowerName.includes(keyword))) {
        console.log(`[OpenFDA] Bypassing online query for cosmetic product: ${medicineName}`);
        return null;
      }
    }

    try {
      // Clean medicine name for search query
      const query = encodeURIComponent(medicineName.replace(/[^a-zA-Z0-9\s]/g, ''));
      const apiKey = process.env.OPENFDA_API_KEY || '';
      const apiKeyParam = apiKey ? `&api_key=${apiKey}` : '';
      const url = `https://api.fda.gov/drug/label.json?search=(openfda.brand_name:"${query}"+OR+openfda.generic_name:"${query}"+OR+brand_name:"${query}"+OR+generic_name:"${query}")&limit=1${apiKeyParam}`;

      const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); // 5s timeout
      
      if (response.status === 429) {
        // Enforce 5-minute cooldown to prevent server/IP bans
        const cooldownMinutes = 5;
        OpenFdaClient.cooldownUntil = Date.now() + cooldownMinutes * 60 * 1000;
        console.error(`[OpenFDA] HTTP 429 Too Many Requests encountered! Activating circuit-breaker cooldown for ${cooldownMinutes} minutes.`);
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        return null;
      }

      const drug = data.results[0];

      // Safe extraction helper
      const extractField = (field: any): string | undefined => {
        if (!field) return undefined;
        if (Array.isArray(field)) return field.join('\n');
        return String(field);
      };

      const activeIngredients: string[] = [];
      if (drug.active_ingredient) {
        if (Array.isArray(drug.active_ingredient)) {
          activeIngredients.push(...drug.active_ingredient);
        } else {
          activeIngredients.push(String(drug.active_ingredient));
        }
      }

      const manufacturer = drug.openfda?.manufacturer_name ? 
        extractField(drug.openfda.manufacturer_name) : undefined;

      return {
        medicineName: extractField(drug.openfda?.brand_name) || medicineName,
        activeIngredients,
        indications: extractField(drug.indications_and_usage || drug.purpose),
        dosage: extractField(drug.dosage_and_administration),
        sideEffects: extractField(drug.adverse_reactions),
        warnings: extractField(drug.warnings || drug.warnings_and_precautions),
        manufacturer,
        source: this.name
      };
    } catch (error) {
      console.error(`OpenFDA query failed for ${medicineName}:`, error);
      return null;
    }
  }
}
