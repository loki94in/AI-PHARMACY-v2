export type FetchMode = 'auto' | 'manual' | 'off';

export interface FetchControlEntry {
  key: string;
  label: string;
  page: string;
  callSite?: string;
  defaultMode: FetchMode;
  external: boolean;
}

export const DATA_FETCH_REGISTRY: FetchControlEntry[] = [
  // POS
  {
    key: 'pos.specialOrders',
    label: 'POS Special Orders',
    page: 'POS',
    callSite: 'POS/index.tsx:325',
    defaultMode: 'manual',
    external: false
  },
  {
    key: 'pos.combinations',
    label: 'POS Combos & Quantity Batch',
    page: 'POS',
    callSite: 'POS/index.tsx:330',
    defaultMode: 'manual',
    external: false
  },
  {
    key: 'pos.doctors',
    label: 'POS Doctors List',
    page: 'POS',
    callSite: 'POS/index.tsx:604',
    defaultMode: 'manual',
    external: false
  },
  // Inventory
  {
    key: 'inv.list',
    label: 'Inventory Paged List',
    page: 'Inventory',
    callSite: 'Inventory/index.tsx:202',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'inv.specialOrders',
    label: 'Inventory Special Orders',
    page: 'Inventory',
    callSite: 'Inventory/index.tsx:164',
    defaultMode: 'manual',
    external: false
  },
  // Purchases
  {
    key: 'purch.distributors',
    label: 'Purchases Distributors',
    page: 'Purchases',
    callSite: 'Purchases/index.tsx:232',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'purch.history',
    label: 'Purchases History',
    page: 'Purchases',
    callSite: 'Purchases/index.tsx:237',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'purch.pendingReturns',
    label: 'Purchases Pending Returns',
    page: 'Purchases',
    callSite: 'Purchases/index.tsx:244',
    defaultMode: 'auto',
    external: false
  },
  // CRM
  {
    key: 'crm.patients',
    label: 'CRM Patients',
    page: 'CRM',
    callSite: 'CRM/index.tsx:166',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'crm.waStatusPoll',
    label: 'CRM WhatsApp Status 5s Poll',
    page: 'CRM',
    callSite: 'CRM/index.tsx:440',
    defaultMode: 'manual',
    external: false
  },
  {
    key: 'crm.waSse',
    label: 'CRM SSE Stream',
    page: 'CRM',
    callSite: 'CRM/index.tsx:461',
    defaultMode: 'off',
    external: false
  },
  // Dashboard
  {
    key: 'dash.stats',
    label: 'Dashboard Stats',
    page: 'Dashboard',
    callSite: 'Dashboard/index.tsx:11',
    defaultMode: 'auto',
    external: false
  },
  // Pharmarack
  {
    key: 'pharmarack.cart',
    label: 'Live Pharmarack Cart',
    page: 'Pharmarack',
    callSite: 'PharmarackCart/index.tsx:392',
    defaultMode: 'manual',
    external: true
  },
  {
    key: 'pharmarack.pendingOrders',
    label: 'Pharmarack Pending Orders',
    page: 'Pharmarack',
    callSite: 'PharmarackCart/index.tsx',
    defaultMode: 'manual',
    external: true
  },
  {
    key: 'pharmarack.refills',
    label: 'Pharmarack Refills',
    page: 'Pharmarack',
    callSite: 'PharmarackCart/index.tsx',
    defaultMode: 'manual',
    external: true
  },
  {
    key: 'pharmarack.priceHistory',
    label: 'Pharmarack Price History',
    page: 'Pharmarack',
    callSite: 'PharmarackCart/index.tsx',
    defaultMode: 'manual',
    external: true
  },
  // Global / Layout
  {
    key: 'layout.enrichmentPoll',
    label: 'Global Enrichment 5s Poll',
    page: 'Layout',
    callSite: 'Layout.tsx:702',
    defaultMode: 'off',
    external: false
  },
  {
    key: 'layout.hoverPrefetch',
    label: 'Nav Hover Prefetch',
    page: 'Layout',
    callSite: 'Layout.tsx:238',
    defaultMode: 'off',
    external: false
  },
  // Mail
  {
    key: 'mail.inboxRefresh',
    label: 'Mail Inbox Refresh',
    page: 'Mail',
    callSite: 'Mail/index.tsx:286',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'mail.imapSync',
    label: 'Mail IMAP 2-min Sync',
    page: 'Mail',
    callSite: 'Mail/index.tsx:289',
    defaultMode: 'off',
    external: true
  },
  // Composition
  {
    key: 'composition.statusPoll',
    label: 'Enrichment Status 3s Poll',
    page: 'Composition',
    callSite: 'CompositionQueue/index.tsx:237',
    defaultMode: 'auto',
    external: false
  },
  // Learning
  {
    key: 'learning.qrPoll',
    label: 'Learning QR 5s Poll',
    page: 'Learning',
    callSite: 'Learning/index.tsx:299',
    defaultMode: 'auto',
    external: false
  },
  // Settings
  {
    key: 'settings.backupList',
    label: 'Settings Backup List',
    page: 'Settings',
    callSite: 'Settings/index.tsx:564',
    defaultMode: 'manual',
    external: false
  },
  {
    key: 'settings.backupSchedule',
    label: 'Settings Backup Schedule',
    page: 'Settings',
    callSite: 'Settings/index.tsx:571',
    defaultMode: 'manual',
    external: false
  },
  // Backend Background Jobs
  {
    key: 'bg.pharmarackTokenRefresh',
    label: 'Pharmarack Token Refresh',
    page: 'Backend',
    callSite: 'tokenRefreshScheduler.ts:108',
    defaultMode: 'auto',
    external: true
  },
  {
    key: 'bg.nightlyBackup',
    label: 'Nightly Backup',
    page: 'Backend',
    callSite: 'server.ts:455',
    defaultMode: 'off',
    external: false
  },
  {
    key: 'bg.dailyScans',
    label: 'Daily Stock/Expiry Scans',
    page: 'Backend',
    callSite: 'server.ts:411,443',
    defaultMode: 'off',
    external: false
  },
  {
    key: 'bg.catalogSync',
    label: '3AM Catalog Sync',
    page: 'Backend',
    callSite: 'server.ts:468',
    defaultMode: 'off',
    external: false
  },
  {
    key: 'bg.emailImapPoll',
    label: 'Email IMAP 5-min Poll',
    page: 'Backend',
    callSite: 'emailService.ts:1115',
    defaultMode: 'off',
    external: true
  },
  {
    key: 'bg.messagingQueues',
    label: 'Messaging 30s Queues',
    page: 'Backend',
    callSite: 'messagingQueue.ts/whatsappQueue.ts',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'bg.inventoryCache',
    label: '10-min Inventory Cache Rebuild',
    page: 'Backend',
    callSite: 'inventoryCache.ts:32',
    defaultMode: 'auto',
    external: false
  },
  {
    key: 'bg.catalogWorkerLoop',
    label: 'Catalog Worker Loop',
    page: 'Backend',
    callSite: 'catalogWorker.ts:1032',
    defaultMode: 'auto',
    external: false
  }
];

export const DEFAULT_FETCH_MODES: Record<string, FetchMode> = DATA_FETCH_REGISTRY.reduce((acc, entry) => {
  acc[entry.key] = entry.defaultMode;
  return acc;
}, {} as Record<string, FetchMode>);

export const getRegistryByPage = (): Record<string, FetchControlEntry[]> => {
  return DATA_FETCH_REGISTRY.reduce((acc, entry) => {
    if (!acc[entry.page]) {
      acc[entry.page] = [];
    }
    acc[entry.page].push(entry);
    return acc;
  }, {} as Record<string, FetchControlEntry[]>);
};

export const isExternal = (key: string): boolean => {
  const entry = DATA_FETCH_REGISTRY.find(e => e.key === key);
  return entry ? entry.external : false;
};
