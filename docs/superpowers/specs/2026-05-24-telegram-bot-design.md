---
name: telegram-bot-design
description: Design specification for a Telegram bot that reports product availability and alternatives for medicines in the pharmacy.
metadata:
  type: project
---

# Telegram Bot Design Specification

**Date:** 2026‑05‑24

## Overview
The bot will run as a background service and respond to user commands in Telegram. Its primary purpose is to inform pharmacy staff or customers whether a requested medicine is in stock and, if not, suggest an alternative product along with its MRP and quantity.

## Goals
- Provide **instant availability** lookup for a medicine name or code.
- Return **only**: stock flag, MRP, quantity, and a single alternative (if out of stock).
- Keep the bot lightweight and secure; no sensitive data is exposed.
- Operate on a **daily/weekly/monthly schedule** only if future reporting is added – not required for the current availability feature.

## Functional Requirements
1. **Command** `/check <medicine>` – returns availability info.
2. **Response format** (plain‑text, Telegram‑friendly):
   - When in stock: `"<Medicine> – available\n- MRP: ₹ <price> per unit\n- Quantity in stock: <qty> units"`
   - When out of stock: same as above with `"out of stock"` and an *alternative* line.
3. **Data source** – the existing `mockDb` JSON used by the web app (e.g., `mockDb.json` or similar). The bot reads this file at runtime.
4. **Alternative lookup** – each medicine may have an optional `alternative` field in the DB. If missing, the bot returns “No alternative available”.
5. **Error handling** – unrecognized medicine → reply with a helpful hint.

## Non‑Functional Requirements
- **Security**: Telegram bot token read from environment variable `TELEGRAM_BOT_TOKEN`; never hard‑coded.
- **Performance**: Load the DB into memory once at start; subsequent lookups are O(1).
- **Reliability**: Simple retry logic for file read errors; log to console.
- **Scalability**: Designed as a single Node.js process; can be containerised later.

## Bot Commands
| Command | Description | Example |
|---------|-------------|----------|
| `/check <name>` | Look up a medicine by its common name (case‑insensitive). | `/check paracip` |
| `/help` | Show usage help. | `/help` |

## Data Model (extension to existing `mockDb`)
```json
{
  "medicines": [
    {
      "id": "paracip",
      "name": "Paracetamol",
      "mrp": 24.0,
      "quantity": 120,
      "alternative": {
        "id": "acetoflex",
        "name": "Acetoflex",
        "mrp": 26.0,
        "quantity": 45
      }
    }
    // … other entries …
  ]
}
```
- Only `mrp` and `quantity` are required for the bot.
- `alternative` is optional.

## Architecture & Data Flow
1. **Startup** – read `TELEGRAM_BOT_TOKEN`, load `mockDb.json` into a JavaScript Map keyed by lower‑cased medicine name.
2. **Message handler** – on `/check <name>`:
   - Normalize `<name>`.
   - Lookup in the map.
   - If found and `quantity > 0` → build *available* response.
   - If `quantity === 0` and `alternative` present → build *out‑of‑stock* response with alternative details.
   - If not found → send *not recognized* reply.
3. **Logging** – console.log each request with timestamp for audit.
4. **Graceful shutdown** – handle SIGINT/SIGTERM to close the bot cleanly.

## Scheduling / Future Extensions
- The current spec covers **on‑demand** checks only.
- If periodic reports (daily/weekly) are added later, a separate cron job can invoke the same lookup logic and push a pre‑formatted message to a configured chat ID.

## Security Considerations
- Store the bot token **only** in environment variable; do not commit to repo.
- Validate incoming messages are from the expected chat (optional whitelist).
- No user‑provided data is persisted.

## Testing Strategy
- Unit tests for the lookup function (inputs → formatted strings).
- Mock the Telegram API using `node-telegram-bot-api` test utilities.
- Integration test with a local bot token (use BotFather test token).

## Deployment Notes
- Add a `start` script in `package.json`:
  ```json
  "scripts": { "bot": "node telegram-bot/index.js" }
  ```
- Deploy on any Node‑compatible host (e.g., Railway, Render, or a simple VM). Ensure the environment variable is set.

---

**Next steps**
1. Review this spec and request any changes.
2. Once approved, I will create an implementation plan (writing‑plans skill) and proceed with development.
