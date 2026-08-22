// ─── API Barrel ─────────────────────────────────────────────────────────────
// Single import surface (`lib/api`). Domain modules live in lib/api/*.
// Keep this file a pure re-export barrel — no logic here.

export * from './api/client';
export * from './api/inventory';
export * from './api/sales';
export * from './api/purchases';
export * from './api/gmail';
export * from './api/orders';
export * from './api/refills';
export * from './api/scanBill';
export * from './api/admin';
export * from './api/notifications';
export * from './api/sync';
export * from './api/misc';
