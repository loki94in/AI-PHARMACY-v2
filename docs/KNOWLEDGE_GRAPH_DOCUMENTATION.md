# AI Pharmacy OS — Complete Project Documentation

> **Auto-generated from the project knowledge graph** (`.understand-anything/knowledge-graph.json`). Do not edit by hand — run `node scripts/generate-project-docs.mjs` after `node scripts/quick-update.mjs` to refresh.

## Project Overview

| Attribute | Value |
|---|---|
| **Name** | AI Pharmacy OS |
| **Description** | Unified pharmacy management platform. |
| **Languages** | typescript, javascript, json, markdown, html, css |
| **Frameworks** | Express.js, React, Vite, Tailwind CSS, React Native, Expo |
| **Analyzed At** | 2026-08-23T04:19:17.924Z |
| **Git Commit** | `c4bcd929ec49f52068c93575161ff19930cbeca5` |
| **Graph Nodes (total)** | 589 |
| **Graph Edges (total)** | 367 |
| **Documented Nodes (excl. vendored/caches)** | 589 |
| **Documented Edges (excl. vendored/caches)** | 367 |

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Layers](#architecture-layers)
3. [File Inventory by Layer](#file-inventory-by-layer)
4. [Node Type Breakdown](#node-type-breakdown)
5. [Dependency Graph (imports)](#dependency-graph-imports)
6. [Automation and Background Timers](#automation-and-background-timers)
7. [Configuration & Environment](#configuration-and-environment)

## Architecture Layers

| Layer | Description | Files (doc.) |
|---|---|---|
| **Configuration Layer** `layer:configuration` | Package configs | 163 |
| **Documentation Layer** `layer:documentation` | Docs and specs | 8 |
| **Presentation Layer** `layer:presentation` | Frontend React SPA | 104 |
| **Mobile Layer** `layer:mobile` | React Native Expo app | 64 |
| **Script Layer** `layer:scripts` | CLI tools and scripts | 32 |
| **Infrastructure Layer** `layer:infrastructure` | Middleware and workers | 24 |
| **API Layer** `layer:api` | Express.js route handlers | 42 |
| **Service Layer** `layer:service` | Business logic services | 63 |
| **Testing Layer** `layer:testing` | Test files | 85 |
| **Data Layer** `layer:data` | Database and data files | 4 |

## File Inventory by Layer

All project files (vendored `.venv`/`node_modules`/build caches excluded). Each entry shows the node id, type, role summary, and tags. File names link to their repository path.

### Presentation Layer — `layer:presentation`

<small style="color:#ec4899">104 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `frontend/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` `frontend` |
| 2 | `frontend/eslint.config.js` | `file` | Source file: eslint.config.js | `frontend` |
| 3 | `frontend/index.html` | `file` | Source file: index.html | `frontend` |
| 4 | `frontend/package.json` | `config` | Configuration: package.json | `config` `frontend` |
| 5 | `frontend/postcss.config.js` | `file` | Source file: postcss.config.js | `frontend` |
| 6 | `frontend/public/manifest.json` | `config` | Configuration: manifest.json | `config` `frontend` |
| 7 | `frontend/README.md` | `document` | Documentation: README.md | `documentation` `frontend` |
| 8 | `frontend/src/App.css` | `file` | Source file: App.css | `frontend` |
| 9 | `frontend/src/App.tsx` | `file` | Source file: App.tsx | `frontend` |
| 10 | `frontend/src/components/AICamera.tsx` | `file` | React component | `frontend` |
| 11 | `frontend/src/components/BackupCenterModal.tsx` | `file` | React component | `frontend` |
| 12 | `frontend/src/components/ConnectedDevicesFooterBar.tsx` | `file` | React component | `frontend` |
| 13 | `frontend/src/components/DateRangeFilter.tsx` | `file` | React component | `frontend` |
| 14 | `frontend/src/components/ErrorBoundary.tsx` | `file` | React component | `frontend` |
| 15 | `frontend/src/components/HoverPriceIntelTable.tsx` | `file` | React component | `frontend` |
| 16 | `frontend/src/components/InfiniteScrollStatus.tsx` | `file` | React component | `frontend` |
| 17 | `frontend/src/components/InfiniteTable.tsx` | `file` | React component | `frontend` |
| 18 | `frontend/src/components/Layout.tsx` | `file` | React component | `frontend` |
| 19 | `frontend/src/components/LiveCartAddModal.tsx` | `file` | React component | `frontend` |
| 20 | `frontend/src/components/MobileConnectionModal.tsx` | `file` | React component | `frontend` |
| 21 | `frontend/src/components/PharmarackCartCalendar.tsx` | `file` | React component | `frontend` |
| 22 | `frontend/src/components/PhoneInputWithBadge.tsx` | `file` | React component | `frontend` |
| 23 | `frontend/src/components/POS/BrandBanner.tsx` | `file` | React component | `frontend` |
| 24 | `frontend/src/components/PriceIntelPanel.tsx` | `file` | React component | `frontend` |
| 25 | `frontend/src/components/PurchaseSaveVerificationModal.tsx` | `file` | React component | `frontend` |
| 26 | `frontend/src/components/QuickOrderModal.tsx` | `file` | React component | `frontend` |
| 27 | `frontend/src/components/SaveBillSpecialPriceModal.tsx` | `file` | React component | `frontend` |
| 28 | `frontend/src/components/StagedQueueFloatingWidget.tsx` | `file` | React component | `frontend` |
| 29 | `frontend/src/components/StagedReviewModal.tsx` | `file` | React component | `frontend` |
| 30 | `frontend/src/components/UniversalMedicineEditModal.tsx` | `file` | React component | `frontend` |
| 31 | `frontend/src/components/VirtualRow.tsx` | `file` | React component | `frontend` |
| 32 | `frontend/src/components/WhatsAppQueuePopover.tsx` | `file` | React component | `frontend` |
| 33 | `frontend/src/hooks/useApiQuery.ts` | `file` | Source file: useApiQuery.ts | `frontend` |
| 34 | `frontend/src/hooks/useDeferredEffect.ts` | `file` | Source file: useDeferredEffect.ts | `frontend` |
| 35 | `frontend/src/hooks/useFetchMode.ts` | `file` | Source file: useFetchMode.ts | `frontend` |
| 36 | `frontend/src/hooks/useGlobalSseInvalidation.ts` | `file` | Source file: useGlobalSseInvalidation.ts | `frontend` |
| 37 | `frontend/src/hooks/useInfiniteScroll.ts` | `file` | Source file: useInfiniteScroll.ts | `frontend` |
| 38 | `frontend/src/hooks/useOnClickOutside.ts` | `file` | Source file: useOnClickOutside.ts | `frontend` |
| 39 | `frontend/src/hooks/usePersistedDateRange.ts` | `file` | Source file: usePersistedDateRange.ts | `frontend` |
| 40 | `frontend/src/hooks/usePWAInstall.ts` | `file` | Source file: usePWAInstall.ts | `frontend` |
| 41 | `frontend/src/hooks/useSettingsQuery.ts` | `file` | Source file: useSettingsQuery.ts | `frontend` |
| 42 | `frontend/src/hooks/useVirtualizer.ts` | `file` | Source file: useVirtualizer.ts | `frontend` |
| 43 | `frontend/src/index.css` | `file` | Source file: index.css | `frontend` |
| 44 | `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx` | `file` | Source file: KeepAliveOutlet.tsx | `frontend` |
| 45 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` | `file` | Source file: PageActiveContext.tsx | `frontend` |
| 46 | `frontend/src/lib/keepAlive/PageErrorBoundary.tsx` | `file` | Source file: PageErrorBoundary.tsx | `frontend` |
| 47 | `frontend/src/lib/pageImports.ts` | `file` | Source file: pageImports.ts | `frontend` |
| 48 | `frontend/src/lib/queryClient.ts` | `file` | Source file: queryClient.ts | `frontend` |
| 49 | `frontend/src/main.tsx` | `file` | Source file: main.tsx | `frontend` |
| 50 | `frontend/src/pages/AuditCenter/index.tsx` | `file` | React page component | `frontend` |
| 51 | `frontend/src/pages/CatalogUpload/index.tsx` | `file` | React page component | `frontend` |
| 52 | `frontend/src/pages/Compliance/index.tsx` | `file` | React page component | `frontend` |
| 53 | `frontend/src/pages/CompositionQueue/index.tsx` | `file` | React page component | `frontend` |
| 54 | `frontend/src/pages/CRM/index.tsx` | `file` | React page component | `frontend` |
| 55 | `frontend/src/pages/CustomerReturn/index.tsx` | `file` | React page component | `frontend` |
| 56 | `frontend/src/pages/CustomerReturnHistory/index.tsx` | `file` | React page component | `frontend` |
| 57 | `frontend/src/pages/Dashboard/index.tsx` | `file` | React page component | `frontend` |
| 58 | `frontend/src/pages/Database/index.tsx` | `file` | React page component | `frontend` |
| 59 | `frontend/src/pages/Dispatch/index.tsx` | `file` | React page component | `frontend` |
| 60 | `frontend/src/pages/Expiry/index.tsx` | `file` | React page component | `frontend` |
| 61 | `frontend/src/pages/Inventory/index.tsx` | `file` | React page component | `frontend` |
| 62 | `frontend/src/pages/Investigation/index.tsx` | `file` | React page component | `frontend` |
| 63 | `frontend/src/pages/Learning/index.tsx` | `file` | React page component | `frontend` |
| 64 | `frontend/src/pages/Mail/index.tsx` | `file` | React page component | `frontend` |
| 65 | `frontend/src/pages/Migration/components/ColumnMapper.tsx` | `file` | React page component | `frontend` |
| 66 | `frontend/src/pages/Migration/components/ErrorRows.tsx` | `file` | React page component | `frontend` |
| 67 | `frontend/src/pages/Migration/components/LocalBackupPanel.tsx` | `file` | React page component | `frontend` |
| 68 | `frontend/src/pages/Migration/components/ModuleSection.tsx` | `file` | React page component | `frontend` |
| 69 | `frontend/src/pages/Migration/components/RedBookUploader.tsx` | `file` | React page component | `frontend` |
| 70 | `frontend/src/pages/Migration/components/ReviewModal.tsx` | `file` | React page component | `frontend` |
| 71 | `frontend/src/pages/Migration/index.tsx` | `file` | React page component | `frontend` |
| 72 | `frontend/src/pages/PharmarackCart/index.tsx` | `file` | React page component | `frontend` |
| 73 | `frontend/src/pages/PhoneSales/index.tsx` | `file` | React page component | `frontend` |
| 74 | `frontend/src/pages/POS/index.tsx` | `file` | React page component | `frontend` |
| 75 | `frontend/src/pages/PurchaseHistory/index.tsx` | `file` | React page component | `frontend` |
| 76 | `frontend/src/pages/Purchases/index.tsx` | `file` | React page component | `frontend` |
| 77 | `frontend/src/pages/Reports/index.tsx` | `file` | React page component | `frontend` |
| 78 | `frontend/src/pages/Returns/ExpiryReturnReview.tsx` | `file` | React page component | `frontend` |
| 79 | `frontend/src/pages/Returns/index.tsx` | `file` | React page component | `frontend` |
| 80 | `frontend/src/pages/Sells/index.tsx` | `file` | React page component | `frontend` |
| 81 | `frontend/src/pages/Settings/index.tsx` | `file` | React page component | `frontend` |
| 82 | `frontend/src/services/api.ts` | `file` | Source file: api.ts | `frontend` |
| 83 | `frontend/src/services/dataFetchControl.ts` | `file` | Source file: dataFetchControl.ts | `frontend` |
| 84 | `frontend/src/services/events.ts` | `file` | Source file: events.ts | `frontend` |
| 85 | `frontend/src/services/keyboardShortcuts.ts` | `file` | Source file: keyboardShortcuts.ts | `frontend` |
| 86 | `frontend/src/services/stagedQueueService.ts` | `file` | Source file: stagedQueueService.ts | `frontend` |
| 87 | `frontend/src/types/api.ts` | `file` | Source file: api.ts | `frontend` |
| 88 | `frontend/src/types/window.d.ts` | `file` | Source file: window.d.ts | `frontend` |
| 89 | `frontend/src/utils/cacheInvalidation.ts` | `file` | Source file: cacheInvalidation.ts | `frontend` |
| 90 | `frontend/src/utils/currency.ts` | `file` | Source file: currency.ts | `frontend` |
| 91 | `frontend/src/utils/date.ts` | `file` | Source file: date.ts | `frontend` |
| 92 | `frontend/src/utils/distributorValidator.ts` | `file` | Source file: distributorValidator.ts | `frontend` |
| 93 | `frontend/src/utils/export.ts` | `file` | Source file: export.ts | `frontend` |
| 94 | `frontend/src/utils/fuzzy.ts` | `file` | Source file: fuzzy.ts | `frontend` |
| 95 | `frontend/src/utils/orderFuzzyMatcher.ts` | `file` | Source file: orderFuzzyMatcher.ts | `frontend` |
| 96 | `frontend/src/utils/packagingMatcher.ts` | `file` | Source file: packagingMatcher.ts | `frontend` |
| 97 | `frontend/src/utils/pageModuleCaches.ts` | `file` | Source file: pageModuleCaches.ts | `frontend` |
| 98 | `frontend/src/utils/phone.ts` | `file` | Source file: phone.ts | `frontend` |
| 99 | `frontend/src/utils/settingsSync.ts` | `file` | Source file: settingsSync.ts | `frontend` |
| 100 | `frontend/tailwind.config.js` | `file` | Source file: tailwind.config.js | `frontend` |
| 101 | `frontend/tsconfig.app.json` | `config` | Configuration: tsconfig.app.json | `config` `frontend` |
| 102 | `frontend/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `frontend` |
| 103 | `frontend/tsconfig.node.json` | `config` | Configuration: tsconfig.node.json | `config` `frontend` |
| 104 | `frontend/vite.config.ts` | `file` | Source file: vite.config.ts | `frontend` |

### Mobile Layer — `layer:mobile`

<small style="color:#f59e0b">64 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `pharmacy-mobile/.claude/settings.json` | `config` | Configuration: settings.json | `config` `mobile` |
| 2 | `pharmacy-mobile/.vscode/extensions.json` | `config` | Configuration: extensions.json | `config` `mobile` |
| 3 | `pharmacy-mobile/.vscode/settings.json` | `config` | Configuration: settings.json | `config` `mobile` |
| 4 | `pharmacy-mobile/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` `mobile` |
| 5 | `pharmacy-mobile/android-configs/README.md` | `document` | Documentation: README.md | `documentation` `mobile` |
| 6 | `pharmacy-mobile/app.json` | `config` | Configuration: app.json | `config` `mobile` |
| 7 | `pharmacy-mobile/app/_layout.tsx` | `file` | Source file: _layout.tsx | `mobile` |
| 8 | `pharmacy-mobile/app/(tabs)/_layout.tsx` | `file` | Source file: _layout.tsx | `mobile` |
| 9 | `pharmacy-mobile/app/(tabs)/billing/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 10 | `pharmacy-mobile/app/(tabs)/inbox/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 11 | `pharmacy-mobile/app/(tabs)/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 12 | `pharmacy-mobile/app/(tabs)/inventory/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 13 | `pharmacy-mobile/app/(tabs)/more/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 14 | `pharmacy-mobile/app/(tabs)/purchases/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 15 | `pharmacy-mobile/app/(tabs)/refills/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 16 | `pharmacy-mobile/app/+not-found.tsx` | `file` | Source file: +not-found.tsx | `mobile` |
| 17 | `pharmacy-mobile/app/camera/index.tsx` | `file` | Source file: index.tsx | `ocr` `mobile` |
| 18 | `pharmacy-mobile/app/devices/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 19 | `pharmacy-mobile/app/notifications/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 20 | `pharmacy-mobile/app/product-search/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 21 | `pharmacy-mobile/assets/data/README.md` | `document` | Documentation: README.md | `documentation` `mobile` |
| 22 | `pharmacy-mobile/components/AppLock.tsx` | `file` | Source file: AppLock.tsx | `mobile` |
| 23 | `pharmacy-mobile/components/Card.tsx` | `file` | Source file: Card.tsx | `mobile` |
| 24 | `pharmacy-mobile/components/CartItem.tsx` | `file` | Source file: CartItem.tsx | `mobile` |
| 25 | `pharmacy-mobile/components/DeviceStatusHeader.tsx` | `file` | Source file: DeviceStatusHeader.tsx | `mobile` |
| 26 | `pharmacy-mobile/components/DrawerMenu.tsx` | `file` | Source file: DrawerMenu.tsx | `mobile` |
| 27 | `pharmacy-mobile/components/EditScreenInfo.tsx` | `file` | Source file: EditScreenInfo.tsx | `mobile` |
| 28 | `pharmacy-mobile/components/ExternalLink.tsx` | `file` | Source file: ExternalLink.tsx | `mobile` |
| 29 | `pharmacy-mobile/components/MedicineRow.tsx` | `file` | Source file: MedicineRow.tsx | `mobile` |
| 30 | `pharmacy-mobile/components/ProductListPanel.tsx` | `file` | Source file: ProductListPanel.tsx | `mobile` |
| 31 | `pharmacy-mobile/components/SearchBar.tsx` | `file` | Source file: SearchBar.tsx | `mobile` |
| 32 | `pharmacy-mobile/components/ServerSetup.tsx` | `file` | Source file: ServerSetup.tsx | `mobile` |
| 33 | `pharmacy-mobile/components/StatCard.tsx` | `file` | Source file: StatCard.tsx | `mobile` |
| 34 | `pharmacy-mobile/components/StyledText.tsx` | `file` | Source file: StyledText.tsx | `mobile` |
| 35 | `pharmacy-mobile/components/SwipeToDelete.tsx` | `file` | Source file: SwipeToDelete.tsx | `mobile` |
| 36 | `pharmacy-mobile/components/Themed.tsx` | `file` | Source file: Themed.tsx | `mobile` |
| 37 | `pharmacy-mobile/components/UpwardSearchDropdown.tsx` | `file` | Source file: UpwardSearchDropdown.tsx | `mobile` |
| 38 | `pharmacy-mobile/components/useClientOnlyValue.ts` | `file` | Source file: useClientOnlyValue.ts | `mobile` |
| 39 | `pharmacy-mobile/components/useClientOnlyValue.web.ts` | `file` | Source file: useClientOnlyValue.web.ts | `mobile` |
| 40 | `pharmacy-mobile/components/useColorScheme.ts` | `file` | Source file: useColorScheme.ts | `mobile` |
| 41 | `pharmacy-mobile/components/useColorScheme.web.ts` | `file` | Source file: useColorScheme.web.ts | `mobile` |
| 42 | `pharmacy-mobile/constants/Colors.ts` | `file` | Source file: Colors.ts | `mobile` |
| 43 | `pharmacy-mobile/expo-env.d.ts` | `file` | Source file: expo-env.d.ts | `mobile` |
| 44 | `pharmacy-mobile/lib/api.ts` | `file` | Source file: api.ts | `mobile` |
| 45 | `pharmacy-mobile/lib/api/admin.ts` | `file` | Source file: admin.ts | `mobile` |
| 46 | `pharmacy-mobile/lib/api/client.ts` | `file` | Source file: client.ts | `mobile` |
| 47 | `pharmacy-mobile/lib/api/gmail.ts` | `file` | Source file: gmail.ts | `mobile` |
| 48 | `pharmacy-mobile/lib/api/inventory.ts` | `file` | Source file: inventory.ts | `mobile` |
| 49 | `pharmacy-mobile/lib/api/misc.ts` | `file` | Source file: misc.ts | `mobile` |
| 50 | `pharmacy-mobile/lib/api/notifications.ts` | `file` | Source file: notifications.ts | `mobile` |
| 51 | `pharmacy-mobile/lib/api/orders.ts` | `file` | Source file: orders.ts | `mobile` |
| 52 | `pharmacy-mobile/lib/api/purchases.ts` | `file` | Source file: purchases.ts | `mobile` |
| 53 | `pharmacy-mobile/lib/api/refills.ts` | `file` | Source file: refills.ts | `mobile` |
| 54 | `pharmacy-mobile/lib/api/sales.ts` | `file` | Source file: sales.ts | `mobile` |
| 55 | `pharmacy-mobile/lib/api/scanBill.ts` | `file` | Source file: scanBill.ts | `mobile` |
| 56 | `pharmacy-mobile/lib/api/sync.ts` | `file` | Source file: sync.ts | `mobile` |
| 57 | `pharmacy-mobile/lib/cartEvents.ts` | `file` | Source file: cartEvents.ts | `mobile` |
| 58 | `pharmacy-mobile/lib/helpers.ts` | `file` | Source file: helpers.ts | `mobile` |
| 59 | `pharmacy-mobile/lib/secureStore.ts` | `file` | Source file: secureStore.ts | `mobile` |
| 60 | `pharmacy-mobile/lib/stock.ts` | `file` | Source file: stock.ts | `mobile` |
| 61 | `pharmacy-mobile/lib/theme.ts` | `file` | Source file: theme.ts | `mobile` |
| 62 | `pharmacy-mobile/package.json` | `config` | Configuration: package.json | `config` `mobile` |
| 63 | `pharmacy-mobile/PLAN.md` | `document` | Documentation: PLAN.md | `documentation` `mobile` |
| 64 | `pharmacy-mobile/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `mobile` |

### API Layer — `layer:api`

<small style="color:#a855f7">42 node(s) in graph</small>

#### Routes

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/routes/aiCamera.ts` | `file` | API route handler | `api` |
| 2 | `src/routes/audit.ts` | `file` | API route handler | `api` |
| 3 | `src/routes/automation.ts` | `file` | API route handler | `api` |
| 4 | `src/routes/catalog.ts` | `file` | API route handler | `api` |
| 5 | `src/routes/compliance.ts` | `file` | API route handler | `api` |
| 6 | `src/routes/contacts.ts` | `file` | API route handler | `api` |
| 7 | `src/routes/crm.ts` | `file` | API route handler | `api` |
| 8 | `src/routes/customerReturns.ts` | `file` | API route handler | `api` |
| 9 | `src/routes/dashboard.ts` | `file` | API route handler | `api` |
| 10 | `src/routes/dispatch.ts` | `file` | API route handler | `api` |
| 11 | `src/routes/distributors.ts` | `file` | API route handler | `api` |
| 12 | `src/routes/email.ts` | `file` | API route handler | `email` `api` |
| 13 | `src/routes/emailOrderReviews.ts` | `file` | API route handler | `email` `api` |
| 14 | `src/routes/enrichment.ts` | `file` | API route handler | `api` |
| 15 | `src/routes/expiry.ts` | `file` | API route handler | `api` |
| 16 | `src/routes/inventory.ts` | `file` | API route handler | `api` |
| 17 | `src/routes/investigation.ts` | `file` | API route handler | `api` |
| 18 | `src/routes/learning.ts` | `file` | API route handler | `api` |
| 19 | `src/routes/medicineAvailability.ts` | `file` | API route handler | `api` |
| 20 | `src/routes/medicines.ts` | `file` | API route handler | `api` |
| 21 | `src/routes/messaging.ts` | `file` | API route handler | `api` |
| 22 | `src/routes/migration.ts` | `file` | API route handler | `migration` `api` |
| 23 | `src/routes/notifications.ts` | `file` | API route handler | `api` |
| 24 | `src/routes/orders.ts` | `file` | API route handler | `api` |
| 25 | `src/routes/pharmarack.ts` | `file` | API route handler | `api` |
| 26 | `src/routes/purchases.ts` | `file` | API route handler | `api` |
| 27 | `src/routes/quickAssistant.ts` | `file` | API route handler | `api` |
| 28 | `src/routes/refills.ts` | `file` | API route handler | `api` |
| 29 | `src/routes/reports.ts` | `file` | API route handler | `api` |
| 30 | `src/routes/returns.ts` | `file` | API route handler | `api` |
| 31 | `src/routes/sales.ts` | `file` | API route handler | `api` |
| 32 | `src/routes/security.ts` | `file` | API route handler | `api` |
| 33 | `src/routes/sellPrice.ts` | `file` | API route handler | `api` |
| 34 | `src/routes/serviceStatus.ts` | `file` | API route handler | `api` |
| 35 | `src/routes/settings.ts` | `file` | API route handler | `api` |
| 36 | `src/routes/telegramPrescription.ts` | `file` | API route handler | `telegram` `api` |
| 37 | `src/routes/triggers.ts` | `file` | API route handler | `api` |
| 38 | `src/routes/upload.ts` | `file` | API route handler | `api` |
| 39 | `src/routes/utilities.ts` | `file` | API route handler | `api` |
| 40 | `src/routes/verification.ts` | `file` | API route handler | `api` |
| 41 | `src/routes/whatsappBusiness.ts` | `file` | API route handler | `whatsapp` `api` |
| 42 | `src/routes/whatsappQueue.ts` | `file` | API route handler | `whatsapp` `api` |

### Service Layer — `layer:service`

<small style="color:#10b981">63 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/services/activityLogger.ts` | `service` | Business service | `service` `business-logic` |
| 2 | `src/services/activityTracker.ts` | `service` | Business service | `service` `business-logic` |
| 3 | `src/services/aiCameraService.ts` | `service` | Business service | `service` `business-logic` |
| 4 | `src/services/apiClients/baseApiClient.ts` | `service` | Business service | `service` `business-logic` |
| 5 | `src/services/apiClients/openFdaClient.ts` | `service` | Business service | `service` `business-logic` |
| 6 | `src/services/apiClients/rxNormClient.ts` | `service` | Business service | `service` `business-logic` |
| 7 | `src/services/backupRecoveryService.ts` | `service` | Business service | `service` `business-logic` |
| 8 | `src/services/backupService.ts` | `service` | Business service | `service` `business-logic` |
| 9 | `src/services/barcodeService.ts` | `service` | Business service | `service` `business-logic` |
| 10 | `src/services/bouncedAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 11 | `src/services/cacheService.ts` | `service` | Business service | `service` `business-logic` |
| 12 | `src/services/creditNoteService.ts` | `service` | Business service | `service` `business-logic` |
| 13 | `src/services/dataFetchControl.ts` | `service` | Business service | `service` `business-logic` |
| 14 | `src/services/dataMerger.ts` | `service` | Business service | `service` `business-logic` |
| 15 | `src/services/distributorDispatchReminderWorker.ts` | `service` | Business service | `service` `business-logic` |
| 16 | `src/services/doctorReportingService.ts` | `service` | Business service | `service` `business-logic` |
| 17 | `src/services/emailService.ts` | `service` | Business service | `service` `email` `business-logic` |
| 18 | `src/services/eventService.ts` | `service` | Business service | `service` `business-logic` |
| 19 | `src/services/expiryAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 20 | `src/services/googleSearchService.ts` | `service` | Business service | `service` `business-logic` |
| 21 | `src/services/imageArchiveService.ts` | `service` | Business service | `service` `business-logic` |
| 22 | `src/services/intentKeywords.ts` | `service` | Business service | `service` `business-logic` |
| 23 | `src/services/inventoryCache.ts` | `service` | Business service | `service` `business-logic` |
| 24 | `src/services/inventoryService.ts` | `service` | Business service | `service` `business-logic` |
| 25 | `src/services/invoiceService.ts` | `service` | Business service | `service` `invoice` `business-logic` |
| 26 | `src/services/masterMedicinesSeedService.ts` | `service` | Business service | `service` `business-logic` |
| 27 | `src/services/medicineAvailabilityEngine.ts` | `service` | Business service | `service` `business-logic` |
| 28 | `src/services/medicineSalesMetricsService.ts` | `service` | Business service | `service` `business-logic` |
| 29 | `src/services/medicineService.ts` | `service` | Business service | `service` `business-logic` |
| 30 | `src/services/messagingQueue.ts` | `service` | Business service | `service` `business-logic` |
| 31 | `src/services/monthlyReportService.ts` | `service` | Business service | `service` `business-logic` |
| 32 | `src/services/nonMovingReportService.ts` | `service` | Business service | `service` `business-logic` |
| 33 | `src/services/notificationService.ts` | `service` | Business service | `service` `business-logic` |
| 34 | `src/services/ocrScanQueue.ts` | `service` | Business service | `service` `ocr` `business-logic` |
| 35 | `src/services/onlineDataEnricher.ts` | `service` | Business service | `service` `business-logic` |
| 36 | `src/services/onnxOcrService.ts` | `service` | Business service | `service` `business-logic` |
| 37 | `src/services/orderFulfillmentService.ts` | `service` | Business service | `service` `business-logic` |
| 38 | `src/services/orderTrackingService.ts` | `service` | Business service | `service` `business-logic` |
| 39 | `src/services/overlapDetectionService.ts` | `service` | Business service | `service` `business-logic` |
| 40 | `src/services/pdfInvoiceService.ts` | `service` | Business service | `service` `business-logic` |
| 41 | `src/services/pharmarackCatalogCache.ts` | `service` | Business service | `service` `business-logic` |
| 42 | `src/services/pharmarackDailyDispatchService.ts` | `service` | Business service | `service` `business-logic` |
| 43 | `src/services/productNameFilterService.ts` | `service` | Business service | `service` `business-logic` |
| 44 | `src/services/pushNotificationService.ts` | `service` | Business service | `service` `business-logic` |
| 45 | `src/services/refillService.ts` | `service` | Business service | `service` `business-logic` |
| 46 | `src/services/returnsService.ts` | `service` | Business service | `service` `business-logic` |
| 47 | `src/services/scispacyClient.ts` | `service` | Business service | `service` `business-logic` |
| 48 | `src/services/searchCache.ts` | `service` | Business service | `service` `business-logic` |
| 49 | `src/services/shortageReminderService.ts` | `service` | Business service | `service` `business-logic` |
| 50 | `src/services/similarityService.ts` | `service` | Business service | `service` `business-logic` |
| 51 | `src/services/startupSyncCoordinator.ts` | `service` | Business service | `service` `business-logic` |
| 52 | `src/services/storeSettingsService.ts` | `service` | Business service | `service` `business-logic` |
| 53 | `src/services/summaryCacheService.ts` | `service` | Business service | `service` `business-logic` |
| 54 | `src/services/telegramPrescriptionService.ts` | `service` | Business service | `service` `telegram` `business-logic` |
| 55 | `src/services/tokenRefreshScheduler.ts` | `service` | Business service | `service` `business-logic` |
| 56 | `src/services/triggerSchedulerService.ts` | `service` | Business service | `service` `business-logic` |
| 57 | `src/services/verificationService.ts` | `service` | Business service | `service` `business-logic` |
| 58 | `src/services/waAdminEscalationService.ts` | `service` | Business service | `service` `business-logic` |
| 59 | `src/services/whatsappBusinessService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 60 | `src/services/whatsappIntentService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 61 | `src/services/whatsappInvoiceService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 62 | `src/services/whatsappQueue.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 63 | `src/services/whatsappQueueWorker.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |

### Infrastructure Layer — `layer:infrastructure`

<small style="color:#06b6d4">24 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/middleware/asyncHandler.ts` | `file` | Express middleware | `general` |
| 2 | `src/middleware/errorHandler.ts` | `file` | Express middleware | `general` |
| 3 | `src/middleware/notFoundHandler.ts` | `file` | Express middleware | `general` |
| 4 | `src/worker/autoMatchWorker.ts` | `file` | Background worker | `general` |
| 5 | `src/worker/catalogWorker.ts` | `file` | Background worker | `general` |
| 6 | `src/worker/compositionEnricher.ts` | `file` | Background worker | `general` |
| 7 | `src/worker/emailPoller.ts` | `file` | Background worker | `email` |
| 8 | `src/worker/importers/pgB2BImporter.ts` | `file` | Background worker | `general` |
| 9 | `src/worker/importers/pgExtrasImporter.ts` | `file` | Background worker | `general` |
| 10 | `src/worker/importers/pgMasterImporter.ts` | `file` | Background worker | `general` |
| 11 | `src/worker/importers/pgPaymentsImporter.ts` | `file` | Background worker | `general` |
| 12 | `src/worker/importers/pgPurchaseImporter.ts` | `file` | Background worker | `general` |
| 13 | `src/worker/importers/pgReturnsImporter.ts` | `file` | Background worker | `general` |
| 14 | `src/worker/importers/pgSalesImporter.ts` | `file` | Background worker | `general` |
| 15 | `src/worker/migrationWorker.ts` | `file` | Background worker | `migration` |
| 16 | `src/worker/parsers/inventoryParser.ts` | `file` | Background worker | `general` |
| 17 | `src/worker/parsers/pgCopyParser.ts` | `file` | Background worker | `general` |
| 18 | `src/worker/parsers/returnsParser.ts` | `file` | Background worker | `general` |
| 19 | `src/worker/parsers/salesParser.ts` | `file` | Background worker | `general` |
| 20 | `src/worker/runCatalogWorker.ts` | `file` | Background worker | `general` |
| 21 | `src/worker/runEmailPoller.ts` | `file` | Background worker | `general` |
| 22 | `src/worker/stockCalculatorWorker.ts` | `file` | Background worker | `general` |
| 23 | `src/worker/substituteCacheWorker.ts` | `file` | Background worker | `general` |
| 24 | `src/worker/workerSupervisor.ts` | `file` | Background worker | `general` |

### Data Layer — `layer:data`

<small style="color:#3b82f6">4 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `data/audit_queue.json` | `file` | Configuration: audit_queue.json | `general` |
| 2 | `data/ocr_corrections.json` | `file` | Configuration: ocr_corrections.json | `ocr` |
| 3 | `data/pharmarack_profile/component_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 4 | `data/pharmarack_profile/extensions_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |

### Testing Layer — `layer:testing`

<small style="color:#ef4444">85 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `tests/aiCamera.test.ts` | `test` | Test: aiCamera.test.ts | `test` |
| 2 | `tests/auditIntegrity.test.ts` | `test` | Test: auditIntegrity.test.ts | `test` |
| 3 | `tests/automation.test.ts` | `test` | Test: automation.test.ts | `test` |
| 4 | `tests/backupRecovery.test.ts` | `test` | Test: backupRecovery.test.ts | `test` |
| 5 | `tests/catalogPipeline.test.ts` | `test` | Test: catalogPipeline.test.ts | `test` |
| 6 | `tests/complianceDataIntegrity.test.ts` | `test` | Test: complianceDataIntegrity.test.ts | `test` |
| 7 | `tests/crm.test.ts` | `test` | Test: crm.test.ts | `test` |
| 8 | `tests/dbIntegrity.test.ts` | `test` | Test: dbIntegrity.test.ts | `test` |
| 9 | `tests/distributorLearning.test.ts` | `test` | Test: distributorLearning.test.ts | `test` |
| 10 | `tests/distributorNotification.test.ts` | `test` | Test: distributorNotification.test.ts | `test` |
| 11 | `tests/distributorSanitization.test.ts` | `test` | Test: distributorSanitization.test.ts | `test` |
| 12 | `tests/distributorSyncPersistence.test.ts` | `test` | Test: distributorSyncPersistence.test.ts | `test` |
| 13 | `tests/doctorSanitization.test.ts` | `test` | Test: doctorSanitization.test.ts | `test` |
| 14 | `tests/duplicateCatalog.test.ts` | `test` | Test: duplicateCatalog.test.ts | `test` |
| 15 | `tests/email_attachments.test.ts` | `test` | Test: email_attachments.test.ts | `test` `email` |
| 16 | `tests/email_notifications.test.ts` | `test` | Test: email_notifications.test.ts | `test` `email` |
| 17 | `tests/email_retention.test.ts` | `test` | Test: email_retention.test.ts | `test` `email` |
| 18 | `tests/emailDistributorIntegrity.test.ts` | `test` | Test: emailDistributorIntegrity.test.ts | `test` `email` |
| 19 | `tests/emailPurchaseDateIntegrity.test.ts` | `test` | Test: emailPurchaseDateIntegrity.test.ts | `test` `email` |
| 20 | `tests/emailPurchaseDistributorIntegrity.test.ts` | `test` | Test: emailPurchaseDistributorIntegrity.test.ts | `test` `email` |
| 21 | `tests/expiryReturnReview.test.ts` | `test` | Test: expiryReturnReview.test.ts | `test` |
| 22 | `tests/ftsRepair.test.ts` | `test` | Test: ftsRepair.test.ts | `test` |
| 23 | `tests/intentKeywords.test.ts` | `test` | Test: intentKeywords.test.ts | `test` |
| 24 | `tests/inventoryActive.test.ts` | `test` | Test: inventoryActive.test.ts | `test` |
| 25 | `tests/inventoryFilters.test.ts` | `test` | Test: inventoryFilters.test.ts | `test` |
| 26 | `tests/inventoryParser.test.ts` | `test` | Test: inventoryParser.test.ts | `test` |
| 27 | `tests/investigation.test.ts` | `test` | Test: investigation.test.ts | `test` |
| 28 | `tests/investigationDelta.test.ts` | `test` | Test: investigationDelta.test.ts | `test` |
| 29 | `tests/invoiceNumberIntegrity.test.ts` | `test` | Test: invoiceNumberIntegrity.test.ts | `test` `invoice` |
| 30 | `tests/keyboardShortcuts.test.ts` | `test` | Test: keyboardShortcuts.test.ts | `test` |
| 31 | `tests/legitimateDataWorkflow.test.ts` | `test` | Test: legitimateDataWorkflow.test.ts | `test` |
| 32 | `tests/medicineSalesMetricsService.test.ts` | `test` | Test: medicineSalesMetricsService.test.ts | `test` |
| 33 | `tests/migrationDistributorHelpers.test.ts` | `test` | Test: migrationDistributorHelpers.test.ts | `test` `migration` |
| 34 | `tests/migrationLegacyMedicine.test.ts` | `test` | Test: migrationLegacyMedicine.test.ts | `test` `migration` |
| 35 | `tests/migrationPhantomIdAudit.test.ts` | `test` | Test: migrationPhantomIdAudit.test.ts | `test` `migration` |
| 36 | `tests/migrationPlaceholderIntegrity.test.ts` | `test` | Test: migrationPlaceholderIntegrity.test.ts | `test` `migration` |
| 37 | `tests/migrationRelationshipAudit.test.ts` | `test` | Test: migrationRelationshipAudit.test.ts | `test` `migration` |
| 38 | `tests/migrationStatusParser.test.ts` | `test` | Test: migrationStatusParser.test.ts | `test` `migration` |
| 39 | `tests/migrationStockRebuild.test.ts` | `test` | Test: migrationStockRebuild.test.ts | `test` `migration` |
| 40 | `tests/migrationV2.test.ts` | `test` | Test: migrationV2.test.ts | `test` `migration` |
| 41 | `tests/nearExpiryAuditReport.test.ts` | `test` | Test: nearExpiryAuditReport.test.ts | `test` |
| 42 | `tests/ocrParser.test.ts` | `test` | Test: ocrParser.test.ts | `test` `ocr` |
| 43 | `tests/onlineEnrichment.test.ts` | `test` | Test: onlineEnrichment.test.ts | `test` |
| 44 | `tests/ordersNotifiedFlag.test.ts` | `test` | Test: ordersNotifiedFlag.test.ts | `test` |
| 45 | `tests/packaging.test.ts` | `test` | Test: packaging.test.ts | `test` |
| 46 | `tests/paddleOcr.test.ts` | `test` | Test: paddleOcr.test.ts | `test` |
| 47 | `tests/pdf/pdfGenerator.missing.test.ts` | `test` | Test: pdfGenerator.missing.test.ts | `test` |
| 48 | `tests/pdf/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 49 | `tests/pdfInvoiceDiscount.test.ts` | `test` | Test: pdfInvoiceDiscount.test.ts | `test` |
| 50 | `tests/pharmarackCartItemVisibility.test.ts` | `test` | Test: pharmarackCartItemVisibility.test.ts | `test` |
| 51 | `tests/pharmarackCartNotif.test.ts` | `test` | Test: pharmarackCartNotif.test.ts | `test` |
| 52 | `tests/pharmarackCatalogCache.test.ts` | `test` | Test: pharmarackCatalogCache.test.ts | `test` |
| 53 | `tests/preMigration.test.ts` | `test` | Test: preMigration.test.ts | `test` |
| 54 | `tests/processGuardian.test.ts` | `test` | Test: processGuardian.test.ts | `test` |
| 55 | `tests/productionMockDataProtection.test.ts` | `test` | Test: productionMockDataProtection.test.ts | `test` |
| 56 | `tests/purchaseDateIntegrity.test.ts` | `test` | Test: purchaseDateIntegrity.test.ts | `test` |
| 57 | `tests/purchaseDistributorIntegrity.test.ts` | `test` | Test: purchaseDistributorIntegrity.test.ts | `test` |
| 58 | `tests/purchaseMrpIntegrity.test.ts` | `test` | Test: purchaseMrpIntegrity.test.ts | `test` |
| 59 | `tests/real_integration_test.mjs` | `test` | Test: real_integration_test.mjs | `test` |
| 60 | `tests/refillPharmacyName.test.ts` | `test` | Test: refillPharmacyName.test.ts | `test` |
| 61 | `tests/refills.test.ts` | `test` | Test: refills.test.ts | `test` |
| 62 | `tests/restoreBackup.test.ts` | `test` | Test: restoreBackup.test.ts | `test` |
| 63 | `tests/returnLossIntegrity.test.ts` | `test` | Test: returnLossIntegrity.test.ts | `test` |
| 64 | `tests/returnsParser.test.ts` | `test` | Test: returnsParser.test.ts | `test` |
| 65 | `tests/salesParser.test.ts` | `test` | Test: salesParser.test.ts | `test` |
| 66 | `tests/salesValidation.test.ts` | `test` | Test: salesValidation.test.ts | `test` |
| 67 | `tests/sampleImages.test.ts` | `test` | Test: sampleImages.test.ts | `test` |
| 68 | `tests/services/productNameFilterService.test.ts` | `test` | Test: productNameFilterService.test.ts | `test` |
| 69 | `tests/specialOrderArrival.test.ts` | `test` | Test: specialOrderArrival.test.ts | `test` |
| 70 | `tests/stockRebuild.test.ts` | `test` | Test: stockRebuild.test.ts | `test` |
| 71 | `tests/telegramBot.test.ts` | `test` | Test: telegramBot.test.ts | `test` `telegram` |
| 72 | `tests/telegramPrescription.test.ts` | `test` | Test: telegramPrescription.test.ts | `test` `telegram` |
| 73 | `tests/uiPages.test.ts` | `test` | Test: uiPages.test.ts | `test` |
| 74 | `tests/utilities_smoke.test.ts` | `test` | Test: utilities_smoke.test.ts | `test` |
| 75 | `tests/utilities.test.ts` | `test` | Test: utilities.test.ts | `test` |
| 76 | `tests/utils/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 77 | `tests/waAdminEscalation.test.ts` | `test` | Test: waAdminEscalation.test.ts | `test` |
| 78 | `tests/whatsapp/client.test.js` | `test` | Test: client.test.js | `test` `whatsapp` |
| 79 | `tests/whatsapp/client.test.ts` | `test` | Test: client.test.ts | `test` `whatsapp` |
| 80 | `tests/whatsapp/clientInit.test.js` | `test` | Test: clientInit.test.js | `test` `whatsapp` |
| 81 | `tests/whatsapp/clientInit.test.ts` | `test` | Test: clientInit.test.ts | `test` `whatsapp` |
| 82 | `tests/whatsappIntentGate.test.ts` | `test` | Test: whatsappIntentGate.test.ts | `test` `whatsapp` |
| 83 | `tests/whatsappPipeline.test.ts` | `test` | Test: whatsappPipeline.test.ts | `test` `whatsapp` |
| 84 | `tests/whatsappQueue.test.ts` | `test` | Test: whatsappQueue.test.ts | `test` `whatsapp` |
| 85 | `tests/whatsappRouting.test.ts` | `test` | Test: whatsappRouting.test.ts | `test` `whatsapp` |

### Documentation Layer — `layer:documentation`

<small style="color:#6b7280">8 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `docs/api_endpoints.md` | `document` | Documentation: api_endpoints.md | `documentation` |
| 2 | `docs/ARCHITECTURE.md` | `document` | Documentation: ARCHITECTURE.md | `documentation` |
| 3 | `docs/DATABASE_ARCHITECTURE.md` | `document` | Documentation: DATABASE_ARCHITECTURE.md | `documentation` |
| 4 | `docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md` | `document` | Documentation: KNOWLEDGE_GRAPH_DOCUMENTATION.md | `documentation` |
| 5 | `docs/MOBILE_APP_CONTEXT.md` | `document` | Documentation: MOBILE_APP_CONTEXT.md | `documentation` |
| 6 | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | `document` | Documentation: PROJECT_PAGE_AUDIT_DIRECTORY.md | `documentation` |
| 7 | `docs/samples/telegram_sample_message.txt` | `document` | Source file: telegram_sample_message.txt | `documentation` `telegram` |
| 8 | `docs/samples/whatsapp_sample_message.txt` | `document` | Source file: whatsapp_sample_message.txt | `documentation` `whatsapp` |

### Script Layer — `layer:scripts`

<small style="color:#14b8a6">32 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `scripts/backup.mjs` | `file` | Source file: backup.mjs | `general` |
| 2 | `scripts/build-medicine-dict.ts` | `file` | Source file: build-medicine-dict.ts | `general` |
| 3 | `scripts/buildBundle.cjs` | `file` | Source file: buildBundle.cjs | `general` |
| 4 | `scripts/buildSea.cjs` | `file` | Source file: buildSea.cjs | `general` |
| 5 | `scripts/clear-all-data.mjs` | `file` | Source file: clear-all-data.mjs | `general` |
| 6 | `scripts/extract-styles.mjs` | `file` | Source file: extract-styles.mjs | `general` |
| 7 | `scripts/generate-3d-graph.mjs` | `file` | Source file: generate-3d-graph.mjs | `general` |
| 8 | `scripts/generate-project-docs.mjs` | `file` | Source file: generate-project-docs.mjs | `general` |
| 9 | `scripts/heal-sales-gst.js` | `file` | Source file: heal-sales-gst.js | `general` |
| 10 | `scripts/heal-sales-invoices.js` | `file` | Source file: heal-sales-invoices.js | `invoice` |
| 11 | `scripts/importCatalog.ts` | `file` | Source file: importCatalog.ts | `general` |
| 12 | `scripts/importMedicineNames.mjs` | `file` | Source file: importMedicineNames.mjs | `general` |
| 13 | `scripts/migrate.js` | `file` | Source file: migrate.js | `general` |
| 14 | `scripts/quick-update.mjs` | `file` | Source file: quick-update.mjs | `general` |
| 15 | `scripts/restore.mjs` | `file` | Source file: restore.mjs | `general` |
| 16 | `scripts/save_nikhil_bill.cjs` | `file` | Source file: save_nikhil_bill.cjs | `general` |
| 17 | `scripts/verify-isolation.mjs` | `file` | Source file: verify-isolation.mjs | `general` |
| 18 | `src/cli/enqueueCatalog.ts` | `file` | Source file: enqueueCatalog.ts | `general` |
| 19 | `src/cli/watchCatalog.ts` | `file` | Source file: watchCatalog.ts | `general` |
| 20 | `src/scripts/benchmarkPerformance.ts` | `file` | Source file: benchmarkPerformance.ts | `general` |
| 21 | `src/scripts/check_email.ts` | `file` | Source file: check_email.ts | `email` |
| 22 | `src/scripts/fixDb.ts` | `file` | Source file: fixDb.ts | `general` |
| 23 | `src/scripts/injectStyles.ts` | `file` | Source file: injectStyles.ts | `general` |
| 24 | `src/scripts/inspect_purchases_sequence.ts` | `file` | Source file: inspect_purchases_sequence.ts | `general` |
| 25 | `src/scripts/migrateItemCodes.ts` | `file` | Source file: migrateItemCodes.ts | `general` |
| 26 | `src/scripts/seedCompanies.ts` | `file` | Source file: seedCompanies.ts | `general` |
| 27 | `src/scripts/seedIndianMeds.ts` | `file` | Source file: seedIndianMeds.ts | `general` |
| 28 | `src/scripts/seedMassiveMeds.ts` | `file` | Source file: seedMassiveMeds.ts | `general` |
| 29 | `src/scripts/seedPdfs.ts` | `file` | Source file: seedPdfs.ts | `general` |
| 30 | `src/scripts/seedRealMeds.ts` | `file` | Source file: seedRealMeds.ts | `general` |
| 31 | `src/scripts/seedWhoMeds.ts` | `file` | Source file: seedWhoMeds.ts | `general` |
| 32 | `src/scripts/testMigration.ts` | `file` | Test: testMigration.ts | `general` |

### Configuration Layer — `layer:configuration`

<small style="color:#84cc16">163 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `__mocks__/sqlite3.js` | `file` | Source file: sqlite3.js | `general` |
| 2 | `.agents/rules/bug-fix.md` | `document` | Documentation: bug-fix.md | `documentation` |
| 3 | `.agents/rules/legitimate-data-audit.md` | `document` | Documentation: legitimate-data-audit.md | `documentation` |
| 4 | `.agents/rules/ponytail.md` | `document` | Documentation: ponytail.md | `documentation` |
| 5 | `.agents/skills/cf-skill/SKILL.md` | `document` | Documentation: SKILL.md | `documentation` |
| 6 | `.claude/settings.json` | `config` | Configuration: settings.json | `config` |
| 7 | `.opencode/package.json` | `config` | Configuration: package.json | `config` |
| 8 | `.opencode/plans/pos-cart-first-keyboard-flow.md` | `document` | Documentation: pos-cart-first-keyboard-flow.md | `documentation` |
| 9 | `.opencode/plans/pos-doctor-suggestions-refill-distinction.md` | `document` | Documentation: pos-doctor-suggestions-refill-distinction.md | `documentation` |
| 10 | `.vscode/launch.json` | `config` | Configuration: launch.json | `config` |
| 11 | `.vscode/settings.json` | `config` | Configuration: settings.json | `config` |
| 12 | `.wwebjs_cache/2.3000.1045109406.html` | `file` | Source file: 2.3000.1045109406.html | `general` |
| 13 | `.wwebjs_cache/2.3000.1045115170.html` | `file` | Source file: 2.3000.1045115170.html | `general` |
| 14 | `.wwebjs_cache/2.3000.1045118668.html` | `file` | Source file: 2.3000.1045118668.html | `general` |
| 15 | `.wwebjs_cache/2.3000.1045182781.html` | `file` | Source file: 2.3000.1045182781.html | `general` |
| 16 | `.wwebjs_cache/2.3000.1045191189.html` | `file` | Source file: 2.3000.1045191189.html | `general` |
| 17 | `.wwebjs_cache/2.3000.1045204510.html` | `file` | Source file: 2.3000.1045204510.html | `general` |
| 18 | `.wwebjs_cache/2.3000.1045209719.html` | `file` | Source file: 2.3000.1045209719.html | `general` |
| 19 | `.wwebjs_cache/2.3000.1045213319.html` | `file` | Source file: 2.3000.1045213319.html | `general` |
| 20 | `.wwebjs_cache/2.3000.1045253825.html` | `file` | Source file: 2.3000.1045253825.html | `general` |
| 21 | `.wwebjs_cache/2.3000.1045270340.html` | `file` | Source file: 2.3000.1045270340.html | `general` |
| 22 | `.wwebjs_cache/2.3000.1045273210.html` | `file` | Source file: 2.3000.1045273210.html | `general` |
| 23 | `.wwebjs_cache/2.3000.1045276459.html` | `file` | Source file: 2.3000.1045276459.html | `general` |
| 24 | `.wwebjs_cache/2.3000.1045279437.html` | `file` | Source file: 2.3000.1045279437.html | `general` |
| 25 | `.wwebjs_cache/2.3000.1045281803.html` | `file` | Source file: 2.3000.1045281803.html | `general` |
| 26 | `.wwebjs_cache/2.3000.1045283811.html` | `file` | Source file: 2.3000.1045283811.html | `general` |
| 27 | `.wwebjs_cache/2.3000.1045305987.html` | `file` | Source file: 2.3000.1045305987.html | `general` |
| 28 | `.wwebjs_cache/2.3000.1045308135.html` | `file` | Source file: 2.3000.1045308135.html | `general` |
| 29 | `.wwebjs_cache/2.3000.1045310503.html` | `file` | Source file: 2.3000.1045310503.html | `general` |
| 30 | `.wwebjs_cache/2.3000.1045323241.html` | `file` | Source file: 2.3000.1045323241.html | `general` |
| 31 | `.wwebjs_cache/2.3000.1045325264.html` | `file` | Source file: 2.3000.1045325264.html | `general` |
| 32 | `.wwebjs_cache/2.3000.1045327483.html` | `file` | Source file: 2.3000.1045327483.html | `general` |
| 33 | `.wwebjs_cache/2.3000.1045329622.html` | `file` | Source file: 2.3000.1045329622.html | `general` |
| 34 | `.wwebjs_cache/2.3000.1045333625.html` | `file` | Source file: 2.3000.1045333625.html | `general` |
| 35 | `.wwebjs_cache/2.3000.1045340097.html` | `file` | Source file: 2.3000.1045340097.html | `general` |
| 36 | `.wwebjs_cache/2.3000.1045418364.html` | `file` | Source file: 2.3000.1045418364.html | `general` |
| 37 | `.wwebjs_cache/2.3000.1045428348.html` | `file` | Source file: 2.3000.1045428348.html | `general` |
| 38 | `.wwebjs_cache/2.3000.1045433650.html` | `file` | Source file: 2.3000.1045433650.html | `general` |
| 39 | `.wwebjs_cache/2.3000.1045438870.html` | `file` | Source file: 2.3000.1045438870.html | `general` |
| 40 | `.wwebjs_cache/2.3000.1045443729.html` | `file` | Source file: 2.3000.1045443729.html | `general` |
| 41 | `.wwebjs_cache/2.3000.1045456189.html` | `file` | Source file: 2.3000.1045456189.html | `general` |
| 42 | `.wwebjs_cache/2.3000.1045466349.html` | `file` | Source file: 2.3000.1045466349.html | `general` |
| 43 | `.wwebjs_cache/2.3000.1045513958.html` | `file` | Source file: 2.3000.1045513958.html | `general` |
| 44 | `.wwebjs_cache/2.3000.1045528887.html` | `file` | Source file: 2.3000.1045528887.html | `general` |
| 45 | `.wwebjs_cache/2.3000.1045536027.html` | `file` | Source file: 2.3000.1045536027.html | `general` |
| 46 | `.wwebjs_cache/2.3000.1045547568.html` | `file` | Source file: 2.3000.1045547568.html | `general` |
| 47 | `.wwebjs_cache/2.3000.1045554756.html` | `file` | Source file: 2.3000.1045554756.html | `general` |
| 48 | `.wwebjs_cache/2.3000.1045618570.html` | `file` | Source file: 2.3000.1045618570.html | `general` |
| 49 | `.wwebjs_cache/2.3000.1045624538.html` | `file` | Source file: 2.3000.1045624538.html | `general` |
| 50 | `.wwebjs_cache/2.3000.1045631763.html` | `file` | Source file: 2.3000.1045631763.html | `general` |
| 51 | `.wwebjs_cache/2.3000.1045637952.html` | `file` | Source file: 2.3000.1045637952.html | `general` |
| 52 | `.wwebjs_cache/2.3000.1045643679.html` | `file` | Source file: 2.3000.1045643679.html | `general` |
| 53 | `.wwebjs_cache/2.3000.1045649367.html` | `file` | Source file: 2.3000.1045649367.html | `general` |
| 54 | `.wwebjs_cache/2.3000.1045711070.html` | `file` | Source file: 2.3000.1045711070.html | `general` |
| 55 | `.wwebjs_cache/2.3000.1045716975.html` | `file` | Source file: 2.3000.1045716975.html | `general` |
| 56 | `.wwebjs_cache/2.3000.1045720329.html` | `file` | Source file: 2.3000.1045720329.html | `general` |
| 57 | `.wwebjs_cache/2.3000.1045723848.html` | `file` | Source file: 2.3000.1045723848.html | `general` |
| 58 | `.wwebjs_cache/2.3000.1045728218.html` | `file` | Source file: 2.3000.1045728218.html | `general` |
| 59 | `.wwebjs_cache/2.3000.1045732124.html` | `file` | Source file: 2.3000.1045732124.html | `general` |
| 60 | `.wwebjs_cache/2.3000.1045737606.html` | `file` | Source file: 2.3000.1045737606.html | `general` |
| 61 | `.wwebjs_cache/2.3000.1045745970.html` | `file` | Source file: 2.3000.1045745970.html | `general` |
| 62 | `.wwebjs_cache/2.3000.1045756606.html` | `file` | Source file: 2.3000.1045756606.html | `general` |
| 63 | `.wwebjs_cache/2.3000.1045798079.html` | `file` | Source file: 2.3000.1045798079.html | `general` |
| 64 | `.wwebjs_cache/2.3000.1045807632.html` | `file` | Source file: 2.3000.1045807632.html | `general` |
| 65 | `.wwebjs_cache/2.3000.1045809198.html` | `file` | Source file: 2.3000.1045809198.html | `general` |
| 66 | `.wwebjs_cache/2.3000.1045811057.html` | `file` | Source file: 2.3000.1045811057.html | `general` |
| 67 | `.wwebjs_cache/2.3000.1045813171.html` | `file` | Source file: 2.3000.1045813171.html | `general` |
| 68 | `.wwebjs_cache/2.3000.1045816814.html` | `file` | Source file: 2.3000.1045816814.html | `general` |
| 69 | `.wwebjs_cache/2.3000.1045818043.html` | `file` | Source file: 2.3000.1045818043.html | `general` |
| 70 | `3d-knowledge-graph.html` | `file` | Source file: 3d-knowledge-graph.html | `general` |
| 71 | `AGENT_BUG_FIX_RULEBOOK.md` | `document` | Documentation: AGENT_BUG_FIX_RULEBOOK.md | `documentation` |
| 72 | `AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 73 | `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` | `document` | Documentation: API_OPTIMIZATION_IMPLEMENTATION_PLAN.md | `documentation` |
| 74 | `bootstrapper/main.ts` | `file` | Source file: main.ts | `general` |
| 75 | `bootstrapper/package.json` | `config` | Configuration: package.json | `config` |
| 76 | `BUG_FIX_RULE_GUIDE.md` | `document` | Documentation: BUG_FIX_RULE_GUIDE.md | `documentation` |
| 77 | `build_reference.mjs` | `file` | Source file: build_reference.mjs | `general` |
| 78 | `check_console.js` | `file` | Source file: check_console.js | `general` |
| 79 | `check_db.mjs` | `file` | Source file: check_db.mjs | `general` |
| 80 | `check_purchase.mjs` | `file` | Source file: check_purchase.mjs | `general` |
| 81 | `design-system/ai-pharmacy/MASTER.md` | `document` | Documentation: MASTER.md | `documentation` |
| 82 | `dist-pkg/server.cjs` | `file` | Source file: server.cjs | `general` |
| 83 | `eslint_after.json` | `config` | Configuration: eslint_after.json | `config` |
| 84 | `eslint_baseline.json` | `config` | Configuration: eslint_baseline.json | `config` |
| 85 | `gas/licenseServer.js` | `file` | Source file: licenseServer.js | `auth` |
| 86 | `gas/README.md` | `document` | Documentation: README.md | `documentation` |
| 87 | `heal_db.js` | `file` | Source file: heal_db.js | `general` |
| 88 | `import_reference.mjs` | `file` | Source file: import_reference.mjs | `general` |
| 89 | `index.js` | `file` | Source file: index.js | `general` |
| 90 | `jest.config.js` | `file` | Source file: jest.config.js | `general` |
| 91 | `license.txt` | `file` | Source file: license.txt | `auth` |
| 92 | `package.json` | `config` | Configuration: package.json | `config` |
| 93 | `packaging/portable.env` | `file` | Source file: portable.env | `general` |
| 94 | `pr8_diff.txt` | `file` | Source file: pr8_diff.txt | `general` |
| 95 | `productResolver.ts` | `file` | Source file: productResolver.ts | `general` |
| 96 | `python/scan_nlp/requirements.txt` | `file` | Source file: requirements.txt | `general` |
| 97 | `README.md` | `document` | Documentation: README.md | `documentation` |
| 98 | `real_eval.ts` | `file` | Source file: real_eval.ts | `general` |
| 99 | `requirements.txt` | `file` | Source file: requirements.txt | `general` |
| 100 | `scan_benchmark.ts` | `file` | Source file: scan_benchmark.ts | `general` |
| 101 | `scanGateAlgorithms.ts` | `file` | Source file: scanGateAlgorithms.ts | `general` |
| 102 | `scratch/test_refills.mjs` | `file` | Test: test_refills.mjs | `general` |
| 103 | `scratch/test_sales_metrics.mjs` | `file` | Test: test_sales_metrics.mjs | `general` |
| 104 | `scratch/test_sales_metrics.ts` | `file` | Test: test_sales_metrics.ts | `general` |
| 105 | `sea-config.json` | `config` | Configuration: sea-config.json | `config` |
| 106 | `sea-entry.cjs` | `file` | Source file: sea-entry.cjs | `general` |
| 107 | `SMALL_BUG_FIX_PLAN.md` | `document` | Documentation: SMALL_BUG_FIX_PLAN.md | `documentation` |
| 108 | `SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md` | `document` | Documentation: SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md | `documentation` |
| 109 | `src/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 110 | `src/bootstrap.ts` | `file` | Source file: bootstrap.ts | `general` |
| 111 | `src/config/index.ts` | `file` | Source file: index.ts | `general` |
| 112 | `src/database.ts` | `file` | Source file: database.ts | `general` |
| 113 | `src/database/connection.ts` | `file` | Source file: connection.ts | `general` |
| 114 | `src/database/messageDAO.ts` | `file` | Source file: messageDAO.ts | `general` |
| 115 | `src/database/migrations/002_message_tables.sql` | `file` | SQL migration: 002_message_tables.sql | `migration` |
| 116 | `src/database/migrations/003_license_settings.sql` | `file` | SQL migration: 003_license_settings.sql | `migration` `auth` |
| 117 | `src/database/sqlitePatch.ts` | `file` | Source file: sqlitePatch.ts | `general` |
| 118 | `src/extractor.ts` | `file` | Source file: extractor.ts | `general` |
| 119 | `src/i18n/getMessage.ts` | `file` | Source file: getMessage.ts | `general` |
| 120 | `src/i18n/messages.json` | `config` | Configuration: messages.json | `config` |
| 121 | `src/process/processGuardian.ts` | `file` | Source file: processGuardian.ts | `general` |
| 122 | `src/server.ts` | `file` | Source file: server.ts | `general` |
| 123 | `src/telegramBot.ts` | `file` | Source file: telegramBot.ts | `telegram` |
| 124 | `src/utils/activityTracker.ts` | `file` | Source file: activityTracker.ts | `general` |
| 125 | `src/utils/auditEngine.ts` | `file` | Source file: auditEngine.ts | `general` |
| 126 | `src/utils/chromeBrowser.ts` | `file` | Source file: chromeBrowser.ts | `general` |
| 127 | `src/utils/dateExtractor.ts` | `file` | Source file: dateExtractor.ts | `general` |
| 128 | `src/utils/distributorSyncHelper.ts` | `file` | Source file: distributorSyncHelper.ts | `general` |
| 129 | `src/utils/doctorUtils.ts` | `file` | Source file: doctorUtils.ts | `general` |
| 130 | `src/utils/emailSanitizer.ts` | `file` | Source file: emailSanitizer.ts | `email` |
| 131 | `src/utils/inventoryActive.ts` | `file` | Source file: inventoryActive.ts | `general` |
| 132 | `src/utils/lazyPuppeteer.ts` | `file` | Source file: lazyPuppeteer.ts | `general` |
| 133 | `src/utils/logger.ts` | `file` | Source file: logger.ts | `general` |
| 134 | `src/utils/migrationAudit.ts` | `file` | Source file: migrationAudit.ts | `migration` |
| 135 | `src/utils/migrationDistributorHelpers.ts` | `file` | Source file: migrationDistributorHelpers.ts | `migration` |
| 136 | `src/utils/migrationInventoryHelpers.ts` | `file` | Source file: migrationInventoryHelpers.ts | `migration` |
| 137 | `src/utils/migrationMeta.ts` | `file` | Source file: migrationMeta.ts | `migration` |
| 138 | `src/utils/migrationStockRebuild.ts` | `file` | Source file: migrationStockRebuild.ts | `migration` |
| 139 | `src/utils/migrationUtils.ts` | `file` | Source file: migrationUtils.ts | `migration` |
| 140 | `src/utils/migrationValidation.ts` | `file` | Source file: migrationValidation.ts | `migration` |
| 141 | `src/utils/mockGuard.ts` | `file` | Source file: mockGuard.ts | `general` |
| 142 | `src/utils/nameNormalizer.ts` | `file` | Source file: nameNormalizer.ts | `general` |
| 143 | `src/utils/networkDetector.ts` | `file` | Source file: networkDetector.ts | `general` |
| 144 | `src/utils/notifications.ts` | `file` | Source file: notifications.ts | `general` |
| 145 | `src/utils/orderNameMatcher.ts` | `file` | Source file: orderNameMatcher.ts | `general` |
| 146 | `src/utils/packaging.ts` | `file` | Source file: packaging.ts | `general` |
| 147 | `src/utils/password.ts` | `file` | Source file: password.ts | `general` |
| 148 | `src/utils/pdfGenerator.ts` | `file` | Source file: pdfGenerator.ts | `general` |
| 149 | `src/utils/preMigrationIntelligence.ts` | `file` | Source file: preMigrationIntelligence.ts | `general` |
| 150 | `src/utils/reportCutover.ts` | `file` | Source file: reportCutover.ts | `general` |
| 151 | `src/utils/reportExporter.ts` | `file` | Source file: reportExporter.ts | `general` |
| 152 | `src/utils/retry.ts` | `file` | Source file: retry.ts | `general` |
| 153 | `src/utils/stockRebuild.ts` | `file` | Source file: stockRebuild.ts | `general` |
| 154 | `src/utils/validateStagingDatabase.ts` | `file` | Source file: validateStagingDatabase.ts | `general` |
| 155 | `src/utils/whatsappTemplateBuilder.ts` | `file` | Source file: whatsappTemplateBuilder.ts | `whatsapp` |
| 156 | `src/whatsappClient.ts` | `file` | Source file: whatsappClient.ts | `whatsapp` |
| 157 | `tools/migration-extractor/index.js` | `file` | Source file: index.js | `migration` |
| 158 | `tools/migration-extractor/package.json` | `config` | Configuration: package.json | `config` `migration` |
| 159 | `tools/migration-extractor/scripts/buildBundle.cjs` | `file` | Source file: buildBundle.cjs | `migration` |
| 160 | `tools/migration-extractor/scripts/buildSea.cjs` | `file` | Source file: buildSea.cjs | `migration` |
| 161 | `tools/migration-extractor/sea-config.json` | `config` | Configuration: sea-config.json | `config` `migration` |
| 162 | `trigger_reload.mjs` | `file` | Source file: trigger_reload.mjs | `general` |
| 163 | `tsconfig.json` | `config` | Configuration: tsconfig.json | `config` |

## Node Type Breakdown

| Type | Count | Example |
|---|---|---|
| `file` | 387 | `bootstrapper/main.ts` |
| `test` | 85 | `tests/aiCamera.test.ts` |
| `service` | 63 | `src/services/activityTracker.ts` |
| `document` | 30 | `.agents/rules/bug-fix.md` |
| `config` | 24 | `.vscode/settings.json` |

## Dependency Graph (imports)

Edges represent `import`/`require` relationships detected in source (resolve-based, first 50 lines). Only edges whose source and target exist as documented nodes are shown.

### Most Imported Modules (top 30 dependents)

| Imported By Count | Module |
|---|---|
| 45 | `frontend/src/services/api.ts` |
| 26 | `pharmacy-mobile/lib/theme.ts` |
| 23 | `frontend/src/services/events.ts` |
| 22 | `frontend/src/utils/date.ts` |
| 19 | `frontend/src/hooks/useApiQuery.ts` |
| 17 | `pharmacy-mobile/lib/api.ts` |
| 12 | `frontend/src/utils/cacheInvalidation.ts` |
| 12 | `pharmacy-mobile/lib/api/client.ts` |
| 9 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` |
| 9 | `pharmacy-mobile/lib/secureStore.ts` |
| 8 | `frontend/src/utils/phone.ts` |
| 7 | `frontend/src/hooks/usePersistedDateRange.ts` |
| 6 | `frontend/src/utils/settingsSync.ts` |
| 6 | `frontend/src/hooks/useInfiniteScroll.ts` |
| 6 | `frontend/src/utils/export.ts` |
| 5 | `frontend/src/hooks/useVirtualizer.ts` |
| 5 | `frontend/src/components/InfiniteTable.tsx` |
| 5 | `frontend/src/components/VirtualRow.tsx` |
| 5 | `frontend/src/components/InfiniteScrollStatus.tsx` |
| 5 | `frontend/src/components/UniversalMedicineEditModal.tsx` |
| 5 | `frontend/src/components/PhoneInputWithBadge.tsx` |
| 4 | `frontend/src/hooks/useOnClickOutside.ts` |
| 4 | `frontend/src/hooks/useDeferredEffect.ts` |
| 3 | `frontend/src/services/stagedQueueService.ts` |
| 3 | `frontend/src/hooks/useFetchMode.ts` |
| 3 | `frontend/src/components/DateRangeFilter.tsx` |
| 3 | `frontend/src/services/keyboardShortcuts.ts` |
| 3 | `frontend/src/utils/distributorValidator.ts` |
| 3 | `frontend/src/utils/currency.ts` |
| 3 | `pharmacy-mobile/lib/stock.ts` |

### Most Dependent Sources (top 20 importing modules)

| Imports | Module |
|---|---|
| 16 | `frontend/src/pages/Purchases/index.tsx` |
| 14 | `frontend/src/pages/POS/index.tsx` |
| 13 | `frontend/src/pages/Inventory/index.tsx` |
| 13 | `frontend/src/pages/Sells/index.tsx` |
| 13 | `frontend/src/pages/Settings/index.tsx` |
| 13 | `pharmacy-mobile/lib/api.ts` |
| 11 | `frontend/src/pages/PurchaseHistory/index.tsx` |
| 10 | `frontend/src/pages/Investigation/index.tsx` |
| 10 | `frontend/src/pages/Learning/index.tsx` |
| 9 | `frontend/src/pages/CustomerReturnHistory/index.tsx` |
| 9 | `frontend/src/pages/PharmarackCart/index.tsx` |
| 8 | `pharmacy-mobile/lib/api/sync.ts` |
| 7 | `frontend/src/pages/CRM/index.tsx` |
| 7 | `frontend/src/pages/Dispatch/index.tsx` |
| 7 | `frontend/src/pages/Mail/index.tsx` |
| 7 | `frontend/src/pages/Returns/index.tsx` |
| 6 | `frontend/src/App.tsx` |
| 6 | `frontend/src/pages/Database/index.tsx` |
| 6 | `frontend/src/pages/Expiry/index.tsx` |
| 6 | `frontend/src/pages/Reports/index.tsx` |

## Automation and Background Timers

Services and workers that scan files for repeated-interval, cron, or background-loop behaviour. Intervals are summarized from the file inventory; confirm exact values in source.

| Service | Path |
|---|---|
| backupRecoveryService.ts | `src/services/backupRecoveryService.ts` |
| backupService.ts | `src/services/backupService.ts` |
| bouncedAlertService.ts | `src/services/bouncedAlertService.ts` |
| distributorDispatchReminderWorker.ts | `src/services/distributorDispatchReminderWorker.ts` |
| expiryAlertService.ts | `src/services/expiryAlertService.ts` |
| messagingQueue.ts | `src/services/messagingQueue.ts` |
| ocrScanQueue.ts | `src/services/ocrScanQueue.ts` |
| pharmarackDailyDispatchService.ts | `src/services/pharmarackDailyDispatchService.ts` |
| shortageReminderService.ts | `src/services/shortageReminderService.ts` |
| startupSyncCoordinator.ts | `src/services/startupSyncCoordinator.ts` |
| tokenRefreshScheduler.ts | `src/services/tokenRefreshScheduler.ts` |
| triggerSchedulerService.ts | `src/services/triggerSchedulerService.ts` |
| whatsappQueue.ts | `src/services/whatsappQueue.ts` |
| whatsappQueueWorker.ts | `src/services/whatsappQueueWorker.ts` |

## Configuration & Environment

| Type | Count |
|---|---|
| Config nodes (json/yml/env) | 24 |

| Env file | Description |
|---|---|
| `packaging/portable.env` | Source file: portable.env |

## Generated Notes

- Graph totals include vendored packages (`.venv`, `node_modules`, caches) that are excluded from the narrative sections.
- Edges shown are only those whose both endpoints survived the noise filter; the raw graph may carry more edges.
- Regenerate with:
  ```bash
  node scripts/quick-update.mjs          # refresh the graph
  node scripts/generate-project-docs.mjs # refresh this document
  ```

---
_Generated at 2026-08-23T04:19:59.235Z._