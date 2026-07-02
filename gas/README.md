# GAS License Server — Setup Guide

## Google Sheet Schema (Sheet named "Licenses")

| Col | Header | Example | Notes |
|-----|--------|---------|-------|
| A | key_id | K001 | Internal ID |
| B | license_key | AIPH-7K2M-9NP4-3RT8 | What you give the customer |
| C | customer_name | City Pharmacy | |
| D | issued_date | 2026-05-30 | |
| E | expiry_date | 2027-05-30 | Annual |
| F | machine_id | (blank until first activation) | Set by server on activation |
| G | current_nonce | (blank until activation) | Rotated every daily ping |
| H | last_ping | 2026-05-30T07:00:00Z | |
| I | reactivation_count | 0 | Max 3 |
| J | is_active | TRUE | Set FALSE to instantly revoke |

## Script Properties to Set

In Apps Script → Project Settings → Script Properties:

| Key | Value |
|-----|-------|
| `SERVER_SECRET` | A long random string you choose (keep secret) |
| `DOWNLOAD_URL` | Your Google Drive direct download link for PharmacyOS.exe |
| `BUILD_CONSTANT` | Must match `LICENSE_BUILD_CONSTANT` in your `.env` |

## Deployment Steps

1. Open [script.google.com](https://script.google.com)
2. Create new project → paste `licenseServer.js` contents
3. Set Script Properties (above)
4. Deploy → New deployment → Web App
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the Web App URL
6. Add to your `.env`: `LICENSE_SERVER_URL=https://script.google.com/macros/s/...`

## Adding a License Key

Add a row to the Google Sheet:
- key_id: K001
- license_key: AIPH-XXXX-XXXX-XXXX (generate with any random alphanumeric)
- customer_name: Their name
- issued_date: Today
- expiry_date: One year from today
- machine_id: (leave blank — set on first activation)
- reactivation_count: 0
- is_active: TRUE

## Revoking a Key

Set column J (`is_active`) to `FALSE`. The app will block at the next daily ping (within 24 hours).

## Resetting a Machine Binding

Set column F (`machine_id`) to blank and column I (`reactivation_count`) to 0. The next activation will bind to the new machine.
