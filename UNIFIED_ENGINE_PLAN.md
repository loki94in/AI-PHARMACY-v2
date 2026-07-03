# Medicine Availability Engine Service

This service provides a unified, intelligent approach to medicine availability checking and alternative finding across multiple dimensions (composition, therapeutic category, fuzzy matching) with dynamic stock limits, learning from pharmacist corrections, and extensible for new matching strategies.

## Core Features

### 1. **Unified Alternative Finding**
- **Composition-based**: Same api_reference (exact salt/composition matches)
- **Therapeutic category**: Same item_type (category matches like "Tablet", "Syrup", "Injection")
- **Fuzzy name matching**: Levenshtein + Soundex + N-gram similarity for misspellings
- **Multi-stage fallback**: Highest confidence to lowest for comprehensive suggestions

### 2. **Dynamic Stock Management**
- **Per-medicine average daily sales** (from sale_items)
- **Dynamic safety stock** = `(daily_sales × lead_time × safety_factor)`
- **Per-category fallbacks** (10 units for high-prescription categories, 5 for others)
- **Global default** (10 units) as ultimate fallback
- **Reordered daily** via stockCalculatorWorker

### 3. **Intelligence & Learning**
- **Pharmacist corrections**: Learns from correction patterns in sales fixups
- **Confidence scoring**: 85-100% exact matches, progressive decline
- **Contextual suggestions**: Out-of-stock? Suggest substitutes automatically
- **Progressive disclosure**: High-confidence suggestions auto-displayed, lower requires click

### 4. **API Integration**
- **Single entry point**: `getAvailableMedicinesOrAlternatives(query, context)`
- **Context-aware**: POS vs Catalog vs Emergency mode
- **Batch processing**: Efficient lookup for multiple queries
- **Fallback strategies**: Pharmarack external search as last resort

### 5. **Performance Optimizations**
- **Module-level caching**: In-memory for instant rendering
- **Lazy loading**: Heavy queries only on demand
- **Background workers**: Pre-compute substitutes as they become available
- **Database optimization**: Use existing indexes efficiently

## Service Architecture

```bash
┌─────────────────────────────────────┐
│   medicineAvailabilityEngine.ts     │
│   (Service Layer)                   │
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   medicineCache.ts                 │ (Module-level cache)
│   stockCalculatorWorker.ts         │ (Background recalculation)
│   substituteCacheWorker.ts          │ (Pre-compute alternatives)
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   API Routes (unified)              │
│   - /api/medicines/availability     │
│   - /api/medicines/search-full     │
│   - /api/medicines/substitutes      │
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   Existing Components (adapted)     │
│   - frontend/src/pages/POS/index.tsx │
│   - frontend/src/pages/Catalog/index.tsx │
│   - src/services/medicineService.ts  │
│   - src/routes/v1/sales.ts           │
│   - src/routes/catalog.ts            │
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   Other Systems                   │
│   - enrichment.ts (composition)     │
│   - catalogueWorker.ts (catalog)   │
│   - src/telegramBot.ts (suggestions) │
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   External Systems                │
│   - Pharmarack (fallback)           │
│   - openFDA (external lookup)      │
│   - Google search (development)    │
└─────────────────────┬───────────────┘
                      │
┌─────────────────────────────────────┐
│   Configuration                    │
│   - app_settings.json              │
│   - configurable thresholds        │
│   - background job settings       │
└─────────────────────────────────────┘
```

## Usage Examples

### POS Search with Automatic Suggestions
```bash
// Get medicines by name, auto-suggest composition-based alternates
const result = await medicineAvailabilityEngine.getAvailableMedicinesOrAlternatives(
  "Atorvastatin 10mg",
  { mode: "POS", includeOutOfStock: false }
);
// Result includes in-stock items + same-salt alternatives
```

### Catalog Search with Substitutes
```bash
// Get catalog items with available substitutes
const catalog = await medicineAvailabilityEngine.getCatalogItemsWithSubstitutes(
  "Lisinopril",
  { category: "BP", maxDistance: 3 }
);
// Returns catalog items + available meds of similar therapeutic value
```

### Emergency Stock Check
```bash
// Critical medicines for emergency preparedness
const emergency = await medicineAvailabilityEngine.getEmergencyStock(
  ["Injured soldiers medicaments",
   "Critical trauma medications",\n   "Allergy rescue medications"]
);
// Returns soldiers-specific stock levels + suggested supply gaps
```

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/services/medicineAvailabilityEngine.ts` | Core service implementation |
| `src/worker/stockCalculatorWorker.ts` | Background stock limit recalc |
| `src/worker/substituteCacheWorker.ts` | Pre-compute substitute relationships |
| `src/database.ts` | New tables/columns (stock_config, substitutes) |
| `src/routes/medicineAvailability.ts` | New API endpoints |
| `src/routes/v1/medicines.ts` | Optional v1 API endpoints |
| `src/services/medicineService.ts` | Migrate parts of POS search to engine |
| `src/routes/sales.ts:743` | Use engine for alternatives |
| `src/telegramBot.ts:656` | Use engine for category substitutes |
| `src/routes/catalog.ts:398` | Auto-fill substitute relationships |

## Testing Approach

1. **Unit tests**: Each algorithm (composition, category, fuzzy) independently verified
2. **Integration tests**: End-to-end flow from lookup to suggestion verified
3. **Performance tests**: Response times measured under load
4. **Regression tests**: Existing search behavior preserved

## Migration Strategy

1. **Phase 1**: Core engine deployment (silent switch-over)
2. **Phase 2**: UI component integration
3. **Phase 3**: Legacy cleanup (phases 3-4 from FIX.md)
4. **Phase 4**: Full rollout with monitoring

## Technical Debt Mitigation

- **No simulated features**: Never show mock "pharmacart" or fallback data
- **Real data only**: All alternatives must come from actual database
- **Performance blocking**: Never render page with loading spinner on heavy queries
- **Security**: All access logged for soldier health tracking compliance

## Conflict Resolution

### Multiple Alternative Strategies (FIX.md vs Engine Plan)
**Engine is chosen because:**
- Unifies 3 separate alternative-finding mechanisms
- Eliminates code duplication
- Provides consistent scoring across all touchpoints
- Reduces maintenance burden (single codebase vs 3 separate)

### Stock Limits (FIX.md vs Engine Plan)
**Engine wins because:**
- Replaces arbitrary hardcoded values with intelligent, business-driven calculations
- Integrates with sales data, creating an adaptive system
- Reduces inventory waste and stock-outs through AI-driven insight
- Configures via app_settings for flexibility

### POS "Did You Mean?" (FIX.md vs Engine Plan)
**Engine wins because:**
- Unifies fuzzy matching across POS, Catalog, and Telegram
- Uses trained productNameFilterService for consistency
- De-duplicates the fuzzy logic implementation
- Provides confidence scores for user decisions
