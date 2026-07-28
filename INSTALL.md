# AI Pharmacy OS — Installation Guide

## Requirements

| Component | Minimum |
|-----------|---------|
| Windows   | 10 / 11 (64-bit) |
| RAM       | 4 GB (8 GB recommended) |
| Disk      | 1 GB free space |
| Port      | 5174 must be free |

---

## Quick Install (Recommended)

1. Run **`AI-Pharmacy-OS-Setup-v0.1.0.exe`** as Administrator
2. Accept the license and choose install folder (default: `C:\Program Files\AI Pharmacy OS`)
3. Click **Install**
4. After install, tick **"Launch AI Pharmacy OS server"**
5. Open your browser at **http://localhost:5174**

---

## What Gets Installed

```
C:\Program Files\AI Pharmacy OS\
├── PharmacyOS.exe              ← Main server (Node.js bundled)
├── better_sqlite3.node         ← SQLite native addon
├── eng.traineddata             ← Tesseract OCR language data
├── .env                        ← Environment config (editable)
├── data\
│   ├── app.db                  ← SQLite database (your data)
│   └── reference_medicines.csv ← Medicine reference data
├── uploads\                    ← Invoice scans & attachments
├── INSTALL.md                  ← This file
├── README.md
└── license.txt
```

---

## First Run

The server starts on **http://localhost:5174** automatically.

- Login is **skipped** by default (`SKIP_AUTH=true` in `.env`)
- To enable authentication, edit `.env` and set `SKIP_AUTH=false`
  then add your Google OAuth credentials

### Checking the server is running

Open a browser and visit:
```
http://localhost:5174
```

Or run from the Start Menu shortcut **"Open in Browser"**.

---

## Configuration (`.env`)

Located at `C:\Program Files\AI Pharmacy OS\.env`

```env
PORT=5174             # Port the server listens on
NODE_ENV=production   # Environment mode
SKIP_AUTH=true        # Set to false to enable Google login

# Optional — Google OAuth (only needed if SKIP_AUTH=false)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

# Optional — AI/OCR features
SCISPACY_ENABLED=true
```

Restart `PharmacyOS.exe` after editing `.env` for changes to take effect.

---

## Starting / Stopping the Server

### Start
Double-click the **AI Pharmacy OS** shortcut on the Desktop or Start Menu.

### Stop
Right-click the taskbar → Task Manager → find **PharmacyOS** → End Task.

### Auto-start on Windows boot
Re-run the installer and tick **"Start server on Windows startup"** during setup.

---

## Updating

1. Run the new `AI-Pharmacy-OS-Setup-vX.Y.Z.exe`
2. The installer will detect an existing install and upgrade in-place
3. Your `data\app.db` and `.env` are **never overwritten** on update

---

## Uninstalling

**Control Panel → Programs → AI Pharmacy OS → Uninstall**

> ⚠️ Your database (`data\app.db`) and uploads are preserved after uninstall.
> Delete the install folder manually if you want a full clean removal.

---

## Troubleshooting

### "Port 5174 already in use"
Find and stop the conflicting process:
```powershell
netstat -ano | findstr :5174
taskkill /PID <pid> /F
```

### Server crashes immediately
Check the console output by running from Command Prompt:
```cmd
"C:\Program Files\AI Pharmacy OS\PharmacyOS.exe"
```

### Database errors
Ensure `data\app.db` exists and is not locked by another process.
The WAL files (`app.db-shm`, `app.db-wal`) are created automatically.

### OCR not working
Confirm `eng.traineddata` is present in the install folder.

---

## Build From Source

```powershell
# Clone
git clone https://github.com/loki94in/AI-PHARMACY-v2.git
cd AI-PHARMACY-v2

# Install dependencies
npm install

# Compile TypeScript
npm run build

# Package to exe
npx pkg . --targets node18-win-x64 --output dist\PharmacyOS.exe

# Build installer (requires Inno Setup 6)
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Output: `dist\installer\AI-Pharmacy-OS-Setup-v0.1.0.exe`

---

## License

See `license.txt` in the install directory.
