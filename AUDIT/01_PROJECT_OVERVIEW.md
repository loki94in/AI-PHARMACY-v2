# 🏥 AI Pharmacy OS — Project Overview

> **Audited**: June 15, 2026  
> **Version**: 0.1.0 (OS Version 2.0)  
> **Stack**: Express.js 5 + SQLite (better-sqlite3) + React 19 (Vite) + React Native Expo (Mobile)  
> **Lines of Code**: ~15,000+ (backend) + ~8,000+ (frontend) + ~3,000+ (mobile)

---

## What This Project Is

AI Pharmacy is a **complete pharmacy management operating system** designed to run locally on a single Windows machine. It replaces traditional pharmacy software with an AI-powered, offline-first system.

It handles everything a real pharmacy needs — from point-of-sale billing to inventory tracking, purchase management, supplier returns, patient CRM, automated notifications, and data migration from legacy systems.

---

## All Features

| Module | Description |
|--------|-------------|
| **Sales / POS** | Point-of-sale with medicine search, batch selection, tax calculation, bill hold/restore, invoice PDF generation |
| **Inventory Management** | Full stock tracking by medicine + batch + expiry, loose quantity support, rack location mapping |
| **Purchase Management** | Purchase bill creation (manual + automated from email), distributor management, price history tracking |
| **Medicine Database** | Master catalog with 30+ fields per medicine (composition, manufacturer, packaging, HSN, GST rates, schedule type) |
| **Catalog Upload & Import** | Bulk medicine import from CSV/PDF/Excel with AI-powered column mapping and duplicate detection |
| **Supplier Returns** | Near-expiry scanner, return processing, credit note tracking & reconciliation |
| **Customer Returns** | Invoice lookup, item-level returns with inventory restocking |
| **CRM / Patients** | Patient database, credit balance tracking, purchase history |
| **Doctors Database** | Doctor profiles for prescription compliance logging |
| **Email Integration** | IMAP inbox polling, distributor email parsing, attachment extraction for purchase auto-import |
| **WhatsApp Integration** | Invoice sharing via WhatsApp (both personal via whatsapp-web.js and Official Business API) |
| **Telegram Bot** | Prescription photo OCR via Telegram, pharmacy notifications |
| **AI Camera / OCR** | On-device OCR using Tesseract.js + ONNX Runtime (PaddleOCR), scanned PDF fallback |
| **Composition Enrichment** | Auto-fetch medicine compositions from online APIs with local caching |
| **Expiry Monitor** | Automated near-expiry scanning with WhatsApp/Telegram alerts (every 15 days) |
| **Patient Refills** | Automated refill reminders with stock-aware notifications |
| **Dispatch Management** | Home delivery orders with delivery boy assignment and status tracking |
| **Data Migration** | Import from legacy pharmacy systems (PostgreSQL copy format, CSV, Excel, ZIP archives) |
| **Pharmarack Integration** | Search and cart integration with India's largest pharma distribution platform |
| **Reports** | Sales reports, non-moving stock analysis, purchase summaries |
| **Compliance Logging** | Schedule H/H1 drug register maintenance |
| **Backup & Restore** | Automated backup scheduling (3h/6h), nightly 9:30 PM backup, shutdown auto-backup |
| **Mobile App** | React Native Expo app for offline sales and purchase sync |
| **Push Notifications** | Server-Sent Events (SSE) + push notification token registry |
| **License System** | License activation and session token authentication |

---

## Key Statistics

| Metric | Value |
|--------|-------|
| **Total API Route Modules** | 33 |
| **Total Service Modules** | 26 |
| **Total Frontend Pages** | 24 |
| **Total Database Tables** | 30+ |
| **Total Test Files** | 18 |
| **Background Workers** | 3 (catalog, email, migration) |
| **External Integrations** | 6 (WhatsApp ×2, Telegram, IMAP, Pharmarack, OpenFDA) |
| **Cron Jobs** | 4 scheduled tasks |
| **Estimated Idle RAM** | ~105-140 MB |
| **Database Type** | SQLite (single file, WAL mode) |
