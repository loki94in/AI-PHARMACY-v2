# Implementation Plan — WhatsApp OCR → Smart Medicine Match Pipeline

**Project:** AI Pharmacy v2 (AR Pharmacy WhatsApp Intelligence Engine)
**Status:** Approved for implementation
**Scope:** Identify medicines from WhatsApp photos using OCR + dosage form + MRP filters,
link to customer history, show matched details to admin, work offline via local Pharmarack
catalog cache. CPU/RAM safe, open-source, no external downloads.

---

## 1. CONFIRMED DECISIONS

| Decision | Choice |
|----------|--------|
| Heavy NLP (spaCy) | NOT used. Small offline EN/HI/MR keyword list only. |
| Downloads | None. All libs already in `package.json` (sqlite3 FTS5, Tesseract.js, ONNX). |
| Ignore list | Database table, admin-editable via checkbox, live (no restart). |
| Language handling | Offline keyword list (free, no translation API). |
| Unknown medicine | Admin review + learn (audit queue → corrections). |
| No-medicine-found flow | Local distributor catalog FIRST → live Pharmarack → audit. |
| Scan concurrency | Max 2 at a time (queue). |
| Message listener UI | Separate screen (not chat box) with per-number ignore checkbox. |
| Boot impact | None. Heavy work background/event-driven. FTS5 replaces RAM name array. |

---

## 2. END-TO-END WORKFLOW

```
1. WhatsApp message arrives (sender phone + text ± image)
2. IGNORE CHECK → phone in ignored_whatsapp_numbers? YES → skip. NO → continue.
3. MEDIA CHECK → text-only ("same","2 strips")? → use customer history, NO OCR.
4. ALREADY-SCANNED? → msg ID in scanned_messages? YES → reuse cache. NO → continue.
5. OCR SCAN (max 2 concurrent via queue) → name + dosageForm + MRP.
6. INTENT CHECK (EN/HI/MR keyword list) → talk vs medicine request.
7. SMART MATCH:
   a) FTS5 name search (O(log n))
   b) SQL filter: item_type = dosageForm AND mrp BETWEEN ±20%
   c) fuzzy re-rank on narrowed set
8. RESULT:
   ≥95% → draft + admin one-tap confirm
   80–94% → draft + admin verify
   not in master → local distributor_catalog (offline)
   not there → live Pharmarack fallback
   not anywhere → ocr_audit_queue + ask customer
9. LEARN: correction → ocr_corrections + pharmacist_corrections
10. CUSTOMER LINK: phone → customers.phone → history/refill shown to admin
```

---

## 3. DATABASE CHANGES (in `src/database.ts` → `ensureSchema`)

### 3.1 New Tables

```sql
-- Admin-managed numbers that must NOT be scanned
CREATE TABLE IF NOT EXISTS ignored_whatsapp_numbers (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ignored_phone ON ignored_whatsapp_numbers (phone);

-- Prevents re-scanning the same image message
CREATE TABLE IF NOT EXISTS scanned_messages (
  msg_id TEXT PRIMARY KEY,
  chat_id TEXT,
  result_json TEXT,
  scanned_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scanned_msg ON scanned_messages (msg_id);

-- Offline copy of mapped Pharmarack distributor catalogs
CREATE TABLE IF NOT EXISTS distributor_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER,
  store_name TEXT,
  product_name TEXT,
  mrp REAL,
  packaging TEXT,
  dosage_form TEXT,
  manufacturer TEXT,
  salt TEXT,
  strength TEXT,
  distributor_price REAL,
  availability TEXT,
  last_synced TEXT,
  UNIQUE(store_id, product_name)
);
CREATE INDEX IF NOT EXISTS idx_dist_catalog_name ON distributor_catalog (product_name);
CREATE INDEX IF NOT EXISTS idx_dist_catalog_form ON distributor_catalog (dosage_form);

-- Fast fuzzy name search (built into sqlite3, no download)
CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fts USING fts5(
  name, content='medicines', content_rowid='id', tokenize='trigram'
);
```

### 3.2 FTS5 Sync Trigger

Add triggers so `medicines_fts` stays in sync with `medicines`:

```sql
CREATE TRIGGER IF NOT EXISTS medicines_ai AFTER INSERT ON medicines BEGIN
  INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER IF NOT EXISTS medicines_ad AFTER DELETE ON medicines BEGIN
  INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
END;
CREATE TRIGGER IF NOT EXISTS medicines_au AFTER UPDATE ON medicines BEGIN
  INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
  INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
END;
```

> Note: existing rows must be backfilled once:
> `INSERT INTO medicines_fts(rowid, name) SELECT id, name FROM medicines;`

---

## 4. SERVICES / FILES (new + modify)

| # | File | Action | Responsibility |
|---|------|--------|----------------|
| 1 | `src/services/ocrScanQueue.ts` | NEW | Queue, max 2 concurrent OCR jobs, drops duplicates. |
| 2 | `src/services/pharmarackCatalogCache.ts` | NEW | Daily sync of mapped distributors → `distributor_catalog`; offline FTS5 search. |
| 3 | `src/services/intentKeywords.ts` | NEW | EN/HI/MR intent + medicine-signal word list (offline, free). |
| 4 | `src/services/whatsappIntentService.ts` | NEW | Gate: ignore → media → already-scanned → intent → dispatch OCR. |
| 5 | `src/services/aiCameraService.ts` | MODIFY | Add `detectDosageForm()`; pass `dosageForm`+`mrp` into matcher. |
| 6 | `src/services/productNameFilterService.ts` | MODIFY | Accept `dosageForm`+`mrp`; FTS5 then SQL filter; multi-signal confidence. |
| 7 | `src/routes/pharmarack.ts` | MODIFY | Add `POST /catalog/sync`; keep dosage form as filter (stop stripping). |
| 8 | `src/whatsappClient.ts` | MODIFY | Route inbound media through `whatsappIntentService` gate. |
| 9 | `src/server.ts` | MODIFY | Start catalog-sync cron in background (like `tokenRefreshScheduler`). |
| 10 | `frontend/src/MessageListener.tsx` | NEW UI | Message list (not chat box) + per-number ignore checkbox. |
| 11 | `frontend/src/AdminMatchView.tsx` | NEW UI | Matched medicine + customer history + one-tap confirm. |

---

## 5. SERVICE DETAILS

### 5.1 `ocrScanQueue.ts`
- Module-level array queue + 2 worker slots.
- `enqueue(msgId, buffer, meta)` → if msgId already queued/done, skip.
- Uses existing `aiCameraService.processImage`.
- On finish, writes `scanned_messages` result.

### 5.2 `pharmarackCatalogCache.ts`
- `syncCatalog()` → for each mapped distributor (from `GET /pharmarack/distributors`),
  fetch catalog, upsert into `distributor_catalog` (store_id + product_name unique).
- `searchCatalog(name, dosageForm?, mrp?)` → FTS5 `MATCH` on `distributor_catalog`
  + SQL `dosage_form`/`mrp BETWEEN` filter → returns candidates.
- Reuses `tokenRefreshScheduler` session token (Pharmarack session persistence contract).

### 5.3 `intentKeywords.ts`
- Exports `INTENT_WORDS` (order/need/send/refill + हवं/दवा/औषध/ऑर्डर/पाठवा/करा)
  and `isMedicineRequest(text)` + `isMedicineName(text)` (fuzzy check vs DB sample).
- Pure data + small functions. No network.

### 5.4 `whatsappIntentService.ts`
```
async handleInbound(message):
  if ignored_whatsapp_numbers.has(message.from): return  // no scan
  if !message.hasMedia:
     use customer history / patient_refills for text intent; return
  if scanned_messages.has(message.id): return cached
  if !intentKeywords.isMedicineRequest(message.body): return  // normal talk
  ocrScanQueue.enqueue(message.id, mediaBuffer, { phone: message.from })
```

### 5.5 `aiCameraService.ts` (modify)
- Add `detectDosageForm(text)` reusing patterns from `extractor.ts:20`
  (Tab/Cap/Syp/Susp/Inj/Gel/Cream/Drops/Oint/Lotion/Powder/Spray/Inh).
- In `processImage`, set `finalInfo.dosageForm` and pass to
  `productNameFilterService.filterProductNames(text, { dosageForm, mrp })`.

### 5.6 `productNameFilterService.ts` (modify)
- `FilterOptions` gains `dosageForm?`, `mrp?`, `mrpTolerance?` (default 0.2).
- Replace full-array loop (`medicinesNames` at line 360) with:
  ```sql
  SELECT m.id, m.name, m.mrp, m.item_type
  FROM medicines_fts f JOIN medicines m ON m.id = f.rowid
  WHERE medicines_fts MATCH ?
    AND (? IS NULL OR m.item_type = ?)
    AND (? IS NULL OR m.mrp BETWEEN ? AND ?)
  ```
- Re-rank narrowed set with existing `enhancedSimilarity`.
- Confidence = 0.5*nameSim + 0.25*dosageMatch + 0.25*mrpMatch.
- Remove `medicineNames` in-RAM array load (line 251) → RAM safe.
- If no master match, call `pharmarackCatalogCache.searchCatalog(...)`.

### 5.7 `pharmarack.ts` (modify)
- Add `router.post('/catalog/sync', ...)` → triggers `pharmarackCatalogCache.syncCatalog()`.
- In `cleanSearchQuery`, stop stripping dosage words; instead return them as a separate
  `detectedForms` array so they can be used as filters downstream.

### 5.8 `whatsappClient.ts` (modify)
- In message handler, call `whatsappIntentService.handleInbound(message)` instead of
  directly dispatching OCR.

### 5.9 `server.ts` (modify)
- Add background step (like Step 8) starting daily catalog sync via `node-cron`
  (already a dependency): `cron.schedule('0 3 * * *', () => pharmarackCatalogCache.syncCatalog())`.

---

## 6. UI (frontend) — AGENTS.md COMPLIANCE

- Use ONLY semantic theme vars: `bg-bg`, `bg-bg2`, `text-text`, `text-muted`,
  `border-border`, `bg-glass-bg`. No hardcoded Tailwind colors.
- `MessageListener.tsx`: lists `whatsapp_messages` (module-level cache), shows sender,
  snippet, has-media badge; each row has an **Ignore** checkbox → toggles
  `ignored_whatsapp_numbers`. No simulated/mock data — live only.
- `AdminMatchView.tsx`: shows matched medicine (name, type, MRP, stock), customer
  history (`customers` + `patient_refills`), confidence, and Confirm button.

---

## 7. CPU / RAM SAFETY (enforced)

- Scan only on new image from non-ignored number.
- One scan per image (cached by msg ID).
- FTS5 → no full medicine-name array in RAM.
- Queue caps at 2 concurrent.
- OCR model unloads when idle (existing `onnxOcrService.ts`).
- Nothing at boot; catalog sync is background cron.

---

## 8. OPEN-SOURCE / LEGAL

All components MIT/Apache/public-domain, already in `package.json`:
sqlite3 (FTS5), tesseract.js, onnxruntime-node/paddleocr, express, node-cron.
No proprietary API for core flow. Safe for others to reuse.

AGENTS.md rules honored:
- Run `node scripts/quick-update.mjs` after any file change.
- UI uses semantic theme vars.
- No simulated Pharmarack cart in UI.
- Reuses `tokenRefreshScheduler` session persistence (profile lock cleanup + copy-back).

---

## 9. IMPLEMENTATION ORDER

1. `src/database.ts` — add 4 tables + FTS5 + triggers + backfill.
2. `src/services/ocrScanQueue.ts` — NEW.
3. `src/services/intentKeywords.ts` — NEW.
4. `src/services/pharmarackCatalogCache.ts` — NEW.
5. `src/services/whatsappIntentService.ts` — NEW.
6. `src/services/aiCameraService.ts` — MODIFY (dosage form).
7. `src/services/productNameFilterService.ts` — MODIFY (FTS5 + filters).
8. `src/routes/pharmarack.ts` — MODIFY (sync route, keep dosage filter).
9. `src/whatsappClient.ts` — MODIFY (route via gate).
10. `src/server.ts` — MODIFY (catalog-sync cron).
11. `frontend/src/MessageListener.tsx` — NEW UI.
12. `frontend/src/AdminMatchView.tsx` — NEW UI.
13. `node scripts/quick-update.mjs`.
14. Test: ignored number, text-only refill, image match, unknown→audit.

---

## 10. TEST CHECKLIST

- [ ] Ignored number → no scan, no RAM use.
- [ ] Text-only "same" → refill from history, no OCR.
- [ ] Same image twice → scanned once.
- [ ] Photo of "Pylcal D Syrup MRP 95" → matches syrup only, not tablet.
- [ ] Unknown medicine → local catalog → live Pharmarack → audit queue.
- [ ] Admin correction → saved to `ocr_corrections`, reused next time.
- [ ] Boot time unchanged (<20ms HTTP, heavy work background).
- [ ] UI ignore checkbox toggles `ignored_whatsapp_numbers` live.
- [ ] `node scripts/quick-update.mjs` ran after changes.
