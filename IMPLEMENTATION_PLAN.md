# Implementation Plan — Medicine Scan, Reference & Storage Upgrade

> **Purpose of this document**
> A detailed, executable plan covering **what** we are doing, **how** we are doing it, **why** we are doing it, **what** we will achieve, and **how** we will achieve it.
> Scope: make the WhatsApp / aiCamera medicine scan recognize far more medicines reliably, block garbage / non-medical scans, stop duplicate "bundling", and store everything in one master — while keeping the app **lean** (no big in-app library).
> Status: **PLAN** (to be executed on go-ahead). No source files were modified to create this document.

---

## 1. What we are doing (summary)

We are upgrading the medicine-identification pipeline in three layers:

1. **Reference data layer** — load the full drug master that already sits on disk (`data/reference_medicines.csv`, ~200k rows) into the existing SQLite DB, and create a small, separate `api_substances` table that holds **only** the unique active-ingredient names. This becomes the single trusted "substance list" the app consults.
2. **Scan / OCR / enrichment layer** — improve `aiCameraService` so a scanned photo's partial or garbled name is resolved to the proper generic medicine name, and optionally consult an external (off-by-default) scispaCy helper for dose / form / manufacturer clues when the name is unreadable.
3. **Gate + storage + dedup layer** — wire the best-performing skip/identify algorithm (V2) into the WhatsApp scan using `api_substances` as its reference; make similar (not identical) uploads **always prompt** the user via a popup instead of creating duplicates; and consolidate all writes to the master `medicines` table behind **one thin-core helper** so there is a single, conflict-safe storage path.

---

## 2. Why we are doing this (the problem today)

Research of the current code shows:

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | The app runs with only **82 seeded APIs** and **7 products**; the 200k master CSV is never loaded. | `medicine_reference` = 82 rows; `medicines` = 7 rows; `data/reference_medicines.csv` = 200,273 rows. | The app "guesses" from almost nothing. |
| 2 | The production scan gate (`isMedicineLikely`) has **no API dictionary**. It only checks name-plausibility + document-word count. | `src/services/intentKeywords.ts:274`; no `knownApis`. | Non-medical / garbage scans slip through (BISCUITS, CHATTER, R02 garbage all "identified"). |
| 3 | The gate variants we benchmarked (V1–V5) are **not wired into production** — they exist only in `scan_benchmark.ts`. | `src/services/whatsappIntentService.ts` uses `isMedicineLikely`, not `GATE_VARIANTS`. | The app uses the weakest logic in production. |
| 4 | Catalog dedup is **exact-name only**. Similar-but-different names create duplicate entries ("bundling"). | `src/routes/catalog.ts:208` (`WHERE lower(name) = lower(?)`), `:363`. | Re-uploading a similar pack keeps adding products. |
| 5 | Every input path writes its **own raw SQL**; the shared `medicineService.createMedicine/updateMedicine` is **dead code** (never imported). | `src/services/medicineService.ts:71/113`. | No single source of truth; changes risk regression. |
| 6 | WhatsApp / OCR scan **never writes to `medicines`**; it only stages a review or escalates to admin. | `src/services/whatsappIntentService.ts` → `searchAndBroadcast` (broadcast + `wa_admin_escalations` + optional `staged_medicine_reviews`). | Scanned medicines are not fetchable in the master. |

**Net today:** roughly 50–60% of real scanning is handled reliably; non-medical and garbage scans leak through; partial names often cannot be fixed; and similar uploads duplicate.

---

## 3. What we will achieve (acceptance targets)

- [ ] `medicine_reference` grows from 82 → **~200k** (full master loaded, offline).
- [ ] `api_substances` exists and holds the **unique ingredient list**; it is the gate's reference and auto-grows when a user adds a medicine.
- [ ] The chosen gate (V2) is **wired into the live WhatsApp scan**, using `api_substances` as `knownApis`.
- [ ] A clean photo of a common medicine (e.g. Azithromycin 500mg) resolves to the **proper generic name** even if OCR is cut off (`ithromycin` → `Azithromycin`).
- [ ] Garbage / non-medical scans (R02, booking, bank, biscuits) are **skipped**, not identified.
- [ ] Similar (not identical) uploads **always prompt** a Merge / Keep-new / Edit popup; no silent duplicates.
- [ ] All input paths (OCR enrichment, WhatsApp scan, catalog, enrichment workers) store through **one thin-core helper** into the master.
- [ ] The Database / POS / Inventory fetch pages show medicines **tagged by source** and linked to their staged reviews.
- [ ] scispaCy is available as an **optional, off-by-default external sidecar** (zero bloat to the Node app).
- [ ] Synthetic benchmark accuracy improves from 85.7% (current V1-equivalent) toward **~92.9% (V2)** on the labelled set, with garbage correctly skipped.

---

## 4. Locked decisions (from the planning conversation)

| Decision | Choice | Reason |
|---|---|---|
| Reference granularity | **Separate `api_substances` table** (ingredients only), kept distinct from `medicine_reference` (brand→composition→manufacturer master). | Clean, fast gate reference; no mixing of 200k brand rows into the decision path. |
| Data source | Load from the **existing `reference_medicines.csv`** on disk (no new data file, no network at runtime). | The full master is already present; we only load it. |
| scispaCy | **External Python sidecar, off by default.** | Keeps the Node app lean; it is a separate process, so no in-app library bloat. |
| Gate variant | **V2 (Signal-Required)** — identify only when OCR shows dose-form OR strength OR known API. | Best accuracy on the labelled set (92.9%, 0 false positives, 0 false negatives) and correctly skips garbage. |
| New-API registration | Auto-add from the **Product-add UI** (catalog import + review approve). | Matches how medicines actually enter the app. |
| Duplicate policy | **Always prompt** for similar (not identical) uploads; exact matches auto-update silently. | User stays in control; no wrong silent merges (aligns with "corrections via web UI only"). |
| Storage consolidation | **Thin-core single library** — only the core fields + source tag + `api_substances` write; each path keeps its own inventory/staged/alias/custom logic. | Lowest conflict risk; replaces duplicated SQL without regressions. |

---

## 5. How it works (data-flow)

```
                 ┌─────────────────────────────────────────────┐
                 │ data/reference_medicines.csv  (200k, on disk) │
                 └───────────────┬─────────────────────────────┘
                                 │  load once (offline)
                     ┌───────────┴────────────┐
                     ▼                         ▼
          medicine_reference (200k)      api_substances (unique APIs)
          brand→composition→maker         ← the gate's reference
                     │                         ▲
        used by resolver + search       │ read by
                                            │ resolver / detectKnownApi / V2 gate / scispaCy sidecar
                                            │
  PHOTO ─▶ WhatsApp scan (handleOcrComplete)
            │
            ├─ OCR (aiCameraService) ─▶ resolver: "ithromycin" → "Azithromycin"  (via api_substances + medicine_reference)
            │                           └─ scispaCy (optional): adds dose/form/maker clues
            ├─ GATE (V2) uses api_substances ─▶ identify (real) / skip (garbage, non-med)
            ├─ STORE via thin-core addOrUpdateMedicine ─▶ master mediciness (tagged source)
            └─ if similar ─▶ staged review popup (Merge / Keep new / Edit)  ← your "always prompt"
  CATALOG upload ─▶ same thin-core store + recordApiSubstance() + dedup popup
  FETCH pages (Database / POS / Inventory) ─▶ one master, tagged by source, linked to reviews
```

---

## 6. Detailed implementation steps

Each step lists **What / How / Why / Files / Sketch**.

### Phase 0 — Prep (no code)
- **What:** Confirm the master CSV is present and the DB path.
- **How:** `Test-Path data/reference_medicines.csv`; locate `data/app.db`.
- **Why:** The whole plan depends on the on-disk master existing (it does: 200,273 rows).
- **Files:** `data/reference_medicines.csv`, `data/app.db`.

### Phase 1 — Reference tables (lean data layer)
- **What:** Add the `api_substances` table and `source` / `possible_duplicate_of` columns on `medicines`; fill `api_substances` from the CSV.
- **How:**
  1. In `src/database.ts` (beside `medicine_reference` at ~L85) add:
     ```sql
     CREATE TABLE IF NOT EXISTS api_substances (
       api TEXT PRIMARY KEY,
       created_at TEXT
     );
     -- alter medicines: source TEXT, possible_duplicate_of INTEGER
     ```
  2. In `src/worker/compositionEnricher.ts` add `loadApiSubstances()` next to `loadReferenceData()` (~L77): read `REFERENCE_CSV`, take distinct `short_composition1` + `short_composition2`, normalize, `INSERT OR IGNORE INTO api_substances (api, created_at) VALUES (?, ?)`.
  3. In `src/routes/enrichment.ts` `/reference/reload-from-disk` (~L100) call **both** `loadReferenceData()` and `loadApiSubstances()`.
- **Why:** One offline action populates both the full master (for search/resolution) and the clean ingredient list (for the gate). No new data store.
- **Files:** `src/database.ts`, `src/worker/compositionEnricher.ts`, `src/routes/enrichment.ts`.

### Phase 2 — Auto-add ingredients from Product-add UI
- **What:** When a medicine is added, its ingredient is also saved into `api_substances`.
- **How:** Add `recordApiSubstance(api)` (in `productNameFilterService` or a tiny `apiSubstanceService`): `INSERT OR IGNORE INTO api_substances (api, created_at) VALUES (?, ?)`. Call it in `src/routes/catalog.ts` `/catalog/import` (after L224) and `/catalog/review/:id/approve` (after L406) whenever `api_reference` is present.
- **Why:** The reference grows by itself as the user works — no separate maintenance.
- **Files:** `src/services/productNameFilterService.ts` (or new `apiSubstanceService.ts`), `src/routes/catalog.ts`.

### Phase 3 — OCR resolver + scispaCy sidecar (off by default)
- **What:** Map partial/garbled OCR names to proper generics; optionally read dose/form/maker when the name is missing.
- **How (resolver — already partly added in `aiCameraService.ts`):**
  - `resolveGenericName` already consults `medicine_reference`; extend it to also consult `api_substances` for the API list.
  - `detectKnownApi` (~L176) validates against `api_substances` (stem-aware).
  - Attach `finalInfo.nlp` from the scispaCy client.
- **How (scispaCy — external, optional):**
  - New `python/scan_nlp/requirements.txt`: `spacy==3.*`, `scispacy`, `en_core_sci_sm`, `en_ner_bc5cdr_md`.
  - New `python/scan_nlp/main.py`: stdlib `http.server` exposing `POST /extract {text}` → `{entities:[{label,text}], features:{drug,dose,form,org}}`. (Use stdlib to honor minimal-dependency preference; validate install on Python 3.14, fall back to a venv with 3.11 if incompatible.)
  - New `src/services/scispacyClient.ts`: lazy HTTP to `SCISPAXY_URL` (default `localhost:8001`), ~1.5s timeout, returns `null` on failure → **offline-safe**; gated by `SCISPAXY_ENABLED` (default **off**).
  - `src/server.ts`: launch the sidecar at boot via the existing supervisor, only when enabled.
- **Why:** Garbage is skipped even without scispaCy; when enabled, name-less packs are still identified by features. The sidecar is a separate process, so the Node app gains zero bloat.
- **Files:** `src/services/aiCameraService.ts`, `src/services/scispacyClient.ts` (new), `python/scan_nlp/` (new), `src/server.ts`.

### Phase 4 — Wire the gate into the live WhatsApp scan
- **What:** Use V2 (Signal-Required) as the production gate, with `api_substances` as its reference.
- **How:** In `src/services/whatsappIntentService.ts` `handleOcrComplete` (~L410), build `knownApis` from `api_substances` (stem-aware: a token is "known" if any entry includes it / it includes an entry, length ≥ 5), then run `GATE_VARIANTS` V2 `decide(ocrText, potentialName, {knownApis})` instead of the weaker `isMedicineLikely`.
- **Why:** V2 scored best on the labelled set and correctly skips garbage/non-medical while keeping real medicines.
- **Files:** `src/services/whatsappIntentService.ts`, `scanGateAlgorithms.ts` (V2 already defined).

### Phase 5 — Dedup: always prompt (your choice)
- **What:** Similar (not identical) uploads never auto-bundle; they route to a popup where you decide.
- **How:**
  - Compute a canonical key = `ingredient + strength + company + form` plus a name-similarity score.
  - **Exact match** → silent auto-update (existing behavior).
  - **Similar/near-duplicate** → in `src/routes/catalog.ts` `/catalog/import` and `/catalog/review/:id/approve`, insert a **staged review** carrying `possible_duplicate_of = <existing id>` **instead of** `INSERT`ing a new medicine.
  - Frontend `frontend/src/pages/CatalogUpload` + `components/StagedReviewModal.tsx`: show *"Looks like X already exists — Merge / Keep new / Edit"*, calling the existing approve endpoint with the choice.
- **Why:** Honors "always prompt" and "corrections via web UI only"; kills duplicate bundling without wrong silent merges.
- **Files:** `src/routes/catalog.ts`, `frontend/src/pages/CatalogUpload/index.tsx`, `frontend/src/components/StagedReviewModal.tsx`.

### Phase 6 — Unified thin-core storage
- **What:** One shared writer to the master; each path keeps its special logic.
- **How:** Revive the dead `src/services/medicineService.ts` as:
  ```ts
  addOrUpdateMedicine(
    core: { name, api_reference, strength, manufacturer, ... },
    opts?: {
      source?: 'catalog'|'whatsapp'|'ocr'|'enrichment',
      customCols?: Record<string, any>,   // catalog extra CSV cols
      linkAliasOf?: number,            // medicine_aliases
      writeInventory?: boolean,         // inventory_master
      stageReview?: boolean,           // don't touch master, just stage
      possibleDuplicateOf?: number,     // dedup hint
    }
  )
  ```
  - Core only writes name/api/strength/manufacturer + `source` tag + `api_substances` write.
  - Each path retains COALESCE-if-empty, custom-column mappings, `medicine_aliases` linking, `inventory_master` writes, staged-review status, job mapping.
  - WhatsApp/OCR: confident exact match → core upsert (tagged `source`); similar/uncertain → staged popup.
  - Catalog import/approve + enrichment workers replace their raw core-SQL with this call.
- **Why:** "Thin core" decision — lowest conflict risk; the existing `medicineService` is dead code, so reviving it breaks no current callers.
- **Files:** `src/services/medicineService.ts` (revived), `src/routes/catalog.ts`, `src/services/aiCameraService.ts`, `src/worker/compositionEnricher.ts`.

### Phase 7 — Coherent fetch
- **What:** All input sources converge on one master, surfaced per page and linked.
- **How:** `medicines` rows already carry `source` + `possible_duplicate_of` (Phase 1). The **Database page** (`frontend/src/pages/Database`, `GET /medicines`) becomes the master view, tagged by source with a link to the staged review. POS (`GET /sales/search-medicine`) and Inventory (`GET /inventory`) already read `medicines`, so scanned + catalog medicines appear automatically.
- **Why:** "Each other in the app" — one truth, presented in each context, all linked.
- **Files:** `src/routes/medicines.ts`, `frontend/src/pages/Database/index.tsx`, `frontend/src/pages/POS/index.tsx`, `frontend/src/pages/Inventory/index.tsx`.

### Phase 8 — Verify
- **What:** Prove the upgrade works.
- **How:**
  - Trigger `POST /api/enrichment/reference/reload-from-disk`; assert `COUNT(*) FROM api_substances` ≈ unique APIs and `medicine_reference` ≈ 200k.
  - Re-run `npx tsx scan_benchmark.ts` (labelled set) and `npx tsx real_eval.ts` (R01 → Azithromycin; R02 → skipped).
  - OCR the two real folder images via the running server's `/api/aicamera/analyze` to confirm `genericName` resolves and garbage is skipped.
  - Upload a similar-name medicine → confirm popup appears and no duplicate is created in `medicines`.
  - `node scripts/quick-update.mjs` to refresh the knowledge graph.
- **Why:** Concrete acceptance against the targets in Section 3.
- **Files:** `scan_benchmark.ts`, `real_eval.ts`, `scripts/quick-update.mjs`.

---

## 7. How we will achieve it (execution order)

1. Phase 1 (schema + loaders) — foundation, offline, no behavior change yet.
2. Phase 2 (auto-add) — small, depends on Phase 1 table.
3. Phase 4 (gate wiring) — immediately improves live scans using `api_substances`.
4. Phase 5 (dedup popup) — stops bundling; depends on staged-review UI.
5. Phase 6 (thin-core store) — consolidates writes; depends on Phases 1–2.
6. Phase 3 (resolver + scispaCy) — resolver now; scispaCy sidecar as an optional follow-up (off by default).
7. Phase 7 (fetch coherence) — UI tagging/links.
8. Phase 8 (verify) — runs throughout; final pass after all phases.

---

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Python 3.14 incompatible with scispaCy | Medium | Validate at install; fall back to a venv with Python 3.11. App works without it (sidecar off by default). |
| scispaCy NER weak on Indian brands | High | It **augments**, never replaces, the dictionary resolver. Brand→generic still comes from `medicine_reference`. |
| Consolidating storage causes regressions | Medium | **Thin-core** decision: each path keeps inventory/staged/alias/custom logic; `medicineService` is dead code, so no prior callers break. |
| Exact-vs-similar threshold misfires | Low–Med | Similar always **prompts** (your choice), so a wrong call is corrected by you, never silent. |
| Loading 200k rows is slow | Low | Bulk insert in batches of 500 (existing pattern in `loadReferenceData`); one-time, offline. |
| App bloat from "big library" | None | 200k data → existing SQLite; `api_substances` → tiny derived table; scispaCy → external process. **No new in-app library.** |

---

## 9. Lean-check summary (why this stays lightweight)

- **Heavy 200k data** → existing **SQLite**, loaded from the CSV already present on disk.
- **`api_substances`** → a tiny **derived** table, not a separate data store.
- **scispaCy** → an **external process**, **off by default**.
- **Storage** → **one thin helper** replacing duplicated SQL.
- **No new in-app library**; everything points at one shared reference.

---

*End of plan. Execute on go-ahead.*
