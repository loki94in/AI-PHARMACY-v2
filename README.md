# AI Pharmacy OS

> A full-featured, offline-first pharmacy management system powered by AI — built for Indian retail pharmacies.

---

## Features

- 🧾 **POS / Billing** — Fast invoice generation with medicine autocomplete
- 📦 **Inventory Management** — Stock tracking, expiry alerts, batch management
- 🛒 **Purchases** — Purchase orders, supplier management, GRN workflow
- 👥 **CRM** — Customer profiles, credit management, purchase history
- 📊 **Reports** — Sales, purchases, non-moving stock, expiry, GST reports
- 🤖 **AI OCR** — Scan prescriptions and invoices using Tesseract + SciSpaCy
- 📧 **Email Integration** — Auto-fetch purchase invoices from Gmail/IMAP
- 💬 **WhatsApp Bot** — Order queries, bill sharing via WhatsApp Web
- 🚚 **Dispatch** — Delivery boy management and order dispatch tracking
- 📋 **Learning** — OCR correction and medicine alias training

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + TypeScript |
| Database | SQLite (better-sqlite3) |
| Frontend | React + Vite + Tailwind CSS |
| OCR | Tesseract.js + SciSpaCy (Python) |
| Packaging | esbuild bundle + Node SEA (Single Executable Application) |
| Installer | Inno Setup 6 |

---

## Getting Started (Development)

### Prerequisites

- Node.js 18+
- npm 9+
- Windows 10/11 (for full feature support)

### Install & Run

```powershell
# 1. Clone the repo
git clone https://github.com/loki94in/AI-PHARMACY-v2.git
cd "AI-PHARMACY-v2"

# 2. Install backend dependencies
npm install

# 3. Install frontend dependencies
npm install --prefix frontend

# 4. Start backend (port 3000)
npm start

# 5. Start frontend dev server (port 5173)
npm run dev --prefix frontend
```

Open **http://127.0.0.1:5173** in your browser.

> Login is bypassed by default (`SKIP_AUTH=true`). See [Configuration](#configuration).

---

## Configuration

Edit `.env` in the project root (copy from `.env.example`):

```env
PORT=3000               # Backend server port
NODE_ENV=development    # development | production
SKIP_AUTH=true          # true = no login required (testing)

# Google OAuth — only needed when SKIP_AUTH=false
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

# AI/OCR
SCISPACY_ENABLED=true
```

---

## Building the Windows Installer

```powershell
# 1. Build the frontend, compile TypeScript, bundle with esbuild, and produce
#    the single-file exe via Node SEA (Single Executable Application)
npm run build:exe

# 2. Compile the Inno Setup installer
#    Requires: https://jrsoftware.org/isinfo.php
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Output: `dist\installer\AI-Pharmacy-OS-Setup-v0.1.0.exe`

See [INSTALL.md](INSTALL.md) for full installation instructions.

---

## Project Structure

```
AI PHARMACY v2/
├── src/                  # Backend TypeScript source
│   ├── routes/           # Express API routes
│   ├── services/         # Business logic
│   └── server.ts         # Entry point
├── frontend/             # React + Vite SPA
│   └── src/
│       └── pages/        # Page components (POS, Inventory, etc.)
├── data/                 # SQLite databases & reference data
├── uploads/              # Invoice scans & attachments
├── dist/                 # Compiled output + PharmacyOS.exe
├── installer.iss         # Inno Setup script
├── INSTALL.md            # End-user install guide
└── .env                  # Environment config
```

---

## License

See [license.txt](license.txt).
