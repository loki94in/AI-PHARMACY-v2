# Hybrid Online/Offline Product Data Enrichment Design

## Overview
This document describes the design for enhancing the existing AI Camera OCR system with online API capabilities to enrich product data when internet connectivity is available. The system will primarily use offline OCR for medicine label scanning and supplement results with detailed information from online medicine databases when connected.

## User Requirements Summary
- Use medicine/drug databases (FDA, OpenFDA, DrugBank) for detailed product information
- Primary workflow: Use offline OCR always, enhance with online data when available
- Data enhancement goal: Get detailed medicine information (description, side effects, interactions) beyond what's on the label

## Architecture

### Core Principles
1. **Offline-first**: OCR processing remains primarily offline using Tesseract.js
2. **Optional enhancement**: Online API calls only occur when internet is available
3. **Graceful degradation**: System functions fully without internet
4. **Non-blocking**: Online data fetching doesn't delay primary OCR results
5. **Caching**: Online results cached for offline use in subsequent scans

### Component Structure
```
Enhanced AI Camera Service
├── Offline OCR Processor (Tesseract.js) - Existing
├── Online Data Enricher - New
│   ├── Connectivity Detector
│   ├── API Client Manager
│   └── Medicine Database Integrations
├── Data Merger - New
└── Result Cache - New
```

## Detailed Design

### 1. Connectivity Detection
- Implement network status monitoring using `navigator.onLine` for frontend
- Backend health check for API availability
- Automatic switching between online/offline modes

### 2. Online Data Enricher
#### API Integrations
- **OpenFDA API**: Free, no key required for basic usage
  - Endpoint: `https://api.fda.gov/drug/label.json`
  - Search by: active_ingredient, brand_name, generic_name
  - Returns: indications, dosage, side effects, contraindications, etc.

- **DrugBank API** (if available with free tier)
  - Alternative: RxNav API from NIH (free, no key required)
  - Endpoint: `https://rxnav.nlm.nih.gov/REST/`

#### API Client Features
- Rate limiting and retry logic
- Error handling for network failures
- Response parsing and normalization
- Timeout configurations (5-10 second limits)

### 3. Data Merger
Combines OCR results with online API data:
- **OCR Text**: Raw extracted text from medicine label
- **Online Data**: Structured drug information from APIs
- **Output**: Enhanced result with:
  - Original OCR text and confidence
  - Normalized medicine name
  - Active ingredients
  - Indications and usage
  - Side effects
  - Dosage and administration
  - Warnings and precautions
  - Drug interactions (if available)

### 4. Result Caching
- Cache successful online lookups by medicine name/hash
- LocalStorage IndexedDB for persistence
- Cache expiration (24-48 hours)
- Fallback to cache when offline

## Implementation Plan

### Backend Enhancements
1. **Network Status Utility**: Helper functions to detect connectivity
2. **API Client Service**: Abstract base class for medicine database APIs
3. **OpenFDA Client**: Specific implementation for OpenFDA API
4. **Data Merger Service**: Combines OCR and API results
5. **Cache Service**: Handles local caching of API responses
6. **Enhanced AI Camera Service**: Integrates online enrichment

### Frontend Enhancements
1. **Connectivity Indicator**: Visual status showing online/offline mode
2. **Enhanced Results Display**: Show additional information when available
3. **Loading States**: Indicate when online data is being fetched
4. **Error Handling**: Graceful messages when APIs fail

## Data Flow

### Offline Mode (No Internet)
1. User captures medicine label image
2. Image sent to backend for OCR processing
3. Tesseract.js extracts text and confidence
4. Basic medicine info parsed from OCR text (name, strength, etc.)
5. Results returned to user immediately
6. No online API calls made

### Online Mode (Internet Available)
1. User captures medicine label image
2. Image sent to backend for OCR processing
3. Tesseract.js extracts text and confidence
4. Basic medicine info parsed from OCR text
5. **Parallel Process**: Extract medicine name/key terms for API lookup
6. Online API query initiated (non-blocking)
7. Basic OCR results returned immediately to user
8. When API responds:
   - Data merged with OCR results
   - Result cached for future use
   - Frontend updated with enhanced information (if still visible)

## Error Handling & Fallbacks
- API timeouts: Return OCR results only, log error
- API rate limits: Cache last successful response, retry after delay
- API errors: Return OCR results with note about limited information
- Invalid responses: Return OCR results only
- No medicine match: Return OCR results with suggestion to try different angle

## Performance Considerations
- Non-blocking API calls don't delay primary OCR results
- Connection detection happens in background
- API requests limited to 5-10 second timeout
- Caching reduces redundant API calls for same medicine
- Background sync for popular medicines when connectivity detected

## Security & Privacy
- No personal data sent to APIs
- Only medicine identifiers (name, ingredients) transmitted
- HTTPS enforced for all API calls
- No API keys stored client-side (using public APIs where possible)
- Rate limiting prevents abuse

## Configuration
Feature flags for:
- `ai_camera_online_enrichment`: Enable/disable online features
- `openfda_api_enabled`: Toggle OpenFDA integration
- `alternative_api_enabled`: Toggle backup APIs
- `cache_enabled`: Toggle result caching
- `connectivity_check_interval`: How often to check network status

## Testing Strategy
1. Unit tests for API clients with mocked responses
2. Integration tests for data merger
3. End-to-end tests with mocked network conditions
4. Performance tests for caching behavior
5. Offline mode verification
6. Error scenario testing (timeouts, invalid responses)

## Files to Create/Modify
### New Files:
- `src/services/onlineDataEnricher.ts` - Main enrichment service
- `src/services/apiClients/openFdaClient.ts` - OpenFDA API integration
- `src/services/apiClients/baseApiClient.ts` - Abstract API client
- `src/services/dataMerger.ts` - Combines OCR and API results
- `src/services/cacheService.ts` - Local caching layer
- `src/utils/networkDetector.ts` - Connectivity detection utilities
- `src/routes/returns.ts` - Enhanced API endpoint (if needed)

### Enhanced Files:
- `src/services/aiCameraService.ts` - Integrate online enrichment
- `src/ui/pages/page1.html` - Enhanced results display
- `src/ui/pages/page5.html` - Enhanced batch scan display

## Next Steps
1. Implement network detection utilities
2. Create base API client and OpenFDA implementation
3. Build data merger service
4. Add caching layer
5. Enhance AI Camera Service to use online enrichment
6. Update frontend to display enhanced results
7. Add configuration and feature flags
8. Write comprehensive tests