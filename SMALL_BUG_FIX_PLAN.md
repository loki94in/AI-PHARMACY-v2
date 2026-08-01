# AI Pharmacy v2 — Complete Small Bug Fix Plan (PRD)

> **Document type:** Product / engineering fix plan (PRD)  
> **Location:** repository root  
> **Last updated:** 2026-08-01  
> **Status:** ✅ **Implemented on `main`** — `5bdaf23` (PRs #4–#8)  
> **Audience:** Developers, AI agents, and maintainers

---

## Implementation summary

| Phase | PR | Commit | Status |
|-------|-----|--------|--------|
| Settings sync (pre-plan) | #4 | `9236d72` | ✅ Done |
| Phase 1 — P0 data integrity | #5 | `4b8cc68` | ✅ Done |
| Phase 2 — P1 daily workflow | #6 | `6fd1670` | ✅ Done |
| Phase 3 — P2 UI mixups | #7 | `be9c21f` | ✅ Done |
| Phase 4 — P3 cleanup | #8 | `d20bc3a` | ✅ Done (partial P3-03) |

**22 planned items:** 20 ✅ fixed · 1 ⏸️ deferred by user choice · 1 🔶 partial

---

## 1. Purpose

This document records **all known small-to-medium bugs, UI mixups, dead code, and structural gaps** identified in AI Pharmacy v2, with:

1. **What the user saw** (the issue)
2. **Root cause** (why it happened in code)
3. **How it was fixed** (or why it remains open)
4. **Priority** (P0–P3)
5. **What not to touch**

Use this as the historical record and guardrail doc — not an active backlog (except items marked **Open** below).

---

## 2. Fixed on `main` (do not re-break)

| Area | Fix | Reference |
|------|-----|-----------|
| Settings / delivery boy numbers vanishing in UI | `settingsSync.ts`, `useSettingsQuery`, Pharmarack Cart load order | PR #4, `9236d72` |
| Sold stock in POS / reports | `inventory_master.is_active`, migration backfill | PR #3, `f7b3b48` |
| Windows data under Program Files | `%LOCALAPPDATA%\AI Pharmacy OS` | `src/config/index.ts`, `installer.iss` |
| Migration data loss | Staging review, stock rebuild, cutover, streaming CSV | PR #1 |
| POS slow add-to-cart | Optimistic add from compact cache | PR #3 |
| Investigation purchase GST/discount loss | Tax fields loaded, shown, persisted on correction | PR #5, `4b8cc68` |
| Settings vs Learning config clash | Settings save excludes Learning-owned integration keys | PR #5, `4b8cc68` |
| Packaged app no browser auto-open | `isPackagedApp()` + `AUTO_OPEN_BROWSER` in `.env.example` | PR #6, `6fd1670` |
| Learning fake stats (842 OCR…) | Live stats from `GET /api/learning/stats` | PR #6 |
| WhatsApp/Telegram false ACTIVE badge | Badges use real connection state | PR #6 |
| Orders / Purchases 100-row cap | Client slice removed; pagination added | PR #6 |
| Inventory export blank Packs column | Export key → `stock_quantity` | PR #7 |
| Purchase History search / totals | Product name + ID search; server aggregates for cards | PR #7 |
| Pharmarack Cart phone / badge / countdown | Unified `resolveDistributorPhone`; dead countdown removed | PR #7 |
| Migration “(5 rows)” header | Real `totalRows` from staging API | PR #7 |
| `/dispatch` standalone route | Mounted at `/dispatch`; sidebar link added | PR #7 |
| Returns min/max amount filter | Input controls added | PR #8 |
| Purchases unreachable edit modal | Dead modal removed | PR #8 |
| Dead page bundle bloat | `AutomationCenter`, `Doctors`, `Refills` removed from imports | PR #8 |
| Stale `process.pkg` checks | Replaced with `isPackagedApp()` | PR #8 |
| Notification stubs | Documented / cleaned in `notificationService.ts` | PR #8 |
| Shortage reminders | `special_orders` table only | Pre-existing |
| Credit notes API | Mounted at `/api/credit-notes` | Pre-existing |

---

## 3. What NOT to touch (mandatory guardrails)

### 3.1 Product / business rules (user decisions)

| Rule | Reason |
|------|--------|
| **Do NOT deduplicate medicine names** | User explicitly accepts duplicate medicine names |
| **Do NOT add simulated / mock Pharmarack cart UI** | Live data only per `AGENTS.md` |
| **Do NOT reintroduce delivery boy fields in Settings** | `delivery_boys` table via `/dispatch` only |
| **Do NOT read/write delivery boys from `app_settings` keys** | Legacy keys cause split-brain |

### 3.2 Architecture contracts (do not weaken)

| Contract | Location |
|----------|----------|
| Page feature ownership | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` |
| SPA module-level cache + silent background refresh | `AGENTS.md` |
| `dataFetchControl` + idle gating | `AGENTS.md` |
| WhatsApp delivery boy resolution from `delivery_boys` | `AGENTS.md` |
| Semantic Tailwind colors (`bg-bg`, `text-text`, etc.) | `frontend/AGENTS.md` |
| `settingsSync.ts` cross-page broadcast after saves | `frontend/src/utils/settingsSync.ts` |
| Run `node scripts/quick-update.mjs` after file changes | Root `AGENTS.md` |

### 3.3 Code areas to leave alone

| Area | Why |
|------|-----|
| `inventory_master.is_active` logic | Reports/POS depend on it |
| Migration streaming worker | Do not revert to in-memory loader |
| Windows `LOCALAPPDATA` data path | Another move causes “data disappeared” |
| `special_orders` as single shortage table | No parallel `pending_shortage_requests` writes |
| Settings save partial-payload rule | Settings must NOT resend Learning-owned keys |

### 3.4 Settings vs Learning ownership (post-fix contract)

| Page | Owns |
|------|------|
| **Settings** | Store metadata: name, address, phone, GSTIN, license, tax rate, invoice prefix, data fetch control, owner WhatsApp for alerts |
| **Learning** | Gmail, WhatsApp Web/Business, Telegram, Pharmarack, OCR, backups, automation |
| **Dispatch** (`/dispatch`) | Delivery boys (`delivery_boys` table) |

---

## 4. Bug fix catalog (with status)

Priority: **P0** = data loss · **P1** = daily workflow · **P2** = UX · **P3** = cleanup

---

### ✅ P0-01 — Investigation purchase bill correction dropped GST and discount

| | |
|---|---|
| **Issue** | Purchase bill correction lost GST %, cash discount, and understated `total_amount`. |
| **Cause** | Frontend omitted tax fields; backend reinserted items without `cgst_per`/`sgst_per`/`cd_value`. |
| **Fix applied** | Load/persist tax fields; recompute total with taxable formula; show GST lines in UI. |
| **PR** | #5 (`4b8cc68`) |
| **Files** | `frontend/src/pages/Investigation/index.tsx`, `src/routes/investigation.ts` |

---

### ✅ P0-02 — Settings vs Learning duplicate config editors

| | |
|---|---|
| **Issue** | Saving Settings overwrote WhatsApp/Gmail/Pharmarack configured in Learning. |
| **Cause** | Full-payload `POST /api/settings/save` upserted stale integration keys from Settings state. |
| **Fix applied** | Settings save payload excludes Learning-owned keys; Pharmarack logout uses `/pharmarack/logout` only. |
| **PR** | #5 (`4b8cc68`) |
| **Follow-up (optional)** | Remove or hide WhatsApp/Gmail UI still visible on Settings page (cosmetic only — no data loss). |

---

### ✅ P1-01 — Packaged app does not auto-open browser

| | |
|---|---|
| **Issue** | Double-clicking `.exe` started server but no browser opened. |
| **Cause** | `process.pkg` check never true on Node SEA builds. |
| **Fix applied** | `isPackagedApp()` in `server.ts`; `AUTO_OPEN_BROWSER` documented in `.env.example`. |
| **PR** | #6 (`6fd1670`) |

---

### ✅ P1-02 — Learning hardcoded fake statistics

| | |
|---|---|
| **Issue** | “842 Active OCR Corrections” never changed. |
| **Cause** | Literal JSX strings. |
| **Fix applied** | `GET /api/learning/stats` + live-bound UI. |
| **PR** | #6 |

---

### ✅ P1-03 — Learning false ACTIVE badges

| | |
|---|---|
| **Issue** | WhatsApp/Telegram showed ACTIVE before real connection. |
| **Cause** | Badge used `*_enabled` only. |
| **Fix applied** | Badges branch on `waStatus.isReady` / bot connection state. |
| **PR** | #6 |

---

### ✅ P1-04 — Special Orders 100-row cap

| | |
|---|---|
| **Issue** | Orders beyond 100 invisible with no warning. |
| **Cause** | `data.slice(0, 100)` on client. |
| **Fix applied** | Slice removed; pagination added. |
| **PR** | #6 |

---

### ✅ P1-05 — Purchases list 100-row cap

| | |
|---|---|
| **Issue** | Older purchase invoices hidden. |
| **Cause** | Client-side slice. |
| **Fix applied** | Slice removed; pagination added. |
| **PR** | #6 |

---

### ✅ P2-01 — Inventory export blank Packs column

| | |
|---|---|
| **Issue** | CSV/PDF Packs column empty while screen showed stock. |
| **Cause** | Export key `quantity` vs field `stock_quantity`. |
| **Fix applied** | Export uses `stock_quantity`. |
| **PR** | #7 (`be9c21f`) |

---

### ✅ P2-02 — Purchase History search mismatch

| | |
|---|---|
| **Issue** | Product name / purchase ID search returned nothing. |
| **Cause** | Backend only matched invoice_no and distributor name. |
| **Fix applied** | Extended SQL for product name and purchase ID. |
| **PR** | #7 |

---

### ✅ P2-03 — Purchase History summary undercount

| | |
|---|---|
| **Issue** | Summary cards smaller than scroll-bar totals. |
| **Cause** | Cards used local batch only. |
| **Fix applied** | Cards driven from server aggregates. |
| **PR** | #7 |

---

### ✅ P2-04 — Pharmarack Cart conflicting missing-phone logic

| | |
|---|---|
| **Issue** | Same distributor OK in one tab, flagged in another. |
| **Cause** | Two different phone-resolution paths. |
| **Fix applied** | Unified `resolveDistributorPhone()` helper. |
| **PR** | #7 |

---

### ✅ P2-05 — Pharmarack Cart batch countdown never ran

| | |
|---|---|
| **Issue** | “Next send in Ns…” never appeared. |
| **Cause** | `batchCountdownSec` never incremented. |
| **Fix applied** | Dead countdown UI removed (cleaner than fake timer). |
| **PR** | #7 |

---

### ✅ P2-06 — Pharmarack Cart badge counts ignore filter

| | |
|---|---|
| **Issue** | Tab badges didn’t match visible rows after “Show Added” filter. |
| **Cause** | Badge used unfiltered count. |
| **Fix applied** | Badges use same filtered list as render. |
| **PR** | #7 |

---

### ✅ P2-07 — Migration header always “(5 rows)”

| | |
|---|---|
| **Issue** | Column-mapping header showed 5 rows for every file. |
| **Cause** | Passed sample length instead of total row count. |
| **Fix applied** | `totalRows={fileEntry.totalRows \|\| fileEntry.samples.length}`. |
| **PR** | #7 |

---

### ✅ P2-08 — `/dispatch` route discoverability

| | |
|---|---|
| **Issue** | `/dispatch` redirected to Learning tab only. |
| **Cause** | Route was `<Navigate>` not direct mount. |
| **Fix applied** | `/dispatch` mounts `DispatchPage`; sidebar link added. |
| **PR** | #7 |

---

### ✅ P3-01 — Returns Min/Max amount filter no UI

| | |
|---|---|
| **Issue** | Filter logic existed but no inputs. |
| **Fix applied** | Min/max amount inputs added next to date filters. |
| **PR** | #8 (`d20bc3a`) |

---

### ✅ P3-02 — Purchases unreachable edit modal

| | |
|---|---|
| **Issue** | Edit modal never opened. |
| **Fix applied** | Dead modal and state removed. |
| **PR** | #8 |

---

### 🔶 P3-03 — Superseded page files bundled and prefetched

| | |
|---|---|
| **Issue** | Dead pages increased bundle size. |
| **Fix applied** | Removed `AutomationCenter`, `Doctors`, `Refills` from `pageImports.ts`; deleted those files. |
| **PR** | #8 |
| **Still on disk (not bundled)** | `Expiry`, `CustomerReturn`, `CustomerReturnHistory`, `CatalogUpload`, `NonMappedDistributors` — routes redirect to parent tabs; safe to delete in a future housekeeping PR. |

---

### ✅ P3-04 — Stale `process.pkg` checks

| | |
|---|---|
| **Issue** | Safety nets gated on dead `process.pkg` flag. |
| **Fix applied** | `isPackagedApp()` in `connection.ts` and `processGuardian.ts`. |
| **PR** | #8 |

---

### ✅ P3-05 — Notification service stubs

| | |
|---|---|
| **Issue** | Some paths returned “not implemented”. |
| **Fix applied** | Stubs cleaned / documented in `notificationService.ts`. |
| **PR** | #8 |

---

### ✅ P3-06 — Email attachment processing

| | |
|---|---|
| **Issue** | Attachment auto-processing incomplete. |
| **Fix applied** | `processAttachments` / `processMedicineListAttachment` wired in PR #8 pass. |
| **PR** | #8 |

---

### ⏸️ P3-07 — Reports accuracy with duplicate medicine IDs

| | |
|---|---|
| **Issue** | Non-moving / expired reports may be imperfect when same name has multiple `medicine_id` rows. |
| **Cause** | User declined medicine name deduplication by design. |
| **Status** | **Deferred** — document in Reports UI if needed; optional “group by name” mode. **Do not auto-merge IDs.** |

---

### ✅ P3-08 — Learning duplicate delivery-boy form

| | |
|---|---|
| **Issue** | Delivery boy inputs duplicated across Learning tabs. |
| **Fix applied** | Legacy `delivery_boy_whatsapp` fields removed; Dispatch tab embeds `<Dispatch />` only. |
| **PR** | #8 |

---

## 5. Implementation phases (completed)

| Phase | Items | PR | Status |
|-------|-------|-----|--------|
| 1 — P0 | P0-01, P0-02 | #5 | ✅ |
| 2 — P1 | P1-01–P1-05 | #6 | ✅ |
| 3 — P2 | P2-01–P2-08 | #7 | ✅ |
| 4 — P3 | P3-01–P3-08 | #8 | ✅ (P3-03 partial, P3-07 deferred) |

---

## 6. Testing checklist (verified on `main`)

| Test | Pass criteria | Status |
|------|---------------|--------|
| Settings save | Pharmacy name on Pharmarack Cart within 1s | ✅ |
| Dispatch save | Delivery boy in WhatsApp template without reload | ✅ |
| Investigation purchase edit | GST/CD preserved on save | ✅ |
| Orders >100 rows | Paginated / full list | ✅ |
| Installed exe launch | Browser opens automatically | ✅ |
| Inventory export | Packs = `stock_quantity` | ✅ |
| Purchase History search | Product name returns results | ✅ |
| Migration upload | Real row count in header | ✅ |
| Settings + Learning | Settings save does not clobber Learning integrations | ✅ |

---

## 7. Acceptance criteria (definition of done)

- [x] All P0 items fixed and tested
- [x] All P1 items fixed
- [x] All P2 items fixed
- [x] P3 items fixed or explicitly deferred (P3-07)
- [x] No regression on `settingsSync`, `is_active` inventory, or LOCALAPPDATA path
- [ ] Optional: delete remaining dead page files on disk (P3-03 remainder)
- [ ] Optional: hide Settings integration UI remnants (P0-02 cosmetic follow-up)
- [ ] Optional: Reports UI note for duplicate-medicine limitation (P3-07)

---

## 8. Optional follow-up backlog (not in original plan scope)

| Item | Notes |
|------|-------|
| Delete orphan page files | `Expiry`, `CustomerReturn`, `CustomerReturnHistory`, `CatalogUpload`, `NonMappedDistributors` |
| Settings UI cleanup | Remove read-only WhatsApp toggles from Settings; point users to Learning |
| Reports duplicate-medicine note | User-facing disclaimer on non-moving / expiry reports |
| Delete `src/routes/v1/sales.ts` | Inert dead code; dedicated cleanup PR only |

---

## 9. Related audit documents

| Document | Notes |
|----------|-------|
| `docs/STORAGE_PATH_AND_UI_GAPS_AUDIT.md` | Historical; most storage/UI items now fixed |
| `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` | Page ownership reference |
| `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | Agent contract |
| `AUDIT-STRUCTURE-DRIFT-REPORT.md` | Settings/Learning drift — P0-02 addressed |
| `AUDIT-CRASH-RISK-REPORT.md` | Separate scope |

---

## 10. Changelog

| Date | Change |
|------|--------|
| 2026-08-01 | Initial plan created (`c2e561a`) |
| 2026-08-01 | Marked implemented on `main` at `5bdaf23`; all PRs #5–#8 recorded; acceptance criteria checked |

---

*Plan implementation complete. Use Section 8 for optional housekeeping only.*
