# Distributor Dispatch Reminders — Sent/Not-Sent Count

## Context

The Dispatch page's "Reminders" tab already implements the distributor dispatch
reminder workflow end to end:

- `syncTodayActiveDistributors()` (backend) auto-detects distributors with
  orders today (purchases, special orders, Pharmarack cart) and syncs them
  into `distributor_dispatch_reminders`.
- `GET /api/dispatch/distributor-reminders/today` returns the day's list,
  including `has_order_today` and `latest_notif_status` per distributor.
- The frontend (`frontend/src/pages/Dispatch/index.tsx`) renders this list
  with a "Today's Orders Only" / "All Distributors" toggle, per-row status
  badges (Pharmarack Cart Sent / Today's Order / Message Sent / Failed), a
  manual "Send Reminder Now" button, and delivery-staff/status assignment.
- `checkAndSendAutoReminders()` (backend worker) already auto-sends WhatsApp
  reminders to `auto_remind = 1` distributors in the 12:30 PM–1:00 PM window,
  running on a 5-minute interval checker started at boot.

This was effectively invisible until earlier today: a silent SQL bug made
`syncTodayActiveDistributors()` throw and get swallowed by a catch block,
so the endpoint always returned an empty list. That bug is now fixed
(confirmed live: 177 distributors, 16 with orders today, 3 already sent).

The one gap against the user's ask: there is no at-a-glance count of how
many of today's distributor reminders have actually been sent via WhatsApp
vs. still pending. The header currently only shows total counts ("Today's
Orders Only (16)" / "All Distributors (177)"), not send status.

## Design

Add two small count badges to the Reminders panel header, next to the
existing "Today's Orders Only / All Distributors" toggle pills, scoped to
**today's orders only** (`has_order_today === 1`):

- **✅ Sent Today: X** — count where `latest_notif_status` is `'sent'` or
  `'delivered'`
- **🕓 Not Sent: Y** — the remaining today's-order distributors (status is
  `'Pending'`, `'failed'`, or no notification yet)

X + Y always equals the "Today's Orders Only" count. Both badges recompute
from `distributorReminders` state on every render/refresh — no new API call,
no backend change. This mirrors the existing derived-count pattern already
used for the toggle pills (`distributorReminders.filter(...).length`).

## Non-goals

- No change to send logic, auto-remind window, or sync logic — all already
  correct.
- No per-distributor auto-remind toggle switch in the UI (considered, but
  deferred — out of scope for this pass, backend field is already there
  if picked up later).
