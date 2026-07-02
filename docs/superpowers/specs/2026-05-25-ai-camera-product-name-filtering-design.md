# AI Camera Product Name Filtering Design

## Purpose
Create a filtering mechanism for AI Camera OCR results to only display product names that are registered in the inventory database, with optional internet fallback for products not found locally.

## Components
1. **AI Camera Service** (existing): Performs OCR on images using Tesseract.js
2. **Product Name Filter Service** (new): Filters OCR text against inventory medicine names using fuzzy matching, with optional internet fallback
3. **Medicines Database Table**: Existing table storing registered product names
4. **External Product API** (optional): For internet lookup when local matches insufficient

## Data Flow
1. User places medicine label images in `test-images/` folder
2. Test script calls `aiCameraService.processImage()` for each image
3. AI Camera Service returns OCR result with raw text and confidence
4. Test script extracts OCR text and calls `productNameFilterService.filterProductNames()`
5. Product Name Filter Service:
   - Loads medicine names from database on initialization (cached)
   - Performs fuzzy matching against cached medicine names
   - Returns local matches if above confidence threshold
   - Optionally calls external API for internet fallback if enabled and needed
6. Test script displays filtered product names instead of raw OCR text

## Product Name Filter Service Interface

### Configuration
- `enableInternetFallback`: boolean (default: false)
- `internetApiEndpoint`: string (required if fallback enabled)
- `internetApiKey`: string? (optional, for authenticated APIs)
- `minConfidenceThreshold`: number (default: 0.8 for 80% match)
- `fallbackTimeoutMs`: number (default: 5000ms)

### Methods
- `initialize(): Promise<void>` - Loads medicine names from database
- `filterProductNames(ocrText: string, options?: FilterOptions): Promise<FilterResult>` - Returns filtered results

### FilterResult Interface
```typescript
interface FilterResult {
  matches: string[];                    // Array of matched product names
  sources: {
    local: boolean;                     // Whether local matches included
    internet: boolean;                  // Whether internet matches included
  };
  confidence: number;                   // Average confidence of matches (0-100)
  fallbackUsed: boolean;                // Whether internet fallback was triggered
  processingTimeMs: number;             // Time spent in filtering service
}
```

## Error Handling
- Service initialization errors (DB connection) → thrown with descriptive message
- Calling filterProductNames before initialize → throws clear error
- Database empty/inaccessible → warning, continues with empty cache
- Internet API errors (timeout, invalid response, network) → caught, logged, falls back to local results
- Empty OCR text → returns empty matches
- No matches found → returns empty matches array with appropriate sources

## Testing Approach
**Unit Tests:**
- Service initialization with various DB states
- Fuzzy matching accuracy and threshold boundaries
- Caching behavior (medicine names loaded once)
- Error handling (DB errors, init sequence)
- Internet fallback triggering conditions
- Internet API call parameters and timeout handling
- Result combination logic

**Integration Tests:**
- End-to-end flow with test script using sample images
- Database integration with actual SQLite medicine records
- Performance verification (filtering adds <10ms overhead vs OCR 100-500ms)

**Manual Verification:**
- Test with images of inventory vs non-inventory medicines
- Verify internet fallback works when enabled
- Test OCR error tolerance (blurry, angled images)
- Confirm metadata shows correct sources and fallback usage

## Configuration
Environment Variables:
- `ENABLE_INTERNET_FALLBACK=true/false` (default: false)
- `PRODUCT_API_ENDPOINT` (required if fallback enabled)
- `PRODUCT_API_KEY` (optional)
- `PRODUCT_FALLBACK_TIMEOUT_MS` (default: 5000)
- `PRODUCT_MIN_CONFIDENCE_THRESHOLD` (default: 0.8)

## Implementation Notes
- AI Camera Service remains unchanged (separation of concerns)
- Medicine names loaded once per service instance (memory cache)
- Uses optimized Levenshtein distance for fuzzy matching
- Internet fallback uses native fetch API or axios
- Designed as singleton/reusable across multiple OCR calls
- Backwards compatible - existing code works unchanged
- Graceful degradation: if internet fails, still returns local results