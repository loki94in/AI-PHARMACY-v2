# Distributor Dispatch Reminders — Sent/Not-Sent Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sent Today / Not Sent" count pair to the Dispatch page's Reminders panel header, so the user can see at a glance how many of today's distributor WhatsApp reminders have actually gone out.

**Architecture:** Pure frontend change. `distributorReminders` state (already fetched from `GET /api/dispatch/distributor-reminders/today`, which already includes `has_order_today` and `latest_notif_status` per row) is filtered/counted in two `.filter(...).length` expressions and rendered as two badges next to the existing "Today's Orders Only / All Distributors" toggle pills. No backend or API changes.

**Tech Stack:** React + TypeScript (Vite), existing Tailwind utility classes matching the surrounding pills.

## Global Constraints

- No backend changes — `distributor_dispatch_reminders` API and worker logic are already correct (per `docs/superpowers/specs/2026-08-11-dispatch-reminder-sent-count-design.md`).
- Scope the counts to `has_order_today === 1` rows only (today's actual orders), matching the "Today's Orders Only" pill's own filter, not the full "All Distributors" directory.
- "Sent" = `latest_notif_status === 'sent' || latest_notif_status === 'delivered'`. "Not Sent" = every other today's-order row (pending, failed, or no notification yet). The two counts must always sum to the "Today's Orders Only" count.
- This project has no frontend test runner (`frontend/package.json` has no test script, no `*.test.*` files exist) — verification is via `tsc` type-check plus a live dev-server check against the running API, not an automated component test.

---

### Task 1: Add sent/not-sent count badges to the Reminders panel header

**Files:**
- Modify: `frontend/src/pages/Dispatch/index.tsx:789-820` (the header `<div className="flex items-center gap-2 flex-wrap">` block containing the "Today's Orders Only / All Distributors" toggle pills)

**Interfaces:**
- Consumes: existing component state `distributorReminders: any[]` (already in scope in this file, populated by `fetchDistributorReminders` from `api.getTodayDistributorReminders()`). Each row has `has_order_today: 0 | 1` and `latest_notif_status: string | null` (`'sent' | 'delivered' | 'failed' | 'Pending' | null`), as returned by `syncTodayActiveDistributors()` in `src/services/distributorDispatchReminderWorker.ts`.
- Produces: nothing consumed elsewhere — this is a leaf UI addition.

- [ ] **Step 1: Add the two derived counts and badge markup**

In `frontend/src/pages/Dispatch/index.tsx`, find the closing `</div>` of the toggle-pill block (currently ends at line 820, right after the "📋 All Distributors" button's closing `</button>`), and insert a new sibling `<div>` immediately after it (still inside the parent `flex items-center gap-2 flex-wrap` header container, before the search input at line 822):

```tsx
              {/* Sent / Not Sent Count Badges (scoped to today's orders) */}
              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  ✅ Sent Today
                  <span className="font-mono px-1.5 py-0.2 rounded-full bg-emerald-500/30 text-emerald-300 font-extrabold">
                    {distributorReminders.filter(r =>
                      r.has_order_today === 1 &&
                      (r.latest_notif_status === 'sent' || r.latest_notif_status === 'delivered')
                    ).length}
                  </span>
                </span>
                <span className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                  🕓 Not Sent
                  <span className="font-mono px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-extrabold">
                    {distributorReminders.filter(r =>
                      r.has_order_today === 1 &&
                      r.latest_notif_status !== 'sent' && r.latest_notif_status !== 'delivered'
                    ).length}
                  </span>
                </span>
              </div>
```

This follows the exact same `.filter(...).length` pattern already used for the "Today's Orders Only" pill count a few lines above (`distributorReminders.filter(r => r.has_order_today === 1).length`), so the "Sent" + "Not Sent" numbers will always sum to that pill's count.

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no new errors introduced by this change (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Verify live against the running dev server**

The backend dev server should already be running on port 5174 and the Vite dev server on port 5173 (started earlier this session). If not, start them:

Run: `npm run dev:server` (background) and `npm run dev:client` (background)

Then confirm the API still returns the fields this UI depends on:

Run:
```bash
node -e "fetch('http://127.0.0.1:5174/api/dispatch/distributor-reminders/today').then(r=>r.json()).then(d=>{const t=d.reminders.filter(r=>r.has_order_today===1);const sent=t.filter(r=>r.latest_notif_status==='sent'||r.latest_notif_status==='delivered').length;console.log('today:',t.length,'sent:',sent,'not sent:',t.length-sent)})"
```
Expected: `today: N sent: X not sent: (N-X)` — confirms the counts the new badges will render, before checking visually.

Open `http://127.0.0.1:5173` in a browser, navigate to the Dispatch page (Reminders tab is the default), and confirm the "✅ Sent Today" and "🕓 Not Sent" badges appear next to the existing toggle pills with numbers matching the API check above. Click "Send Reminder Now" on one "Not Sent" row and confirm the counts shift by one after the list refreshes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Dispatch/index.tsx
git commit -m "$(cat <<'EOF'
feat: show sent/not-sent count for today's distributor reminders

Adds two header badges to the Dispatch Reminders panel so staff can
see at a glance how many of today's WhatsApp dispatch reminders have
gone out vs still need sending, without reading every row.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** The spec's single concrete requirement (sent/not-sent count badges, scoped to today's orders, no backend change) is fully covered by Task 1.
- **No placeholders:** All code is concrete and copy-pasteable; no TBD/TODO.
- **Type consistency:** Uses the same `distributorReminders`, `has_order_today`, `latest_notif_status` names already used elsewhere in this file (verified against `frontend/src/pages/Dispatch/index.tsx:803`, `:910`, `:916-927`) — no new types introduced.
