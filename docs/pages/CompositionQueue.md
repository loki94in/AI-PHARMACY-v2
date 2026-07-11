# 📄 CompositionQueue Page — AI Composition Enrichment

**File**: `frontend/src/pages/CompositionQueue/index.tsx`
**Route**: `/composition-queue`
**Risk Level**: 🟡 MED — edits medicines master (generic_name / api_reference fields)

---

## What This Page Does

An AI-assisted tool that enriches the medicine catalog with composition (generic formula) data:
- Shows a queue of medicines missing composition info
- Uses Google Search (limited daily quota) to look up composition online
- Pharmacist can review/approve/edit enriched data
- Saves approved composition to the medicine record

---

## Data Flow

```
ON MOUNT
  api.getEnrichmentStatus()      →  GET /api/enrichment/status
  api.getEnrichmentQueue(page, limit, filter)
    →  GET /api/enrichment/queue

USER STARTS AUTO-ENRICHMENT
  api.startEnrichment()          →  POST /api/enrichment/start
  (background job — backend processes queue using Google Search)

USER STOPS ENRICHMENT
  api.stopEnrichment()           →  POST /api/enrichment/stop

USER EDITS COMPOSITION MANUALLY
  api.updateComposition(id, composition)
    →  PUT /api/enrichment/queue/:id

USER TRIGGERS ONLINE ENRICHMENT FOR ONE ITEM
  api.triggerOnlineEnrichment(id)  →  POST /api/enrichment/trigger-online/:id

USER EDITS SEARCH TERM (for better Google results)
  api.getTokenPreview(name)      →  GET /api/enrichment/preview-tokens
  api.setSearchTerm(id, term)    →  POST /api/enrichment/set-search-term

USER EXPORTS VERIFIED CSV
  api.exportVerifiedCsv(status)  →  GET /api/enrichment/export  (blob)

USER IMPORTS REFERENCE CSV
  api.importReferenceCsv(file)   →  POST /api/enrichment/reference/import
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **Database** | Composition is stored on the medicine record; visible in Database page |
| **Settings** | Google Search daily limit is set in Settings |
| **POS** | Richer composition data may improve search relevance |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/enrichment/status` | Job running status |
| GET | `/api/enrichment/queue` | Pending enrichment list |
| POST | `/api/enrichment/start` | Start auto-enrichment |
| POST | `/api/enrichment/stop` | Stop auto-enrichment |
| PUT | `/api/enrichment/queue/:id` | Save manual composition |
| POST | `/api/enrichment/trigger-online/:id` | Online search for one item |
| GET | `/api/enrichment/preview-tokens` | Preview search tokens |
| POST | `/api/enrichment/set-search-term` | Override search term |
| GET | `/api/enrichment/export` | Export verified CSV (blob) |
| POST | `/api/enrichment/reference/import` | Import reference CSV |

---

## ⚠️ Agent Notes — Do NOT Break

- The Google Search daily limit is enforced server-side. Frontend shows remaining quota from `getEnrichmentStatus()`. Do not add client-side quota enforcement.
- Enrichment runs as a backend background job. The frontend polls `getEnrichmentStatus()` to show progress — do NOT use WebSocket for this (polling is intentional for simplicity).
- `updateComposition` only updates `api_reference` (composition) field. It does NOT update the medicine name or packaging. Keep it targeted.
