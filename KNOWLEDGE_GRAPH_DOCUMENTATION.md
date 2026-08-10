# AI Pharmacy OS — Complete Project Documentation

> **Auto-generated from the project knowledge graph** (`.understand-anything/knowledge-graph.json`). Do not edit by hand — run `node scripts/generate-project-docs.mjs` after `node scripts/quick-update.mjs` to refresh.

## Project Overview

| Attribute | Value |
|---|---|
| **Name** | AI Pharmacy OS |
| **Description** | Unified pharmacy management platform. |
| **Languages** | typescript, javascript, json, markdown, html, css |
| **Frameworks** | Express.js, React, Vite, Tailwind CSS, React Native, Expo |
| **Analyzed At** | 2026-08-09T17:35:13.619Z |
| **Git Commit** | `a277f204a64719d7fb99ce5164104520ec86e50a` |
| **Graph Nodes (total)** | 568 |
| **Graph Edges (total)** | 288 |
| **Documented Nodes (excl. vendored/caches)** | 568 |
| **Documented Edges (excl. vendored/caches)** | 288 |

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
| **Configuration Layer** `layer:configuration` | Package configs | 118 |
| **Documentation Layer** `layer:documentation` | Docs and specs | 73 |
| **Presentation Layer** `layer:presentation` | Frontend React SPA | 102 |
| **Mobile Layer** `layer:mobile` | React Native Expo app | 46 |
| **Script Layer** `layer:scripts` | CLI tools and scripts | 31 |
| **Infrastructure Layer** `layer:infrastructure` | Middleware and workers | 25 |
| **API Layer** `layer:api` | Express.js route handlers | 42 |
| **Service Layer** `layer:service` | Business logic services | 59 |
| **Testing Layer** `layer:testing` | Test files | 60 |
| **Data Layer** `layer:data` | Database and data files | 12 |

## File Inventory by Layer

All project files (vendored `.venv`/`node_modules`/build caches excluded). Each entry shows the node id, type, role summary, and tags. File names link to their repository path.

### Presentation Layer — `layer:presentation`

<small style="color:#ec4899">102 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `frontend/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` `frontend` |
| 2 | `frontend/eslint.config.js` | `file` | Source file: eslint.config.js | `frontend` |
| 3 | `frontend/index.html` | `file` | Source file: index.html | `frontend` |
| 4 | `frontend/package.json` | `config` | Configuration: package.json | `config` `frontend` |
| 5 | `frontend/postcss.config.js` | `file` | Source file: postcss.config.js | `frontend` |
| 6 | `frontend/public/manifest.json` | `config` | Configuration: manifest.json | `config` `frontend` |
| 7 | `frontend/public/sw.js` | `file` | Source file: sw.js | `frontend` |
| 8 | `frontend/README.md` | `document` | Documentation: README.md | `documentation` `frontend` |
| 9 | `frontend/src/App.css` | `file` | Source file: App.css | `frontend` |
| 10 | `frontend/src/App.tsx` | `file` | Source file: App.tsx | `frontend` |
| 11 | `frontend/src/components/AICamera.tsx` | `file` | React component | `frontend` |
| 12 | `frontend/src/components/BackupCenterModal.tsx` | `file` | React component | `frontend` |
| 13 | `frontend/src/components/ConnectedDevicesFooterBar.tsx` | `file` | React component | `frontend` |
| 14 | `frontend/src/components/DateRangeFilter.tsx` | `file` | React component | `frontend` |
| 15 | `frontend/src/components/HoverPriceIntelTable.tsx` | `file` | React component | `frontend` |
| 16 | `frontend/src/components/InfiniteScrollStatus.tsx` | `file` | React component | `frontend` |
| 17 | `frontend/src/components/InfiniteTable.tsx` | `file` | React component | `frontend` |
| 18 | `frontend/src/components/Layout.tsx` | `file` | React component | `frontend` |
| 19 | `frontend/src/components/LiveCartAddModal.tsx` | `file` | React component | `frontend` |
| 20 | `frontend/src/components/MobileConnectionModal.tsx` | `file` | React component | `frontend` |
| 21 | `frontend/src/components/PhoneInputWithBadge.tsx` | `file` | React component | `frontend` |
| 22 | `frontend/src/components/POS/BrandBanner.tsx` | `file` | React component | `frontend` |
| 23 | `frontend/src/components/PriceIntelPanel.tsx` | `file` | React component | `frontend` |
| 24 | `frontend/src/components/QuickOrderModal.tsx` | `file` | React component | `frontend` |
| 25 | `frontend/src/components/StagedQueueFloatingWidget.tsx` | `file` | React component | `frontend` |
| 26 | `frontend/src/components/StagedReviewModal.tsx` | `file` | React component | `frontend` |
| 27 | `frontend/src/components/UniversalMedicineEditModal.tsx` | `file` | React component | `frontend` |
| 28 | `frontend/src/components/VirtualRow.tsx` | `file` | React component | `frontend` |
| 29 | `frontend/src/components/WhatsAppQueuePopover.tsx` | `file` | React component | `frontend` |
| 30 | `frontend/src/hooks/useApiQuery.ts` | `file` | Source file: useApiQuery.ts | `frontend` |
| 31 | `frontend/src/hooks/useContacts.ts` | `file` | Source file: useContacts.ts | `frontend` |
| 32 | `frontend/src/hooks/useDeferredEffect.ts` | `file` | Source file: useDeferredEffect.ts | `frontend` |
| 33 | `frontend/src/hooks/useFetchMode.ts` | `file` | Source file: useFetchMode.ts | `frontend` |
| 34 | `frontend/src/hooks/useInfiniteScroll.ts` | `file` | Source file: useInfiniteScroll.ts | `frontend` |
| 35 | `frontend/src/hooks/useOnClickOutside.ts` | `file` | Source file: useOnClickOutside.ts | `frontend` |
| 36 | `frontend/src/hooks/usePageCache.ts` | `file` | Source file: usePageCache.ts | `frontend` |
| 37 | `frontend/src/hooks/usePersistedDateRange.ts` | `file` | Source file: usePersistedDateRange.ts | `frontend` |
| 38 | `frontend/src/hooks/usePWAInstall.ts` | `file` | Source file: usePWAInstall.ts | `frontend` |
| 39 | `frontend/src/hooks/useSettingsQuery.ts` | `file` | Source file: useSettingsQuery.ts | `frontend` |
| 40 | `frontend/src/hooks/useVirtualizer.ts` | `file` | Source file: useVirtualizer.ts | `frontend` |
| 41 | `frontend/src/index.css` | `file` | Source file: index.css | `frontend` |
| 42 | `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx` | `file` | Source file: KeepAliveOutlet.tsx | `frontend` |
| 43 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` | `file` | Source file: PageActiveContext.tsx | `frontend` |
| 44 | `frontend/src/lib/keepAlive/PageErrorBoundary.tsx` | `file` | Source file: PageErrorBoundary.tsx | `frontend` |
| 45 | `frontend/src/lib/pageImports.ts` | `file` | Source file: pageImports.ts | `frontend` |
| 46 | `frontend/src/lib/queryClient.ts` | `file` | Source file: queryClient.ts | `frontend` |
| 47 | `frontend/src/main.tsx` | `file` | Source file: main.tsx | `frontend` |
| 48 | `frontend/src/pages/CatalogUpload/index.tsx` | `file` | React page component | `frontend` |
| 49 | `frontend/src/pages/Compliance/index.tsx` | `file` | React page component | `frontend` |
| 50 | `frontend/src/pages/CompositionQueue/index.tsx` | `file` | React page component | `frontend` |
| 51 | `frontend/src/pages/CRM/index.tsx` | `file` | React page component | `frontend` |
| 52 | `frontend/src/pages/CustomerReturn/index.tsx` | `file` | React page component | `frontend` |
| 53 | `frontend/src/pages/CustomerReturnHistory/index.tsx` | `file` | React page component | `frontend` |
| 54 | `frontend/src/pages/Dashboard/index.tsx` | `file` | React page component | `frontend` |
| 55 | `frontend/src/pages/Database/index.tsx` | `file` | React page component | `frontend` |
| 56 | `frontend/src/pages/Dispatch/index.tsx` | `file` | React page component | `frontend` |
| 57 | `frontend/src/pages/Expiry/index.tsx` | `file` | React page component | `frontend` |
| 58 | `frontend/src/pages/Inventory/index.tsx` | `file` | React page component | `frontend` |
| 59 | `frontend/src/pages/Investigation/index.tsx` | `file` | React page component | `frontend` |
| 60 | `frontend/src/pages/Learning/index.tsx` | `file` | React page component | `frontend` |
| 61 | `frontend/src/pages/Mail/index.tsx` | `file` | React page component | `frontend` |
| 62 | `frontend/src/pages/Migration/components/ColumnMapper.tsx` | `file` | React page component | `frontend` |
| 63 | `frontend/src/pages/Migration/components/ErrorRows.tsx` | `file` | React page component | `frontend` |
| 64 | `frontend/src/pages/Migration/components/LocalBackupPanel.tsx` | `file` | React page component | `frontend` |
| 65 | `frontend/src/pages/Migration/components/ModuleSection.tsx` | `file` | React page component | `frontend` |
| 66 | `frontend/src/pages/Migration/components/RedBookUploader.tsx` | `file` | React page component | `frontend` |
| 67 | `frontend/src/pages/Migration/components/ReviewModal.tsx` | `file` | React page component | `frontend` |
| 68 | `frontend/src/pages/Migration/index.tsx` | `file` | React page component | `frontend` |
| 69 | `frontend/src/pages/NonMappedDistributors/index.tsx` | `file` | React page component | `frontend` |
| 70 | `frontend/src/pages/NonMappedDistributors/README_changes.md` | `file` | Documentation: README_changes.md | `frontend` |
| 71 | `frontend/src/pages/PharmarackCart/index.tsx` | `file` | React page component | `frontend` |
| 72 | `frontend/src/pages/PhoneSales/index.tsx` | `file` | React page component | `frontend` |
| 73 | `frontend/src/pages/POS/index.tsx` | `file` | React page component | `frontend` |
| 74 | `frontend/src/pages/PurchaseHistory/index.tsx` | `file` | React page component | `frontend` |
| 75 | `frontend/src/pages/Purchases/index.tsx` | `file` | React page component | `frontend` |
| 76 | `frontend/src/pages/Reports/index.tsx` | `file` | React page component | `frontend` |
| 77 | `frontend/src/pages/Returns/index.tsx` | `file` | React page component | `frontend` |
| 78 | `frontend/src/pages/SellPriceConfig/index.tsx` | `file` | React page component | `frontend` |
| 79 | `frontend/src/pages/Sells/index.tsx` | `file` | React page component | `frontend` |
| 80 | `frontend/src/pages/Settings/index.tsx` | `file` | React page component | `frontend` |
| 81 | `frontend/src/services/api.ts` | `file` | Source file: api.ts | `frontend` |
| 82 | `frontend/src/services/dataFetchControl.ts` | `file` | Source file: dataFetchControl.ts | `frontend` |
| 83 | `frontend/src/services/events.ts` | `file` | Source file: events.ts | `frontend` |
| 84 | `frontend/src/services/keyboardShortcuts.ts` | `file` | Source file: keyboardShortcuts.ts | `frontend` |
| 85 | `frontend/src/services/stagedQueueService.ts` | `file` | Source file: stagedQueueService.ts | `frontend` |
| 86 | `frontend/src/types/api.ts` | `file` | Source file: api.ts | `frontend` |
| 87 | `frontend/src/types/window.d.ts` | `file` | Source file: window.d.ts | `frontend` |
| 88 | `frontend/src/utils/cacheInvalidation.ts` | `file` | Source file: cacheInvalidation.ts | `frontend` |
| 89 | `frontend/src/utils/date.ts` | `file` | Source file: date.ts | `frontend` |
| 90 | `frontend/src/utils/emailSanitizer.ts` | `file` | Source file: emailSanitizer.ts | `email` `frontend` |
| 91 | `frontend/src/utils/export.ts` | `file` | Source file: export.ts | `frontend` |
| 92 | `frontend/src/utils/fuzzy.ts` | `file` | Source file: fuzzy.ts | `frontend` |
| 93 | `frontend/src/utils/orderFuzzyMatcher.ts` | `file` | Source file: orderFuzzyMatcher.ts | `frontend` |
| 94 | `frontend/src/utils/packagingMatcher.ts` | `file` | Source file: packagingMatcher.ts | `frontend` |
| 95 | `frontend/src/utils/pageModuleCaches.ts` | `file` | Source file: pageModuleCaches.ts | `frontend` |
| 96 | `frontend/src/utils/phone.ts` | `file` | Source file: phone.ts | `frontend` |
| 97 | `frontend/src/utils/settingsSync.ts` | `file` | Source file: settingsSync.ts | `frontend` |
| 98 | `frontend/tailwind.config.js` | `file` | Source file: tailwind.config.js | `frontend` |
| 99 | `frontend/tsconfig.app.json` | `config` | Configuration: tsconfig.app.json | `config` `frontend` |
| 100 | `frontend/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `frontend` |
| 101 | `frontend/tsconfig.node.json` | `config` | Configuration: tsconfig.node.json | `config` `frontend` |
| 102 | `frontend/vite.config.ts` | `file` | Source file: vite.config.ts | `frontend` |

### Mobile Layer — `layer:mobile`

<small style="color:#f59e0b">46 node(s) in graph</small>

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
| 15 | `pharmacy-mobile/app/+not-found.tsx` | `file` | Source file: +not-found.tsx | `mobile` |
| 16 | `pharmacy-mobile/app/camera/index.tsx` | `file` | Source file: index.tsx | `ocr` `mobile` |
| 17 | `pharmacy-mobile/app/notifications/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 18 | `pharmacy-mobile/app/product-search/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 19 | `pharmacy-mobile/assets/data/README.md` | `document` | Documentation: README.md | `documentation` `mobile` |
| 20 | `pharmacy-mobile/components/AppLock.tsx` | `file` | Source file: AppLock.tsx | `mobile` |
| 21 | `pharmacy-mobile/components/Card.tsx` | `file` | Source file: Card.tsx | `mobile` |
| 22 | `pharmacy-mobile/components/CartItem.tsx` | `file` | Source file: CartItem.tsx | `mobile` |
| 23 | `pharmacy-mobile/components/DeviceStatusHeader.tsx` | `file` | Source file: DeviceStatusHeader.tsx | `mobile` |
| 24 | `pharmacy-mobile/components/DrawerMenu.tsx` | `file` | Source file: DrawerMenu.tsx | `mobile` |
| 25 | `pharmacy-mobile/components/EditScreenInfo.tsx` | `file` | Source file: EditScreenInfo.tsx | `mobile` |
| 26 | `pharmacy-mobile/components/ExternalLink.tsx` | `file` | Source file: ExternalLink.tsx | `mobile` |
| 27 | `pharmacy-mobile/components/MedicineRow.tsx` | `file` | Source file: MedicineRow.tsx | `mobile` |
| 28 | `pharmacy-mobile/components/SearchBar.tsx` | `file` | Source file: SearchBar.tsx | `mobile` |
| 29 | `pharmacy-mobile/components/ServerSetup.tsx` | `file` | Source file: ServerSetup.tsx | `mobile` |
| 30 | `pharmacy-mobile/components/StatCard.tsx` | `file` | Source file: StatCard.tsx | `mobile` |
| 31 | `pharmacy-mobile/components/StyledText.tsx` | `file` | Source file: StyledText.tsx | `mobile` |
| 32 | `pharmacy-mobile/components/Themed.tsx` | `file` | Source file: Themed.tsx | `mobile` |
| 33 | `pharmacy-mobile/components/UpwardSearchDropdown.tsx` | `file` | Source file: UpwardSearchDropdown.tsx | `mobile` |
| 34 | `pharmacy-mobile/components/useClientOnlyValue.ts` | `file` | Source file: useClientOnlyValue.ts | `mobile` |
| 35 | `pharmacy-mobile/components/useClientOnlyValue.web.ts` | `file` | Source file: useClientOnlyValue.web.ts | `mobile` |
| 36 | `pharmacy-mobile/components/useColorScheme.ts` | `file` | Source file: useColorScheme.ts | `mobile` |
| 37 | `pharmacy-mobile/components/useColorScheme.web.ts` | `file` | Source file: useColorScheme.web.ts | `mobile` |
| 38 | `pharmacy-mobile/constants/Colors.ts` | `file` | Source file: Colors.ts | `mobile` |
| 39 | `pharmacy-mobile/expo-env.d.ts` | `file` | Source file: expo-env.d.ts | `mobile` |
| 40 | `pharmacy-mobile/lib/api.ts` | `file` | Source file: api.ts | `mobile` |
| 41 | `pharmacy-mobile/lib/cartEvents.ts` | `file` | Source file: cartEvents.ts | `mobile` |
| 42 | `pharmacy-mobile/lib/secureStore.ts` | `file` | Source file: secureStore.ts | `mobile` |
| 43 | `pharmacy-mobile/lib/theme.ts` | `file` | Source file: theme.ts | `mobile` |
| 44 | `pharmacy-mobile/package.json` | `config` | Configuration: package.json | `config` `mobile` |
| 45 | `pharmacy-mobile/PLAN.md` | `document` | Documentation: PLAN.md | `documentation` `mobile` |
| 46 | `pharmacy-mobile/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `mobile` |

### API Layer — `layer:api`

<small style="color:#a855f7">42 node(s) in graph</small>

#### Routes

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/routes/aiCamera.ts` | `file` | API route handler | `api` |
| 2 | `src/routes/archive.ts` | `file` | API route handler | `api` |
| 3 | `src/routes/automation.ts` | `file` | API route handler | `api` |
| 4 | `src/routes/catalog.ts` | `file` | API route handler | `api` |
| 5 | `src/routes/compliance.ts` | `file` | API route handler | `api` |
| 6 | `src/routes/contacts.ts` | `file` | API route handler | `api` |
| 7 | `src/routes/creditNotes.ts` | `file` | API route handler | `api` |
| 8 | `src/routes/crm.ts` | `file` | API route handler | `api` |
| 9 | `src/routes/customerReturns.ts` | `file` | API route handler | `api` |
| 10 | `src/routes/dashboard.ts` | `file` | API route handler | `api` |
| 11 | `src/routes/dispatch.ts` | `file` | API route handler | `api` |
| 12 | `src/routes/distributors.ts` | `file` | API route handler | `api` |
| 13 | `src/routes/email.ts` | `file` | API route handler | `email` `api` |
| 14 | `src/routes/emailOrderReviews.ts` | `file` | API route handler | `email` `api` |
| 15 | `src/routes/enrichment.ts` | `file` | API route handler | `api` |
| 16 | `src/routes/expiry.ts` | `file` | API route handler | `api` |
| 17 | `src/routes/inventory.ts` | `file` | API route handler | `api` |
| 18 | `src/routes/investigation.ts` | `file` | API route handler | `api` |
| 19 | `src/routes/learning.ts` | `file` | API route handler | `api` |
| 20 | `src/routes/medicineAvailability.ts` | `file` | API route handler | `api` |
| 21 | `src/routes/medicines.ts` | `file` | API route handler | `api` |
| 22 | `src/routes/messaging.ts` | `file` | API route handler | `api` |
| 23 | `src/routes/migration.ts` | `file` | API route handler | `migration` `api` |
| 24 | `src/routes/notifications.ts` | `file` | API route handler | `api` |
| 25 | `src/routes/orders.ts` | `file` | API route handler | `api` |
| 26 | `src/routes/pharmarack.ts` | `file` | API route handler | `api` |
| 27 | `src/routes/purchases.ts` | `file` | API route handler | `api` |
| 28 | `src/routes/quickAssistant.ts` | `file` | API route handler | `api` |
| 29 | `src/routes/refills.ts` | `file` | API route handler | `api` |
| 30 | `src/routes/reports.ts` | `file` | API route handler | `api` |
| 31 | `src/routes/returns.ts` | `file` | API route handler | `api` |
| 32 | `src/routes/sales.ts` | `file` | API route handler | `api` |
| 33 | `src/routes/security.ts` | `file` | API route handler | `api` |
| 34 | `src/routes/sellPrice.ts` | `file` | API route handler | `api` |
| 35 | `src/routes/serviceStatus.ts` | `file` | API route handler | `api` |
| 36 | `src/routes/settings.ts` | `file` | API route handler | `api` |
| 37 | `src/routes/telegramPrescription.ts` | `file` | API route handler | `telegram` `api` |
| 38 | `src/routes/upload.ts` | `file` | API route handler | `api` |
| 39 | `src/routes/utilities.ts` | `file` | API route handler | `api` |
| 40 | `src/routes/verification.ts` | `file` | API route handler | `api` |
| 41 | `src/routes/whatsappBusiness.ts` | `file` | API route handler | `whatsapp` `api` |
| 42 | `src/routes/whatsappQueue.ts` | `file` | API route handler | `whatsapp` `api` |

### Service Layer — `layer:service`

<small style="color:#10b981">59 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/services/activityTracker.ts` | `service` | Business service | `service` `business-logic` |
| 2 | `src/services/aiCameraService.ts` | `service` | Business service | `service` `business-logic` |
| 3 | `src/services/apiClients/baseApiClient.ts` | `service` | Business service | `service` `business-logic` |
| 4 | `src/services/apiClients/openFdaClient.ts` | `service` | Business service | `service` `business-logic` |
| 5 | `src/services/apiClients/rxNormClient.ts` | `service` | Business service | `service` `business-logic` |
| 6 | `src/services/backupRecoveryService.ts` | `service` | Business service | `service` `business-logic` |
| 7 | `src/services/backupService.ts` | `service` | Business service | `service` `business-logic` |
| 8 | `src/services/barcodeService.ts` | `service` | Business service | `service` `business-logic` |
| 9 | `src/services/bouncedAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 10 | `src/services/cacheService.ts` | `service` | Business service | `service` `business-logic` |
| 11 | `src/services/creditNoteService.ts` | `service` | Business service | `service` `business-logic` |
| 12 | `src/services/customerService.ts` | `service` | Business service | `service` `business-logic` |
| 13 | `src/services/dataFetchControl.ts` | `service` | Business service | `service` `business-logic` |
| 14 | `src/services/dataMerger.ts` | `service` | Business service | `service` `business-logic` |
| 15 | `src/services/doctorReportingService.ts` | `service` | Business service | `service` `business-logic` |
| 16 | `src/services/emailService.ts` | `service` | Business service | `service` `email` `business-logic` |
| 17 | `src/services/eventService.ts` | `service` | Business service | `service` `business-logic` |
| 18 | `src/services/expiryAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 19 | `src/services/googleSearchService.ts` | `service` | Business service | `service` `business-logic` |
| 20 | `src/services/imageArchiveService.ts` | `service` | Business service | `service` `business-logic` |
| 21 | `src/services/intentKeywords.ts` | `service` | Business service | `service` `business-logic` |
| 22 | `src/services/inventoryCache.ts` | `service` | Business service | `service` `business-logic` |
| 23 | `src/services/inventoryService.ts` | `service` | Business service | `service` `business-logic` |
| 24 | `src/services/invoiceService.ts` | `service` | Business service | `service` `invoice` `business-logic` |
| 25 | `src/services/masterMedicinesSeedService.ts` | `service` | Business service | `service` `business-logic` |
| 26 | `src/services/medicineAvailabilityEngine.ts` | `service` | Business service | `service` `business-logic` |
| 27 | `src/services/medicineService.ts` | `service` | Business service | `service` `business-logic` |
| 28 | `src/services/messagingQueue.ts` | `service` | Business service | `service` `business-logic` |
| 29 | `src/services/monthlyReportService.ts` | `service` | Business service | `service` `business-logic` |
| 30 | `src/services/nonMovingReportService.ts` | `service` | Business service | `service` `business-logic` |
| 31 | `src/services/notificationService.ts` | `service` | Business service | `service` `business-logic` |
| 32 | `src/services/ocrScanQueue.ts` | `service` | Business service | `service` `ocr` `business-logic` |
| 33 | `src/services/onlineDataEnricher.ts` | `service` | Business service | `service` `business-logic` |
| 34 | `src/services/onnxOcrService.ts` | `service` | Business service | `service` `business-logic` |
| 35 | `src/services/orderFulfillmentService.ts` | `service` | Business service | `service` `business-logic` |
| 36 | `src/services/orderTrackingService.ts` | `service` | Business service | `service` `business-logic` |
| 37 | `src/services/overlapDetectionService.ts` | `service` | Business service | `service` `business-logic` |
| 38 | `src/services/pdfInvoiceService.ts` | `service` | Business service | `service` `business-logic` |
| 39 | `src/services/pharmarackCatalogCache.ts` | `service` | Business service | `service` `business-logic` |
| 40 | `src/services/pharmarackDailyDispatchService.ts` | `service` | Business service | `service` `business-logic` |
| 41 | `src/services/productNameFilterService.ts` | `service` | Business service | `service` `business-logic` |
| 42 | `src/services/pushNotificationService.ts` | `service` | Business service | `service` `business-logic` |
| 43 | `src/services/refillService.ts` | `service` | Business service | `service` `business-logic` |
| 44 | `src/services/returnsService.ts` | `service` | Business service | `service` `business-logic` |
| 45 | `src/services/scispacyClient.ts` | `service` | Business service | `service` `business-logic` |
| 46 | `src/services/searchCache.ts` | `service` | Business service | `service` `business-logic` |
| 47 | `src/services/shortageReminderService.ts` | `service` | Business service | `service` `business-logic` |
| 48 | `src/services/similarityService.ts` | `service` | Business service | `service` `business-logic` |
| 49 | `src/services/storeSettingsService.ts` | `service` | Business service | `service` `business-logic` |
| 50 | `src/services/summaryCacheService.ts` | `service` | Business service | `service` `business-logic` |
| 51 | `src/services/telegramPrescriptionService.ts` | `service` | Business service | `service` `telegram` `business-logic` |
| 52 | `src/services/tokenRefreshScheduler.ts` | `service` | Business service | `service` `business-logic` |
| 53 | `src/services/verificationService.ts` | `service` | Business service | `service` `business-logic` |
| 54 | `src/services/waAdminEscalationService.ts` | `service` | Business service | `service` `business-logic` |
| 55 | `src/services/whatsappBusinessService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 56 | `src/services/whatsappIntentService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 57 | `src/services/whatsappInvoiceService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 58 | `src/services/whatsappQueue.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 59 | `src/services/whatsappQueueWorker.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |

### Infrastructure Layer — `layer:infrastructure`

<small style="color:#06b6d4">25 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/middleware/asyncHandler.ts` | `file` | Express middleware | `general` |
| 2 | `src/middleware/errorHandler.ts` | `file` | Express middleware | `general` |
| 3 | `src/middleware/notFoundHandler.ts` | `file` | Express middleware | `general` |
| 4 | `src/middleware/validation.ts` | `file` | Express middleware | `general` |
| 5 | `src/worker/autoMatchWorker.ts` | `file` | Background worker | `general` |
| 6 | `src/worker/catalogWorker.ts` | `file` | Background worker | `general` |
| 7 | `src/worker/compositionEnricher.ts` | `file` | Background worker | `general` |
| 8 | `src/worker/emailPoller.ts` | `file` | Background worker | `email` |
| 9 | `src/worker/importers/pgB2BImporter.ts` | `file` | Background worker | `general` |
| 10 | `src/worker/importers/pgExtrasImporter.ts` | `file` | Background worker | `general` |
| 11 | `src/worker/importers/pgMasterImporter.ts` | `file` | Background worker | `general` |
| 12 | `src/worker/importers/pgPaymentsImporter.ts` | `file` | Background worker | `general` |
| 13 | `src/worker/importers/pgPurchaseImporter.ts` | `file` | Background worker | `general` |
| 14 | `src/worker/importers/pgReturnsImporter.ts` | `file` | Background worker | `general` |
| 15 | `src/worker/importers/pgSalesImporter.ts` | `file` | Background worker | `general` |
| 16 | `src/worker/migrationWorker.ts` | `file` | Background worker | `migration` |
| 17 | `src/worker/parsers/inventoryParser.ts` | `file` | Background worker | `general` |
| 18 | `src/worker/parsers/pgCopyParser.ts` | `file` | Background worker | `general` |
| 19 | `src/worker/parsers/returnsParser.ts` | `file` | Background worker | `general` |
| 20 | `src/worker/parsers/salesParser.ts` | `file` | Background worker | `general` |
| 21 | `src/worker/runCatalogWorker.ts` | `file` | Background worker | `general` |
| 22 | `src/worker/runEmailPoller.ts` | `file` | Background worker | `general` |
| 23 | `src/worker/stockCalculatorWorker.ts` | `file` | Background worker | `general` |
| 24 | `src/worker/substituteCacheWorker.ts` | `file` | Background worker | `general` |
| 25 | `src/worker/workerSupervisor.ts` | `file` | Background worker | `general` |

### Data Layer — `layer:data`

<small style="color:#3b82f6">12 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `data/migration_reports/migration_summary.json` | `file` | Configuration: migration_summary.json | `migration` |
| 2 | `data/migration_reports/row_counts.json` | `file` | Configuration: row_counts.json | `migration` |
| 3 | `data/pharmarack_profile/component_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 4 | `data/pharmarack_profile/extensions_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 5 | `data/pharmarack_profile/OnDeviceHeadSuggestModel/20251024.824731831.14/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 6 | `data/pharmarack_profile/OnDeviceHeadSuggestModel/20251024.824731831.14/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 7 | `data/pharmarack_profile/Subresource Filter/Unindexed Rules/9.70.0/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 8 | `data/pharmarack_profile/Subresource Filter/Unindexed Rules/9.70.0/LICENSE.txt` | `file` | Source file: LICENSE.txt | `general` |
| 9 | `data/pharmarack_profile/Subresource Filter/Unindexed Rules/9.70.0/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 10 | `data/pharmarack_profile/TrustTokenKeyCommitments/2026.8.3.1/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 11 | `data/pharmarack_profile/TrustTokenKeyCommitments/2026.8.3.1/keys.json` | `file` | Configuration: keys.json | `general` |
| 12 | `data/pharmarack_profile/TrustTokenKeyCommitments/2026.8.3.1/manifest.json` | `file` | Configuration: manifest.json | `general` |

### Testing Layer — `layer:testing`

<small style="color:#ef4444">60 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `tests/aiCamera.test.ts` | `test` | Test: aiCamera.test.ts | `test` |
| 2 | `tests/automation.test.ts` | `test` | Test: automation.test.ts | `test` |
| 3 | `tests/backupRecovery.test.ts` | `test` | Test: backupRecovery.test.ts | `test` |
| 4 | `tests/catalogPipeline.test.ts` | `test` | Test: catalogPipeline.test.ts | `test` |
| 5 | `tests/crm.test.ts` | `test` | Test: crm.test.ts | `test` |
| 6 | `tests/dbIntegrity.test.ts` | `test` | Test: dbIntegrity.test.ts | `test` |
| 7 | `tests/distributorLearning.test.ts` | `test` | Test: distributorLearning.test.ts | `test` |
| 8 | `tests/distributorNotification.test.ts` | `test` | Test: distributorNotification.test.ts | `test` |
| 9 | `tests/distributorSanitization.test.ts` | `test` | Test: distributorSanitization.test.ts | `test` |
| 10 | `tests/distributorSyncPersistence.test.ts` | `test` | Test: distributorSyncPersistence.test.ts | `test` |
| 11 | `tests/doctorSanitization.test.ts` | `test` | Test: doctorSanitization.test.ts | `test` |
| 12 | `tests/duplicateCatalog.test.ts` | `test` | Test: duplicateCatalog.test.ts | `test` |
| 13 | `tests/email_attachments.test.ts` | `test` | Test: email_attachments.test.ts | `test` `email` |
| 14 | `tests/email_retention.test.ts` | `test` | Test: email_retention.test.ts | `test` `email` |
| 15 | `tests/ftsRepair.test.ts` | `test` | Test: ftsRepair.test.ts | `test` |
| 16 | `tests/intentKeywords.test.ts` | `test` | Test: intentKeywords.test.ts | `test` |
| 17 | `tests/inventoryActive.test.ts` | `test` | Test: inventoryActive.test.ts | `test` |
| 18 | `tests/inventoryFilters.test.ts` | `test` | Test: inventoryFilters.test.ts | `test` |
| 19 | `tests/inventoryParser.test.ts` | `test` | Test: inventoryParser.test.ts | `test` |
| 20 | `tests/investigation.test.ts` | `test` | Test: investigation.test.ts | `test` |
| 21 | `tests/investigationDelta.test.ts` | `test` | Test: investigationDelta.test.ts | `test` |
| 22 | `tests/keyboardShortcuts.test.ts` | `test` | Test: keyboardShortcuts.test.ts | `test` |
| 23 | `tests/migrationDistributorHelpers.test.ts` | `test` | Test: migrationDistributorHelpers.test.ts | `test` `migration` |
| 24 | `tests/migrationStatusParser.test.ts` | `test` | Test: migrationStatusParser.test.ts | `test` `migration` |
| 25 | `tests/migrationStockRebuild.test.ts` | `test` | Test: migrationStockRebuild.test.ts | `test` `migration` |
| 26 | `tests/migrationV2.test.ts` | `test` | Test: migrationV2.test.ts | `test` `migration` |
| 27 | `tests/ocrParser.test.ts` | `test` | Test: ocrParser.test.ts | `test` `ocr` |
| 28 | `tests/onlineEnrichment.test.ts` | `test` | Test: onlineEnrichment.test.ts | `test` |
| 29 | `tests/packaging.test.ts` | `test` | Test: packaging.test.ts | `test` |
| 30 | `tests/paddleOcr.test.ts` | `test` | Test: paddleOcr.test.ts | `test` |
| 31 | `tests/pdf/pdfGenerator.missing.test.ts` | `test` | Test: pdfGenerator.missing.test.ts | `test` |
| 32 | `tests/pdf/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 33 | `tests/pdfInvoiceDiscount.test.ts` | `test` | Test: pdfInvoiceDiscount.test.ts | `test` |
| 34 | `tests/pharmarackCartNotif.test.ts` | `test` | Test: pharmarackCartNotif.test.ts | `test` |
| 35 | `tests/pharmarackCatalogCache.test.ts` | `test` | Test: pharmarackCatalogCache.test.ts | `test` |
| 36 | `tests/preMigration.test.ts` | `test` | Test: preMigration.test.ts | `test` |
| 37 | `tests/processGuardian.test.ts` | `test` | Test: processGuardian.test.ts | `test` |
| 38 | `tests/real_integration_test.mjs` | `test` | Test: real_integration_test.mjs | `test` |
| 39 | `tests/refills.test.ts` | `test` | Test: refills.test.ts | `test` |
| 40 | `tests/restoreBackup.test.ts` | `test` | Test: restoreBackup.test.ts | `test` |
| 41 | `tests/returnsParser.test.ts` | `test` | Test: returnsParser.test.ts | `test` |
| 42 | `tests/salesParser.test.ts` | `test` | Test: salesParser.test.ts | `test` |
| 43 | `tests/salesValidation.test.ts` | `test` | Test: salesValidation.test.ts | `test` |
| 44 | `tests/sampleImages.test.ts` | `test` | Test: sampleImages.test.ts | `test` |
| 45 | `tests/services/productNameFilterService.test.ts` | `test` | Test: productNameFilterService.test.ts | `test` |
| 46 | `tests/stockRebuild.test.ts` | `test` | Test: stockRebuild.test.ts | `test` |
| 47 | `tests/telegramBot.test.ts` | `test` | Test: telegramBot.test.ts | `test` `telegram` |
| 48 | `tests/telegramPrescription.test.ts` | `test` | Test: telegramPrescription.test.ts | `test` `telegram` |
| 49 | `tests/uiPages.test.ts` | `test` | Test: uiPages.test.ts | `test` |
| 50 | `tests/utilities_smoke.test.ts` | `test` | Test: utilities_smoke.test.ts | `test` |
| 51 | `tests/utilities.test.ts` | `test` | Test: utilities.test.ts | `test` |
| 52 | `tests/utils/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 53 | `tests/waAdminEscalation.test.ts` | `test` | Test: waAdminEscalation.test.ts | `test` |
| 54 | `tests/whatsapp/client.test.js` | `test` | Test: client.test.js | `test` `whatsapp` |
| 55 | `tests/whatsapp/client.test.ts` | `test` | Test: client.test.ts | `test` `whatsapp` |
| 56 | `tests/whatsapp/clientInit.test.js` | `test` | Test: clientInit.test.js | `test` `whatsapp` |
| 57 | `tests/whatsapp/clientInit.test.ts` | `test` | Test: clientInit.test.ts | `test` `whatsapp` |
| 58 | `tests/whatsappIntentGate.test.ts` | `test` | Test: whatsappIntentGate.test.ts | `test` `whatsapp` |
| 59 | `tests/whatsappPipeline.test.ts` | `test` | Test: whatsappPipeline.test.ts | `test` `whatsapp` |
| 60 | `tests/whatsappRouting.test.ts` | `test` | Test: whatsappRouting.test.ts | `test` `whatsapp` |

### Documentation Layer — `layer:documentation`

<small style="color:#6b7280">73 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `docs/api_endpoints.md` | `document` | Documentation: api_endpoints.md | `documentation` |
| 2 | `docs/ARCHITECTURE.md` | `document` | Documentation: ARCHITECTURE.md | `documentation` |
| 3 | `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` | `document` | Documentation: COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md | `documentation` |
| 4 | `docs/DATABASE_ARCHITECTURE.md` | `document` | Documentation: DATABASE_ARCHITECTURE.md | `documentation` |
| 5 | `docs/IMPL_PLAN_SETTINGS_REDIRECT_DEEPLINK_FONT.md` | `document` | Documentation: IMPL_PLAN_SETTINGS_REDIRECT_DEEPLINK_FONT.md | `documentation` |
| 6 | `docs/MOBILE_APP_CONTEXT.md` | `document` | Documentation: MOBILE_APP_CONTEXT.md | `documentation` |
| 7 | `docs/pages/CompositionQueue.md` | `document` | Documentation: CompositionQueue.md | `documentation` |
| 8 | `docs/pages/CRM.md` | `document` | Documentation: CRM.md | `documentation` |
| 9 | `docs/pages/Dashboard.md` | `document` | Documentation: Dashboard.md | `documentation` |
| 10 | `docs/pages/Database.md` | `document` | Documentation: Database.md | `documentation` |
| 11 | `docs/pages/Inventory.md` | `document` | Documentation: Inventory.md | `documentation` |
| 12 | `docs/pages/Investigation.md` | `document` | Documentation: Investigation.md | `documentation` |
| 13 | `docs/pages/Learning.md` | `document` | Documentation: Learning.md | `documentation` |
| 14 | `docs/pages/Mail.md` | `document` | Documentation: Mail.md | `documentation` |
| 15 | `docs/pages/MessageListener.md` | `document` | Documentation: MessageListener.md | `documentation` |
| 16 | `docs/pages/Migration.md` | `document` | Documentation: Migration.md | `documentation` |
| 17 | `docs/pages/Orders.md` | `document` | Documentation: Orders.md | `documentation` |
| 18 | `docs/pages/PharmarackCart.md` | `document` | Documentation: PharmarackCart.md | `documentation` |
| 19 | `docs/pages/PhoneSales.md` | `document` | Documentation: PhoneSales.md | `documentation` |
| 20 | `docs/pages/POS.md` | `document` | Documentation: POS.md | `documentation` |
| 21 | `docs/pages/PurchaseHistory.md` | `document` | Documentation: PurchaseHistory.md | `documentation` |
| 22 | `docs/pages/Purchases.md` | `document` | Documentation: Purchases.md | `documentation` |
| 23 | `docs/pages/Reports.md` | `document` | Documentation: Reports.md | `documentation` |
| 24 | `docs/pages/Returns.md` | `document` | Documentation: Returns.md | `documentation` |
| 25 | `docs/pages/Sells.md` | `document` | Documentation: Sells.md | `documentation` |
| 26 | `docs/pages/Settings.md` | `document` | Documentation: Settings.md | `documentation` |
| 27 | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | `document` | Documentation: PROJECT_PAGE_AUDIT_DIRECTORY.md | `documentation` |
| 28 | `docs/samples/telegram_sample_message.txt` | `document` | Source file: telegram_sample_message.txt | `documentation` `telegram` |
| 29 | `docs/samples/whatsapp_sample_message.txt` | `document` | Source file: whatsapp_sample_message.txt | `documentation` `whatsapp` |
| 30 | `docs/shared/CACHE_KEYS.md` | `document` | Documentation: CACHE_KEYS.md | `documentation` |
| 31 | `docs/shared/DATA_FLOW.md` | `document` | Documentation: DATA_FLOW.md | `documentation` |
| 32 | `docs/shared/SHARED_COMPONENTS.md` | `document` | Documentation: SHARED_COMPONENTS.md | `documentation` |
| 33 | `docs/STORAGE_PATH_AND_UI_GAPS_AUDIT.md` | `document` | Documentation: STORAGE_PATH_AND_UI_GAPS_AUDIT.md | `documentation` |
| 34 | `docs/superpowers/plans/2026-05-24-medicine-name-extraction-plan.md` | `document` | Documentation: 2026-05-24-medicine-name-extraction-plan.md | `documentation` |
| 35 | `docs/superpowers/plans/2026-05-24-whatsapp-automation-plan.md` | `document` | Documentation: 2026-05-24-whatsapp-automation-plan.md | `documentation` `whatsapp` |
| 36 | `docs/superpowers/plans/2026-05-25-ai-camera-product-name-filtering.md` | `document` | Documentation: 2026-05-25-ai-camera-product-name-filtering.md | `documentation` `ocr` |
| 37 | `docs/superpowers/plans/2026-05-25-ai-pharmacy-improvements.md` | `document` | Documentation: 2026-05-25-ai-pharmacy-improvements.md | `documentation` |
| 38 | `docs/superpowers/plans/2026-05-26-delete-backup-files.md` | `document` | Documentation: 2026-05-26-delete-backup-files.md | `documentation` |
| 39 | `docs/superpowers/plans/2026-07-22-restore-whatsapp-web-client.md` | `document` | Documentation: 2026-07-22-restore-whatsapp-web-client.md | `documentation` `whatsapp` |
| 40 | `docs/superpowers/plans/2026-07-26-frontend-performance-benchmarking.md` | `document` | Documentation: 2026-07-26-frontend-performance-benchmarking.md | `documentation` |
| 41 | `docs/superpowers/plans/2026-07-26-keepalive-page-architecture.md` | `document` | Documentation: 2026-07-26-keepalive-page-architecture.md | `documentation` |
| 42 | `docs/superpowers/specs/2026-05-23-cleanup-ai-pharmacy-md-design.md` | `document` | Documentation: 2026-05-23-cleanup-ai-pharmacy-md-design.md | `documentation` |
| 43 | `docs/superpowers/specs/2026-05-23-page-wise-design.md` | `document` | Documentation: 2026-05-23-page-wise-design.md | `documentation` |
| 44 | `docs/superpowers/specs/2026-05-24-medicine-name-extraction-design.md` | `document` | Documentation: 2026-05-24-medicine-name-extraction-design.md | `documentation` |
| 45 | `docs/superpowers/specs/2026-05-24-telegram-bot-design.md` | `document` | Documentation: 2026-05-24-telegram-bot-design.md | `documentation` `telegram` |
| 46 | `docs/superpowers/specs/2026-05-24-whatsapp-automation-design.md` | `document` | Documentation: 2026-05-24-whatsapp-automation-design.md | `documentation` `whatsapp` |
| 47 | `docs/superpowers/specs/2026-05-25-ai-camera-image-test-design.md` | `document` | Documentation: 2026-05-25-ai-camera-image-test-design.md | `documentation` `ocr` |
| 48 | `docs/superpowers/specs/2026-05-25-ai-camera-product-name-filtering-design.md` | `document` | Documentation: 2026-05-25-ai-camera-product-name-filtering-design.md | `documentation` `ocr` |
| 49 | `docs/superpowers/specs/2026-05-25-ai-pharmacy-audit-design.md` | `document` | Documentation: 2026-05-25-ai-pharmacy-audit-design.md | `documentation` |
| 50 | `docs/superpowers/specs/2026-05-25-email-triggered-notifications-design.md` | `document` | Documentation: 2026-05-25-email-triggered-notifications-design.md | `documentation` `email` |
| 51 | `docs/superpowers/specs/2026-05-25-hybrid-online-offline-product-data-design.md` | `document` | Documentation: 2026-05-25-hybrid-online-offline-product-data-design.md | `documentation` |
| 52 | `docs/superpowers/specs/2026-05-25-memory-utility-design.md` | `document` | Documentation: 2026-05-25-memory-utility-design.md | `documentation` |
| 53 | `docs/superpowers/specs/2026-05-25-telegram-order-management-design.md` | `document` | Documentation: 2026-05-25-telegram-order-management-design.md | `documentation` `telegram` |
| 54 | `docs/superpowers/specs/2026-05-26-frontend-redesign-light-attractive.md` | `document` | Documentation: 2026-05-26-frontend-redesign-light-attractive.md | `documentation` |
| 55 | `docs/superpowers/specs/2026-05-26-migration-enhancement-design.md` | `document` | Documentation: 2026-05-26-migration-enhancement-design.md | `documentation` `migration` |
| 56 | `docs/superpowers/specs/2026-05-26-redesign-ui-demo.md` | `document` | Documentation: 2026-05-26-redesign-ui-demo.md | `documentation` |
| 57 | `docs/superpowers/specs/2026-06-02-pos-billing-page-layout-spec.md` | `document` | Documentation: 2026-06-02-pos-billing-page-layout-spec.md | `documentation` |
| 58 | `docs/superpowers/specs/2026-06-03-mail-attachment-picker-design.md` | `document` | Documentation: 2026-06-03-mail-attachment-picker-design.md | `documentation` |
| 59 | `docs/superpowers/specs/2026-06-03-mail-implementation-quickstart.md` | `document` | Documentation: 2026-06-03-mail-implementation-quickstart.md | `documentation` |
| 60 | `docs/superpowers/specs/2026-06-03-mail-page-ui-design.md` | `document` | Documentation: 2026-06-03-mail-page-ui-design.md | `documentation` |
| 61 | `docs/superpowers/specs/2026-06-03-mail-page-workflow-design.md` | `document` | Documentation: 2026-06-03-mail-page-workflow-design.md | `documentation` |
| 62 | `docs/superpowers/specs/2026-06-13-whatsapp-automation-agent-spec.md` | `document` | Documentation: 2026-06-13-whatsapp-automation-agent-spec.md | `documentation` `whatsapp` |
| 63 | `docs/superpowers/specs/2026-07-07-pos-medicine-row-compaction-design.md` | `document` | Documentation: 2026-07-07-pos-medicine-row-compaction-design.md | `documentation` |
| 64 | `docs/superpowers/specs/2026-07-22-crm-whatsapp-chat-design.md` | `document` | Documentation: 2026-07-22-crm-whatsapp-chat-design.md | `documentation` `whatsapp` |
| 65 | `docs/superpowers/specs/2026-07-22-restore-whatsapp-web-client-design.md` | `document` | Documentation: 2026-07-22-restore-whatsapp-web-client-design.md | `documentation` `whatsapp` |
| 66 | `docs/superpowers/specs/2026-07-26-frontend-performance-keepalive-design.md` | `document` | Documentation: 2026-07-26-frontend-performance-keepalive-design.md | `documentation` |
| 67 | `docs/superpowers/specs/implementation_plan.md` | `document` | Documentation: implementation_plan.md | `documentation` |
| 68 | `docs/superpowers/specs/incomplete_tasks_implementation_plan.md` | `document` | Documentation: incomplete_tasks_implementation_plan.md | `documentation` |
| 69 | `docs/superpowers/specs/surgical_fixes.md` | `document` | Documentation: surgical_fixes.md | `documentation` |
| 70 | `docs/superpowers/specs/walkthrough.md` | `document` | Documentation: walkthrough.md | `documentation` |
| 71 | `docs/superpowers/specs/wsl_migration_report.md` | `document` | Documentation: wsl_migration_report.md | `documentation` `migration` |
| 72 | `docs/superpowers/specs/wsl_setup_roadmap.md` | `document` | Documentation: wsl_setup_roadmap.md | `documentation` |
| 73 | `docs/WORKFLOW_IMPLEMENTATION_PLAN.md` | `document` | Documentation: WORKFLOW_IMPLEMENTATION_PLAN.md | `documentation` |

### Script Layer — `layer:scripts`

<small style="color:#14b8a6">31 node(s) in graph</small>

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
| 12 | `scripts/migrate.js` | `file` | Source file: migrate.js | `general` |
| 13 | `scripts/quick-update.mjs` | `file` | Source file: quick-update.mjs | `general` |
| 14 | `scripts/restore.mjs` | `file` | Source file: restore.mjs | `general` |
| 15 | `scripts/save_nikhil_bill.cjs` | `file` | Source file: save_nikhil_bill.cjs | `general` |
| 16 | `scripts/verify-isolation.mjs` | `file` | Source file: verify-isolation.mjs | `general` |
| 17 | `src/cli/enqueueCatalog.ts` | `file` | Source file: enqueueCatalog.ts | `general` |
| 18 | `src/cli/seedMockData.ts` | `file` | Source file: seedMockData.ts | `general` |
| 19 | `src/cli/watchCatalog.ts` | `file` | Source file: watchCatalog.ts | `general` |
| 20 | `src/scripts/check_email.ts` | `file` | Source file: check_email.ts | `email` |
| 21 | `src/scripts/fixDb.ts` | `file` | Source file: fixDb.ts | `general` |
| 22 | `src/scripts/injectStyles.ts` | `file` | Source file: injectStyles.ts | `general` |
| 23 | `src/scripts/inspect_purchases_sequence.ts` | `file` | Source file: inspect_purchases_sequence.ts | `general` |
| 24 | `src/scripts/migrateItemCodes.ts` | `file` | Source file: migrateItemCodes.ts | `general` |
| 25 | `src/scripts/seedCompanies.ts` | `file` | Source file: seedCompanies.ts | `general` |
| 26 | `src/scripts/seedIndianMeds.ts` | `file` | Source file: seedIndianMeds.ts | `general` |
| 27 | `src/scripts/seedMassiveMeds.ts` | `file` | Source file: seedMassiveMeds.ts | `general` |
| 28 | `src/scripts/seedPdfs.ts` | `file` | Source file: seedPdfs.ts | `general` |
| 29 | `src/scripts/seedRealMeds.ts` | `file` | Source file: seedRealMeds.ts | `general` |
| 30 | `src/scripts/seedWhoMeds.ts` | `file` | Source file: seedWhoMeds.ts | `general` |
| 31 | `src/scripts/testMigration.ts` | `file` | Test: testMigration.ts | `general` |

### Configuration Layer — `layer:configuration`

<small style="color:#84cc16">118 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `__mocks__/sqlite3.js` | `file` | Source file: sqlite3.js | `general` |
| 2 | `.agents/rules/bug-fix.md` | `document` | Documentation: bug-fix.md | `documentation` |
| 3 | `.agents/rules/ponytail.md` | `document` | Documentation: ponytail.md | `documentation` |
| 4 | `.agents/skills/cf-skill/SKILL.md` | `document` | Documentation: SKILL.md | `documentation` |
| 5 | `.opencode/config.json` | `config` | Configuration: config.json | `config` |
| 6 | `.opencode/package.json` | `config` | Configuration: package.json | `config` |
| 7 | `.opencode/plans/path-conflict-resolution.md` | `document` | Documentation: path-conflict-resolution.md | `documentation` |
| 8 | `.opencode/plans/sell-price-fix-plan.md` | `document` | Documentation: sell-price-fix-plan.md | `documentation` |
| 9 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/progress.md` | `document` | Documentation: progress.md | `documentation` |
| 10 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-1A-brief.md` | `document` | Documentation: task-1A-brief.md | `documentation` |
| 11 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-1A-report.md` | `document` | Documentation: task-1A-report.md | `documentation` |
| 12 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-1B-brief.md` | `document` | Documentation: task-1B-brief.md | `documentation` |
| 13 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-1B-report.md` | `document` | Documentation: task-1B-report.md | `documentation` |
| 14 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-2A-brief.md` | `document` | Documentation: task-2A-brief.md | `documentation` |
| 15 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-3C-brief.md` | `document` | Documentation: task-3C-brief.md | `documentation` |
| 16 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-3C-report.md` | `document` | Documentation: task-3C-report.md | `documentation` |
| 17 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-4-brief.md` | `document` | Documentation: task-4-brief.md | `documentation` |
| 18 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-4-report.md` | `document` | Documentation: task-4-report.md | `documentation` |
| 19 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-5A-brief.md` | `document` | Documentation: task-5A-brief.md | `documentation` |
| 20 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-5A-report.md` | `document` | Documentation: task-5A-report.md | `documentation` |
| 21 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-5B-brief.md` | `document` | Documentation: task-5B-brief.md | `documentation` |
| 22 | `.superpowers/sdd/IMPLEMENTATION_PLAN_BROKEN_FEATURES/task-5B-fix-report.md` | `document` | Documentation: task-5B-fix-report.md | `documentation` |
| 23 | `.vscode/settings.json` | `config` | Configuration: settings.json | `config` |
| 24 | `.wwebjs_cache/2.3000.1044812346.html` | `file` | Source file: 2.3000.1044812346.html | `general` |
| 25 | `09_I3_3RDGEN_OPTIMIZATION_MASTER_1.md` | `document` | Documentation: 09_I3_3RDGEN_OPTIMIZATION_MASTER_1.md | `documentation` |
| 26 | `3d-knowledge-graph.html` | `file` | Source file: 3d-knowledge-graph.html | `general` |
| 27 | `AGENT_BUG_FIX_RULEBOOK.md` | `document` | Documentation: AGENT_BUG_FIX_RULEBOOK.md | `documentation` |
| 28 | `AGENT_DECISION_FRAMEWORK.md` | `document` | Documentation: AGENT_DECISION_FRAMEWORK.md | `documentation` |
| 29 | `AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 30 | `AUDIT/01_PROJECT_OVERVIEW.md` | `document` | Documentation: 01_PROJECT_OVERVIEW.md | `documentation` |
| 31 | `AUDIT/02_ARCHITECTURE.md` | `document` | Documentation: 02_ARCHITECTURE.md | `documentation` |
| 32 | `AUDIT/03_DATA_FLOW.md` | `document` | Documentation: 03_DATA_FLOW.md | `documentation` |
| 33 | `AUDIT/04_WORKFLOWS.md` | `document` | Documentation: 04_WORKFLOWS.md | `documentation` |
| 34 | `AUDIT/05_PROBLEMS_AND_SOLUTIONS.md` | `document` | Documentation: 05_PROBLEMS_AND_SOLUTIONS.md | `documentation` |
| 35 | `AUDIT/06_PERFORMANCE_AND_RAM.md` | `document` | Documentation: 06_PERFORMANCE_AND_RAM.md | `documentation` |
| 36 | `AUDIT/07_IMPROVEMENTS.md` | `document` | Documentation: 07_IMPROVEMENTS.md | `documentation` |
| 37 | `bootstrapper/main.ts` | `file` | Source file: main.ts | `general` |
| 38 | `bootstrapper/package.json` | `config` | Configuration: package.json | `config` |
| 39 | `BUG_FIX_RULE_GUIDE.md` | `document` | Documentation: BUG_FIX_RULE_GUIDE.md | `documentation` |
| 40 | `build_reference.mjs` | `file` | Source file: build_reference.mjs | `general` |
| 41 | `check_console.js` | `file` | Source file: check_console.js | `general` |
| 42 | `check_db.mjs` | `file` | Source file: check_db.mjs | `general` |
| 43 | `check_purchase.mjs` | `file` | Source file: check_purchase.mjs | `general` |
| 44 | `CRM-WHATSAPP-CHAT-DESIGN.md` | `document` | Documentation: CRM-WHATSAPP-CHAT-DESIGN.md | `documentation` |
| 45 | `design-system/ai-pharmacy/MASTER.md` | `document` | Documentation: MASTER.md | `documentation` |
| 46 | `dist-pkg/server.cjs` | `file` | Source file: server.cjs | `general` |
| 47 | `EMAIL PRODUCT .md` | `document` | Documentation: EMAIL PRODUCT .md | `documentation` |
| 48 | `gas/licenseServer.js` | `file` | Source file: licenseServer.js | `auth` |
| 49 | `gas/README.md` | `document` | Documentation: README.md | `documentation` |
| 50 | `heal_db.js` | `file` | Source file: heal_db.js | `general` |
| 51 | `import_reference.mjs` | `file` | Source file: import_reference.mjs | `general` |
| 52 | `index.js` | `file` | Source file: index.js | `general` |
| 53 | `jest.config.js` | `file` | Source file: jest.config.js | `general` |
| 54 | `license.txt` | `file` | Source file: license.txt | `auth` |
| 55 | `MULTI_PC_STAFF_LOGIN_PLAN.md` | `document` | Documentation: MULTI_PC_STAFF_LOGIN_PLAN.md | `documentation` |
| 56 | `package.json` | `config` | Configuration: package.json | `config` |
| 57 | `packaging/portable.env` | `file` | Source file: portable.env | `general` |
| 58 | `Pre-Calculated Background Cache.md` | `document` | Documentation: Pre-Calculated Background Cache.md | `documentation` |
| 59 | `productResolver.ts` | `file` | Source file: productResolver.ts | `general` |
| 60 | `PROJECT_AUDIT.md` | `document` | Documentation: PROJECT_AUDIT.md | `documentation` |
| 61 | `python/scan_nlp/requirements.txt` | `file` | Source file: requirements.txt | `general` |
| 62 | `README.md` | `document` | Documentation: README.md | `documentation` |
| 63 | `real_eval.ts` | `file` | Source file: real_eval.ts | `general` |
| 64 | `requirements.txt` | `file` | Source file: requirements.txt | `general` |
| 65 | `scan_benchmark.ts` | `file` | Source file: scan_benchmark.ts | `general` |
| 66 | `scanGateAlgorithms.ts` | `file` | Source file: scanGateAlgorithms.ts | `general` |
| 67 | `scratch/verify-isolation.mjs` | `file` | Source file: verify-isolation.mjs | `general` |
| 68 | `sea-config.json` | `config` | Configuration: sea-config.json | `config` |
| 69 | `sea-entry.cjs` | `file` | Source file: sea-entry.cjs | `general` |
| 70 | `src/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 71 | `src/bootstrap.ts` | `file` | Source file: bootstrap.ts | `general` |
| 72 | `src/config/index.ts` | `file` | Source file: index.ts | `general` |
| 73 | `src/database.ts` | `file` | Source file: database.ts | `general` |
| 74 | `src/database/connection.ts` | `file` | Source file: connection.ts | `general` |
| 75 | `src/database/messageDAO.ts` | `file` | Source file: messageDAO.ts | `general` |
| 76 | `src/database/migrations/002_message_tables.sql` | `file` | SQL migration: 002_message_tables.sql | `migration` |
| 77 | `src/database/migrations/003_license_settings.sql` | `file` | SQL migration: 003_license_settings.sql | `migration` `auth` |
| 78 | `src/database/sqlitePatch.ts` | `file` | Source file: sqlitePatch.ts | `general` |
| 79 | `src/extractor.ts` | `file` | Source file: extractor.ts | `general` |
| 80 | `src/i18n/getMessage.ts` | `file` | Source file: getMessage.ts | `general` |
| 81 | `src/i18n/messages.json` | `config` | Configuration: messages.json | `config` |
| 82 | `src/process/processGuardian.ts` | `file` | Source file: processGuardian.ts | `general` |
| 83 | `src/server.ts` | `file` | Source file: server.ts | `general` |
| 84 | `src/telegramBot.ts` | `file` | Source file: telegramBot.ts | `telegram` |
| 85 | `src/utils/activityTracker.ts` | `file` | Source file: activityTracker.ts | `general` |
| 86 | `src/utils/dateExtractor.ts` | `file` | Source file: dateExtractor.ts | `general` |
| 87 | `src/utils/distributorSyncHelper.ts` | `file` | Source file: distributorSyncHelper.ts | `general` |
| 88 | `src/utils/doctorUtils.ts` | `file` | Source file: doctorUtils.ts | `general` |
| 89 | `src/utils/emailSanitizer.ts` | `file` | Source file: emailSanitizer.ts | `email` |
| 90 | `src/utils/inventoryActive.ts` | `file` | Source file: inventoryActive.ts | `general` |
| 91 | `src/utils/lazyPuppeteer.ts` | `file` | Source file: lazyPuppeteer.ts | `general` |
| 92 | `src/utils/logger.ts` | `file` | Source file: logger.ts | `general` |
| 93 | `src/utils/migrationDistributorHelpers.ts` | `file` | Source file: migrationDistributorHelpers.ts | `migration` |
| 94 | `src/utils/migrationInventoryHelpers.ts` | `file` | Source file: migrationInventoryHelpers.ts | `migration` |
| 95 | `src/utils/migrationMeta.ts` | `file` | Source file: migrationMeta.ts | `migration` |
| 96 | `src/utils/migrationStockRebuild.ts` | `file` | Source file: migrationStockRebuild.ts | `migration` |
| 97 | `src/utils/migrationUtils.ts` | `file` | Source file: migrationUtils.ts | `migration` |
| 98 | `src/utils/migrationValidation.ts` | `file` | Source file: migrationValidation.ts | `migration` |
| 99 | `src/utils/nameNormalizer.ts` | `file` | Source file: nameNormalizer.ts | `general` |
| 100 | `src/utils/networkDetector.ts` | `file` | Source file: networkDetector.ts | `general` |
| 101 | `src/utils/notifications.ts` | `file` | Source file: notifications.ts | `general` |
| 102 | `src/utils/packaging.ts` | `file` | Source file: packaging.ts | `general` |
| 103 | `src/utils/password.ts` | `file` | Source file: password.ts | `general` |
| 104 | `src/utils/pdfGenerator.ts` | `file` | Source file: pdfGenerator.ts | `general` |
| 105 | `src/utils/preMigrationIntelligence.ts` | `file` | Source file: preMigrationIntelligence.ts | `general` |
| 106 | `src/utils/reportCutover.ts` | `file` | Source file: reportCutover.ts | `general` |
| 107 | `src/utils/reportExporter.ts` | `file` | Source file: reportExporter.ts | `general` |
| 108 | `src/utils/retry.ts` | `file` | Source file: retry.ts | `general` |
| 109 | `src/utils/stockRebuild.ts` | `file` | Source file: stockRebuild.ts | `general` |
| 110 | `src/utils/validateStagingDatabase.ts` | `file` | Source file: validateStagingDatabase.ts | `general` |
| 111 | `src/whatsappClient.ts` | `file` | Source file: whatsappClient.ts | `whatsapp` |
| 112 | `tools/migration-extractor/index.js` | `file` | Source file: index.js | `migration` |
| 113 | `tools/migration-extractor/package.json` | `config` | Configuration: package.json | `config` `migration` |
| 114 | `tools/migration-extractor/scripts/buildBundle.cjs` | `file` | Source file: buildBundle.cjs | `migration` |
| 115 | `tools/migration-extractor/scripts/buildSea.cjs` | `file` | Source file: buildSea.cjs | `migration` |
| 116 | `tools/migration-extractor/sea-config.json` | `config` | Configuration: sea-config.json | `config` `migration` |
| 117 | `trigger_reload.mjs` | `file` | Source file: trigger_reload.mjs | `general` |
| 118 | `tsconfig.json` | `config` | Configuration: tsconfig.json | `config` |

## Node Type Breakdown

| Type | Count | Example |
|---|---|---|
| `file` | 309 | `bootstrapper/main.ts` |
| `document` | 119 | `.agents/rules/bug-fix.md` |
| `test` | 60 | `tests/aiCamera.test.ts` |
| `service` | 59 | `src/services/activityTracker.ts` |
| `config` | 21 | `.opencode/config.json` |

## Dependency Graph (imports)

Edges represent `import`/`require` relationships detected in source (resolve-based, first 50 lines). Only edges whose source and target exist as documented nodes are shown.

### Most Imported Modules (top 30 dependents)

| Imported By Count | Module |
|---|---|
| 44 | `frontend/src/services/api.ts` |
| 22 | `frontend/src/utils/date.ts` |
| 21 | `pharmacy-mobile/lib/theme.ts` |
| 18 | `frontend/src/services/events.ts` |
| 15 | `frontend/src/hooks/useApiQuery.ts` |
| 13 | `pharmacy-mobile/lib/api.ts` |
| 10 | `frontend/src/utils/cacheInvalidation.ts` |
| 8 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` |
| 8 | `frontend/src/utils/phone.ts` |
| 7 | `frontend/src/hooks/usePersistedDateRange.ts` |
| 6 | `frontend/src/hooks/useInfiniteScroll.ts` |
| 6 | `frontend/src/utils/export.ts` |
| 5 | `frontend/src/utils/settingsSync.ts` |
| 5 | `frontend/src/hooks/useVirtualizer.ts` |
| 5 | `frontend/src/components/InfiniteTable.tsx` |
| 5 | `frontend/src/components/VirtualRow.tsx` |
| 5 | `frontend/src/components/InfiniteScrollStatus.tsx` |
| 5 | `pharmacy-mobile/lib/secureStore.ts` |
| 5 | `frontend/src/components/PhoneInputWithBadge.tsx` |
| 4 | `frontend/src/hooks/useOnClickOutside.ts` |
| 4 | `frontend/src/components/UniversalMedicineEditModal.tsx` |
| 4 | `frontend/src/hooks/useDeferredEffect.ts` |
| 3 | `frontend/src/services/stagedQueueService.ts` |
| 3 | `frontend/src/hooks/useFetchMode.ts` |
| 3 | `frontend/src/components/DateRangeFilter.tsx` |
| 3 | `frontend/src/services/keyboardShortcuts.ts` |
| 2 | `frontend/src/lib/queryClient.ts` |
| 2 | `frontend/src/utils/orderFuzzyMatcher.ts` |
| 2 | `frontend/src/services/dataFetchControl.ts` |
| 2 | `frontend/src/utils/pageModuleCaches.ts` |

### Most Dependent Sources (top 20 importing modules)

| Imports | Module |
|---|---|
| 14 | `frontend/src/pages/POS/index.tsx` |
| 13 | `frontend/src/pages/Purchases/index.tsx` |
| 13 | `frontend/src/pages/Sells/index.tsx` |
| 13 | `frontend/src/pages/Settings/index.tsx` |
| 12 | `frontend/src/pages/Inventory/index.tsx` |
| 11 | `frontend/src/pages/PurchaseHistory/index.tsx` |
| 10 | `frontend/src/pages/Investigation/index.tsx` |
| 9 | `frontend/src/pages/CustomerReturnHistory/index.tsx` |
| 8 | `frontend/src/pages/Learning/index.tsx` |
| 7 | `frontend/src/pages/CRM/index.tsx` |
| 7 | `frontend/src/pages/PharmarackCart/index.tsx` |
| 6 | `frontend/src/pages/Dispatch/index.tsx` |
| 6 | `frontend/src/pages/Expiry/index.tsx` |
| 6 | `frontend/src/pages/Mail/index.tsx` |
| 6 | `frontend/src/pages/Returns/index.tsx` |
| 5 | `frontend/src/App.tsx` |
| 5 | `frontend/src/pages/Database/index.tsx` |
| 5 | `pharmacy-mobile/app/(tabs)/index.tsx` |
| 5 | `pharmacy-mobile/app/(tabs)/inventory/index.tsx` |
| 5 | `pharmacy-mobile/app/_layout.tsx` |

## Automation and Background Timers

Services and workers that scan files for repeated-interval, cron, or background-loop behaviour. Intervals are summarized from the file inventory; confirm exact values in source.

| Service | Path |
|---|---|
| backupRecoveryService.ts | `src/services/backupRecoveryService.ts` |
| backupService.ts | `src/services/backupService.ts` |
| bouncedAlertService.ts | `src/services/bouncedAlertService.ts` |
| expiryAlertService.ts | `src/services/expiryAlertService.ts` |
| messagingQueue.ts | `src/services/messagingQueue.ts` |
| ocrScanQueue.ts | `src/services/ocrScanQueue.ts` |
| pharmarackDailyDispatchService.ts | `src/services/pharmarackDailyDispatchService.ts` |
| shortageReminderService.ts | `src/services/shortageReminderService.ts` |
| tokenRefreshScheduler.ts | `src/services/tokenRefreshScheduler.ts` |
| whatsappQueue.ts | `src/services/whatsappQueue.ts` |
| whatsappQueueWorker.ts | `src/services/whatsappQueueWorker.ts` |

## Configuration & Environment

| Type | Count |
|---|---|
| Config nodes (json/yml/env) | 21 |

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
_Generated at 2026-08-09T17:38:21.910Z._