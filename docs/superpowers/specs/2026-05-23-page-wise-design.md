---
name: page-wise-design
description: Detailed page‑wise feature mapping for Pharmacy Genius OS.
metadata:
  type: project
---

# Page‑wise Feature Mapping (Detailed)

## 1. POS Billing (Main Counter) – Page 1
* **Core UI:** Barcode input, AI‑vision Scan button, free‑text entry, patient & doctor selectors, discount fields, Hold Bill, Undo/Reverse, Save Bill, total panel.
* **Features:**
  * Manual barcode/text entry (always on).
  * **AI‑Camera OCR** – captures product image, runs Tesseract OCR, fuzzy‑matches; gated by `ai_camera` flag.
  * **Smart‑Hover** – shows historical purchase margin (always on).
  * **Hold Bill** – queues current bill for later (always on).
  * **Learning Engine suggestions** – sidebar shows doctor‑wise suggestions when `learning_engine` flag is true.
* **Feature‑Flag dependencies:** `ai_camera`, `learning_engine`.

## 2. Dashboard (Command Center) – Page 2
* KPI cards (sales, profit, low‑stock), backup status, pending tasks.
* All features always on.

## 3. Inventory Management (Stock Master) – Page 3
* Table: Name, Composition, Qty, Rack/Bin, Batch, Expiry, Reorder Level.
* CRUD, low‑stock highlights – always on.

## 4. Purchases (Distributor Billing) – Page 4
* Manual invoice entry grid, **Rate Comparison Engine**, **Generate Barcodes**.
* When `email_parser` flag is true, an **Import from Email** button appears.
* **Feature‑Flag:** `email_parser`.

## 5. Returns & Expiry (Correction Page) – Page 5
* Tabs for Customer Returns & Distributor Returns, credit/debit notes generation.
* **AI‑Camera batch scan** for expired strips when `ai_camera` flag is true.
* **Feature‑Flag:** `ai_camera`.

## 6. Orders & Special Requests – Page 6
* Form to log out‑of‑stock requests, status tracking.
* Auto‑create from email when `email_parser` flag is true.
* **Feature‑Flag:** `email_parser`.

## 7. Expiry Monitor – Page 7
* List of items expiring within 90 days, colour‑coded alerts.
* When `whatsapp` flag is true, daily summary can be sent via WhatsApp.
* **Feature‑Flag:** `whatsapp`.

## 8. CRM / Customer History – Page 8
* Patient profile, purchase history, refill schedule.
* Automated refill reminders via WhatsApp when `whatsapp` flag is true.
* **Feature‑Flag:** `whatsapp`.

## 9. Reports & Analytics – Page 9
* Report selector (Financial, GST, Distributor Performance), date range, PDF generation.
* Optional `cloud_export` flag can push PDFs to cloud storage.
* **Feature‑Flag (optional):** `cloud_export`.

## 10. Email Parser (Gmail Integration) – Page 10
* Settings for Gmail credentials, polling interval, test connection, log view.
* Background email watcher active only when `email_parser` flag is true.
* **Feature‑Flag:** `email_parser`.

## 11. Migration Tool (Data Bridge) – Page 11
* CSV/Excel uploader, column‑mapping wizard, validation, execute migration.
* Always on (one‑time utility).

## 12. Barcode & Label Generator – Page 12
* Grid of items, label preview, Export PDF / Print.
* Dynamic templates when optional `custom_labels` flag is true.
* **Feature‑Flag (optional):** `custom_labels`.

## 13. Safety & Backup – Page 13
* Manual Backup Now button, schedule indicator, list of backup files, restore dialog.
* Hourly automatic backup always runs.
* Cloud upload to Telegram when `cloud_backup` flag is true.
* **Feature‑Flag:** `cloud_backup`.

## 14. Settings & Preferences – Page 14
* Theme picker, Feature‑Flag toggles, automation timings, WhatsApp templates, encryption key.
* Direct manipulation of all flags – always on.

## 15. Support & Logistics Dispatch – Page 15
* Log table, Export Logs, Dispatch wizard to send WhatsApp messages.
* Automated dispatch when `whatsapp` flag is true.
* **Feature‑Flag:** `whatsapp`.

## 16. Archive & Purge – Page 16
* Slider for age threshold (default 3 years), Run Archive button, progress bar, summary.
* Preserves Schedule H1/Narcotic rows when `legal_register` flag is true.
* **Feature‑Flag:** `legal_register`.

## 17. Legal & Compliance Register – Page 17
* Read‑only audit grid, Add Entry modal that forces Doctor ID, License, Patient ID.
* Mandatory doctor‑ID enforcement in POS when `legal_register` flag is true.
* **Feature‑Flag:** `legal_register`.

## 18. Intelligent Clinical Learning Engine – Page 18
* Settings for learning sensitivity, per‑doctor usage stats, Refresh Model button.
* Sidebar suggestions in POS when `learning_engine` flag is true.
* **Feature‑Flag:** `learning_engine`.

## 19. Messaging Hub – Page 19
* WhatsApp template editor, recipient selector, Send Test Message, outbound log.
* All WhatsApp‑based notifications (expiry alerts, refill reminders, dispatches) route through here.
* Visible only when `whatsapp` flag is true.
* **Feature‑Flag:** `whatsapp`.

---
*Please review this specification. If everything looks correct, I will proceed to generate the implementation plan.*