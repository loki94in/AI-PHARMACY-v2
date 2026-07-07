import { BaseApiClient, EnrichedProductData } from './baseApiClient.js';

/**
 * RxNormClient — third fallback tier using the free, keyless NLM RxNorm REST API.
 *
 * Strategy:
 *  1. Exact RXCUI lookup: GET /rxcui.json?name=<name>
 *  2. If no exact match: GET /approximateTerm.json?term=<name> → take top-scored candidate
 *  3. Resolve ingredients: GET /rxcui/<id>/related.json?tty=IN+PIN+MIN
 *
 * RxNorm is a terminology/ingredient service, not a label database, so only
 * `activeIngredients` is populated — which is the only field the composition
 * enrichment feature actually consumes (joined into the api_reference string).
 *
 * Conventions match OpenFdaClient:
 *  - 5 s AbortSignal.timeout
 *  - catch-and-return-null on any failure
 *  - `source: this.name`
 */
export class RxNormClient extends BaseApiClient {
  name = 'RxNorm';
  private static readonly BASE = 'https://rxnav.nlm.nih.gov/REST';

  async queryMedicine(medicineName: string): Promise<EnrichedProductData | null> {
    if (!medicineName || medicineName.length < 3) return null;

    try {
      // Step 1: exact RXCUI lookup
      let rxcui = await this.resolveExactRxcui(medicineName);

      // Step 2: approximate lookup if no exact hit
      if (!rxcui) {
        rxcui = await this.resolveApproximateRxcui(medicineName);
      }

      if (!rxcui) return null;

      // Step 3: resolve to ingredient name(s). If the resolved concept is
      // already an atomic Ingredient/Precise Ingredient (TTY=IN/PIN), use its
      // own name directly — asking `related.json` for IN+PIN+MIN on an
      // already-atomic ingredient returns sibling combination products it
      // participates in (e.g. "ibuprofen / phenylephrine"), not itself.
      // Only decompose via `related.json` when the resolved concept is a
      // higher-level drug/product type that actually has components.
      const tty = await this.fetchTty(rxcui);
      let ingredients: string[] | null;
      if (tty === 'IN' || tty === 'PIN') {
        const ownName = await this.fetchName(rxcui);
        ingredients = ownName ? [ownName] : null;
      } else {
        ingredients = await this.fetchIngredients(rxcui);
      }
      if (!ingredients || ingredients.length === 0) return null;

      return {
        medicineName,
        activeIngredients: ingredients,
        source: this.name,
      };
    } catch (error) {
      console.error(`[RxNorm] Query failed for ${medicineName}:`, error);
      return null;
    }
  }

  /** Returns the RXCUI for an exact name match, or null. */
  private async resolveExactRxcui(name: string): Promise<string | null> {
    try {
      const url = `${RxNormClient.BASE}/rxcui.json?name=${encodeURIComponent(name)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const id = data?.idGroup?.rxnormId?.[0];
      return id ? String(id) : null;
    } catch {
      return null;
    }
  }

  /** Returns the top-scored approximate RXCUI, or null. */
  private async resolveApproximateRxcui(name: string): Promise<string | null> {
    try {
      const url = `${RxNormClient.BASE}/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const candidates = data?.approximateGroup?.candidate;
      if (!candidates || candidates.length === 0) return null;
      // Candidates are returned sorted by score descending — take the first
      return String(candidates[0].rxcui);
    } catch {
      return null;
    }
  }

  /**
   * Decomposes a drug/product-level RXCUI into its atomic ingredient names
   * (tty=IN+PIN only — MIN concepts are themselves combination-level and
   * would reintroduce the same non-atomic naming problem this is meant to avoid).
   */
  private async fetchIngredients(rxcui: string): Promise<string[] | null> {
    try {
      const url = `${RxNormClient.BASE}/rxcui/${rxcui}/related.json?tty=IN+PIN`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const conceptGroups: any[] = data?.relatedGroup?.conceptGroup || [];
      const names: string[] = [];
      for (const group of conceptGroups) {
        for (const prop of group?.conceptProperties || []) {
          if (prop?.name) names.push(prop.name);
        }
      }
      return names.length > 0 ? names : null;
    } catch {
      return null;
    }
  }

  /** Returns the RxNorm term-type (e.g. 'IN', 'PIN', 'SCD', 'SBD') for a given RXCUI. */
  private async fetchTty(rxcui: string): Promise<string | null> {
    try {
      const url = `${RxNormClient.BASE}/rxcui/${rxcui}/property.json?propName=TTY`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const prop = data?.propConceptGroup?.propConcept?.[0];
      return prop?.propValue || null;
    } catch {
      return null;
    }
  }

  /** Returns the canonical RxNorm name for a given RXCUI. */
  private async fetchName(rxcui: string): Promise<string | null> {
    try {
      const url = `${RxNormClient.BASE}/rxcui/${rxcui}/property.json?propName=RxNorm%20Name`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      const prop = data?.propConceptGroup?.propConcept?.[0];
      return prop?.propValue || null;
    } catch {
      return null;
    }
  }
}
