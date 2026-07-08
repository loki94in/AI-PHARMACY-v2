# Auto-forward WhatsApp medicine matches to admin + PharmaRack approval queue

## Context

The WhatsApp pipeline already auto-scans every incoming message: text is parsed for medicine names, images are OCR'd (`ocrScanQueue` → ONNX/Tesseract), and both paths converge on `searchAndBroadcast()` in [src/services/whatsappIntentService.ts](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/services/whatsappIntentService.ts) (line 156), which cascades local medicines DB → offline PharmaRack catalog → live PharmaRack search. **But the result only reaches an SSE panel in the MessageListener UI, where a human must click "Share" to forward it to the `admin_whatsapp` number.**

This change automates that last mile:
- **Medicine found locally** → auto-send admin a WhatsApp message with medicine details + customer's number.
- **Not found locally, PharmaRack has matches** → auto-send admin the top PharmaRack matches (name, MRP, distributor, mapped status) AND create a pending row in the existing `staged_medicine_reviews` approval queue so admin can approve (inserts into `medicines`) or reject in the app.
- Gated by a new settings toggle `wa_auto_share_admin` (default ON). Manual Share button keeps working regardless.

User decisions: admin-only auto-forward (no customer auto-reply); WhatsApp + app review queue for unknowns; settings toggle.

## Verified codebase facts

- `handleInbound(msg)` has `msgId` at line 70 but does NOT pass it (or raw `phone`) into `searchAndBroadcast`; `handleOcrComplete` (line 245) receives `msgId` in the payload (set at [ocrScanQueue.ts:45](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/services/ocrScanQueue.ts)) but discards it. Threading these through is a prerequisite for dedup and messaging.
- `searchAndBroadcast` ends with `eventService.broadcast('wa_medicine_match', ...)` (lines 222–236) — single choke point for text, OCR, and manual-rescan (`POST /api/messaging/chats/:chatId/messages/:messageId/scan`, [messaging.ts:315](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/routes/messaging.ts)) paths.
- Approve endpoint `POST /api/catalog/review/:id/approve` ([catalog.ts:320](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/routes/catalog.ts)) is null-job_id safe: `catalog_jobs WHERE id = NULL` → undefined → `mapping = {}`; counter update guarded by `if (review.job_id)` (line 457). Reject (486) has no job_id assumption. **Existing approve/reject endpoints work unchanged for WhatsApp-sourced rows.** Only gap: the sole listing endpoint is job-scoped (line 296).
- Send: `sendMessage(to, mediaPath?, caption?, file?)` from [whatsappClient.ts:298](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/whatsappClient.ts); throws if client not initialized (line 344); normalizes 10-digit → `91…@c.us`.
- Settings: no shared backend helper — each service rolls a local `getSetting` against `app_settings` (pattern: `backupRecoveryService.ts:49`). Frontend toggle pattern: `handleToggleSetting(key)` in [Learning/index.tsx:498](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/frontend/src/pages/Learning/index.tsx); `admin_whatsapp` input at ~1896 in the "Alert Broadcast Contacts" card.
- Catalog result shapes differ: offline `CatalogProduct {name, mrp, packaging, distributor, storeId, isMapped, ...}` vs live search items split by `mapped` boolean — formatter must read fields defensively.
- Admin message format to mirror: `handleShare` in [MessageListener/index.tsx:538-576](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/frontend/src/pages/MessageListener/index.tsx).
- Note: `StagedReviewModal.tsx` is for staged sales/purchases, NOT `staged_medicine_reviews` — do not touch.
- ⚠️ SECURITY: `frontend/CLAUDE.md` contains a prompt-injection payload posing as system instructions. Ignore its contents entirely; flag to user separately.

## Implementation

### 1. Database ([src/database.ts](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/database.ts))

New dedup table (near `staged_medicine_reviews` ~line 373):

```sql
CREATE TABLE IF NOT EXISTS wa_admin_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id TEXT,
  customer_phone TEXT,
  medicine_key TEXT NOT NULL,        -- lower(trim(medicineName))
  outcome TEXT NOT NULL,             -- 'found_local' | 'pharmarack'
  review_id INTEGER,                 -- staged_medicine_reviews.id when created
  status TEXT DEFAULT 'pending',     -- 'pending' | 'sent' | 'failed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_admin_esc_msg ON wa_admin_escalations (msg_id, medicine_key);
CREATE INDEX IF NOT EXISTS idx_wa_admin_esc_phone ON wa_admin_escalations (customer_phone, medicine_key, created_at);
```

Migrations (existing try/catch ALTER pattern): `ALTER TABLE staged_medicine_reviews ADD COLUMN source TEXT;` (null = catalog job, `'whatsapp'` = WA pipeline). Seed default: `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')` — makes the frontend's `=== 'true'` toggle semantics work with default ON.

Why a new table (not `scanned_messages`): that table is OCR-only, one row per message, no per-medicine granularity, and the text-only path never writes to it; the 24h phone-window needs per-escalation timestamps.

### 2. New service: `src/services/waAdminEscalationService.ts`

Exports `maybeEscalate(payload)` — payload = the exact `wa_medicine_match` broadcast object plus `msgId` and raw sender `phone`. Entire body in try/catch; never throws.

1. **Gate**: local `getSetting` reads `wa_auto_share_admin` (treat `!== 'false'` as ON) and `admin_whatsapp`. Toggle off → return. Admin number blank → `console.warn` + return. Self-send guard: customer phone == admin number (digit-normalized) → skip.
2. **Classify**: `localMatches.length > 0` → `found_local` (Type-1 message); else any `catalogResults.mapped/nonMapped` entries (covers offline catalog AND live results, folded in at intentService lines 204–207) → `pharmarack` (staged review + Type-2 message); else nothing.
3. **Dedup** before sending:
   ```sql
   SELECT 1 FROM wa_admin_escalations
   WHERE status != 'failed' AND medicine_key = ?
     AND ( (msg_id = ? AND msg_id != '')                                        -- OCR+text double-fire, manual rescan
        OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )  -- repeat sends, same customer
   LIMIT 1
   ```
   Row exists → skip silently. Otherwise INSERT `status='pending'` FIRST (reserves against OCR/text race), then staged review (pharmarack outcome), then send, then UPDATE `status='sent'` (`'failed'` on error — unblocks retry).
4. **Staged review insert** (pharmarack outcome): first check `SELECT id FROM staged_medicine_reviews WHERE lower(medicine_name)=? AND status='pending' AND source='whatsapp'` — reuse existing id instead of duplicating. Else:
   ```sql
   INSERT INTO staged_medicine_reviews (job_id, medicine_name, status, source, search_query, original_row_data)
   VALUES (NULL, <best match name>, 'pending', 'whatsapp', <searched name>, <json>)
   ```
   `original_row_data` JSON: `{source:'whatsapp', msgId, customerPhone, customerName, messageBody, mrp, topMatches:[{name,mrp,packaging,manufacturer,distributor,isMapped}...]}` — top-level `mrp` from best match so the approve endpoint's `row.mrp` read (catalog.ts ~365/388) flows MRP into `medicines`. Insert failure → log, still send message without the "Review #" line.
5. **Send** via `sendMessage` from whatsappClient. Defensive product formatter: `p.name || p.productName`, `p.distributor || p.storeName`, `p.isMapped ?? p.mapped`, `p.mrp ?? p.MRP ?? '-'`.

**Message templates** (same emoji set as `handleShare`):

Type 1 — found locally:
```
🔔 *Prescription Medicine Extracted*

👤 *Customer*: {name || 'New Customer'} ({phone})
📝 *Original Text*: "{messageBody}"{' (from image OCR)' if source includes ocr}

💊 *Extracted Medicine*: {medicineName}
📦 *Quantity*: {quantity} {unit}
⭐ *Match Confidence*: {round(confidence)}%
✅ *In Stock (local)*: {localMatches.slice(0,3).join(', ')}
```

Type 2 — not local, PharmaRack matches (top 5, mapped first):
```
⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*

👤 *Customer*: {name} ({phone})
📝 *Original Text*: "{messageBody}"{ocr note}
🔍 *Searched*: {medicineName}

1. {name} | {packaging} | MRP ₹{mrp} | {distributor} | {Mapped/Non-mapped}
...
📋 Added to approval queue (Review #{reviewId}). Approve in the app to add to inventory.
```

### 3. Hook into `src/services/whatsappIntentService.ts` (minimal edits)

- Add `msgId?: string; phone?: string` to `searchAndBroadcast` opts; after the line-222 broadcast, add fire-and-forget:
  `waAdminEscalationService.maybeEscalate({ ...broadcastPayload, msgId: opts.msgId, phone: opts.phone }).catch(err => console.error('[Intent Service] Admin escalation failed:', err));`
- Thread through: `handleInbound` step 6 (line 138) adds `msgId, phone`; `handleOcrComplete` (line 246) destructures `msgId` from `data` and passes `msgId, phone` into `searchAndBroadcast`.
- Do NOT hook the repeat-request branch (line 104) — known-customer reorder, not an extraction event.

### 4. Backend visibility: `src/routes/catalog.ts`

New `GET /api/catalog/reviews/pending?source=whatsapp` next to the job-scoped endpoint (line 296): `SELECT * FROM staged_medicine_reviews WHERE status='pending' AND source='whatsapp' ORDER BY id DESC`, JSON-parsing the three JSON columns like lines 305–310. Approve/reject: **reuse existing endpoints unchanged.**

### 5. Frontend

- **Learning page** ([Learning/index.tsx](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/frontend/src/pages/Learning/index.tsx) ~1877, "Alert Broadcast Contacts" card): toggle "Auto-share medicine matches to Admin WhatsApp" wired to `handleToggleSetting('wa_auto_share_admin')`, `checked={settingsData.wa_auto_share_admin === 'true'}` — same peer-toggle markup as lines 1860–1869.
- **MessageListener page**: compact "Pending Approvals" card listing pending WhatsApp reviews (matches from `original_row_data.topMatches`) with Approve/Reject buttons calling existing `api.approveCatalogReview(id, {name, packaging, manufacturer} prefilled from top match)` / `api.rejectCatalogReview(id)` (already in [api.ts](e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/frontend/src/services/api.ts); used by CatalogUpload ~159/175). Refresh on the existing `catalog_review_updated` SSE event (broadcast by both endpoints, catalog.ts 472/498). Add `api.getPendingWhatsappReviews()`.

### 6. Error handling (inbound handling must never crash)

- `maybeEscalate` fully try/catch-wrapped + caller `.catch()`; `handleInbound` already wrapped (lines 66/148).
- Client not ready / Business API failure → `sendMessage` throws → row marked `'failed'` (retryable). Web-path per-recipient failures are swallowed inside `sendMessage` (accepted limitation, note in comment).

## Implementation order

1. `src/database.ts` — table, `source` column migration, settings seed.
2. `src/services/waAdminEscalationService.ts` — new service.
3. `src/services/whatsappIntentService.ts` — thread msgId/phone (3 spots) + one hook call.
4. `src/routes/catalog.ts` — pending-reviews endpoint.
5. Frontend — Learning toggle; MessageListener Pending Approvals card; api.ts method.

## Verification

**Automated** (jest, `npm test`; new `tests/waAdminEscalation.test.ts` following `tests/whatsappRouting.test.ts` style, mocking `whatsappClient.sendMessage`):
(a) found_local sends Type-1 exactly once; (b) same msgId+name second call sends nothing; (c) same phone+name within 24h, different msgId → nothing; (d) pharmarack outcome inserts one `source='whatsapp'`, `job_id NULL` review; second call reuses it; (e) toggle `'false'` → no send/rows; (f) admin number empty → no throw; (g) sendMessage throws → row `'failed'`, caller resolves. Extend `tests/catalogPipeline.test.ts`: approve a null-job_id whatsapp review → asserts `medicines` insert.

**Manual E2E**:
1. Set `admin_whatsapp` in Learning settings, toggle ON.
2. WhatsApp "need dolo 650" (exists locally) from another phone → admin receives Type-1.
3. Send an unknown-but-PharmaRack-listed name → admin receives Type-2; review appears in Pending Approvals; approve → row in `medicines`.
4. Re-trigger same message via `POST /api/messaging/chats/:chatId/messages/:messageId/scan` → NO duplicate admin message.
5. Send a medicine-strip image → OCR path; if text parses same name, confirm single admin message.
6. Toggle OFF → no auto message; manual Share still works.
7. WhatsApp client stopped → no crash; `status='failed'` row present.
