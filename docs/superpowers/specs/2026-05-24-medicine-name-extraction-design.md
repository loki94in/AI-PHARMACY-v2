# Medicine Name Extraction Design

## Overview
Add a hybrid CLI + background‑worker pipeline that scans a configurable `catalog/` directory for PDF and CSV files, extracts medicine names (and any API URL found in the file), and stores the unique pairs in a new SQLite table `medicines(name TEXT, api_reference TEXT)`. The system uses a SQLite‑based job queue (`catalog_jobs`) and a `processed_files` table for idempotency.

## Architecture
1. **Enqueue CLI** – `npm run enqueue-catalog` scans the folder and inserts each file path into `catalog_jobs`.
2. **Worker** – `npm run worker` continuously pulls pending jobs, calls the existing `extractFromPdf` / `extractFromCsv` helpers, extracts an API URL using a simple regex, and UPSERTs the data into `medicines`.
3. **Optional watcher** – `npm run watch-catalog` watches the folder and automatically enqueues new files.
4. **Database schema** – Three tables: `medicines`, `catalog_jobs`, `processed_files`. All created lazily by `ensureSchema`.

## Data Flow
```
Catalog folder (PDF/CSV) → Enqueue CLI → catalog_jobs table → Worker → extractors → medicines table
```

## Error Handling & Idempotency
* `INSERT OR IGNORE` prevents duplicate job entries.
* `processed_files` records the last processed timestamp.
* Job status column tracks `pending`, `processing`, `done`, `failed`.

## Testing Strategy
* Unit tests for `ensureSchema` and enqueue script.
* Integration test that creates a small CSV, runs enqueue, starts worker, and verifies rows in `medicines`.
* Jest framework with `ts-jest`.

## Running the Pipeline
1. Place PDF/CSV files under `catalog/`.
2. Enqueue jobs: `npm run enqueue-catalog`.
3. Start the worker (or optional watcher): `npm run worker` (or `npm run watch-catalog`).
4. Verify results in SQLite DB at `data/app.db` (e.g., using `sqlite3 data/app.db "SELECT * FROM medicines;"`).

## Open Issues
* The simple API‑URL regex may need refinement for complex formats.
* Large catalogs may benefit from batch processing or pagination (future improvement).
