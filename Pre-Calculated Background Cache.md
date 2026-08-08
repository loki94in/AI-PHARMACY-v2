# ENGINEERING SPECIFICATION: EVENT-DRIVEN PRE-CALCULATED BACKGROUND CACHE
# SYSTEM PATH: AI PHARMACY v2 (OFFLINE-FIRST PHARMACY OS)
# HARDWARE CONSTRAINT: INTEL i3 3RD-GEN (2 CORES, 4 THREADS, HDD, NO AVX2) [5]
# TARGET RUNTIME LATENCY: <5ms PAGE LOAD & MODAL OPEN, <15ms FULL SYNC [RC-1, RC-2]

================================================================================
1. ARCHITECTURAL OVERVIEW
================================================================================
The "Pre-Calculated Background Cache" decouples physical visual rendering from data math computation [6, 7]. 
Instead of recalculating stock metrics, purchase-to-sell ratios, and shortage orders in the browser upon tab-switching or modal-opening, the system pre-computes every metric on the backend whenever data changes (Write Interceptor) [RC-3, 152].

The backend saves the final, fully-resolved math into a specialized cached table. When a user navigates to a heavy page or opens the "Add to Live Cart" popup, the client launches a SINGLE, flat HTTP GET request that reads the calculated answers directly from SQLite in-memory tables in <2ms, bypassing all CPU-bound calculations on the frontend [RC-1, RC-2, RC-3].

[DATABASE WRITE EVENT] (POS, Purchases, Adjustments) [8, 9]
       │
       ▼
[SQLITE WRITE INTERCEPTOR] (Detects mutated Medicine IDs) [10]
       │
       ▼
[BACKGROUND WORKER TRIGGER] (Enqueues targeted calculation job) [1, 2]
       │
       ▼
[stockCalculatorWorker.ts] (Processes 6-month sales velocity & ratios) [1, 2]
       │
       ▼
[precalculated_stock_metrics TABLE] (Saves flat JSON answers) [11]
       │
       ▼
[SSE NOTIFICATION BROADCAST] (Pushes "sales_sync" or "purchases_sync") [12]
       │
       ▼
[FRONTEND RAM HYDRATION] (Silent background refetch, zero-spinner load) [6, 7]

================================================================================
2. COMPONENT INPUT / OUTPUT (I/O) SPECIFICATIONS
================================================================================

--------------------------------------------------------------------------------
COMPONENT 2.1: SQLite Database Write Interceptor (Write-Trigger Gate)
--------------------------------------------------------------------------------
- Purpose: intercept any data write in the system and extract only the affected medicine IDs to prevent a full-database rebuild.
- Location: src/database.ts & src/database/connection.ts [10]
- Trigger Events: 
  * After INSERT/UPDATE/DELETE on "sale_items" [13]
  * After INSERT/UPDATE/DELETE on "purchase_items" [13]
  * After INSERT/UPDATE/DELETE on "inventory_master" [13]
- INPUTS:
  * Table Name (string)
  * Affected Row IDs (array of integers)
  * SQL Mutation Type ('INSERT' | 'UPDATE' | 'DELETE')
- WORKER PROCESS LOGIC:
  ```sql
  -- The write interceptor extracts unique medicine_ids from the write payload:
  SELECT DISTINCT medicine_id FROM inventory_master WHERE id IN (mutated_row_ids)
  UNION
  SELECT DISTINCT medicine_id FROM sale_items WHERE id IN (mutated_row_ids)
  UNION
  SELECT DISTINCT medicine_id FROM purchase_items WHERE id IN (mutated_row_ids);
OUTPUTS:
Mutated Medicine ID Array: affected_medicine_ids: number[] (e.g. 
)
Dispatched Signal: Trigger an async event to stockCalculatorWorker.ts containing the array.
COMPONENT 2.2: stockCalculatorWorker.ts (Targeted Calculations Engine)
Purpose: Performs heavy historical sales analysis, stock ratios, and predictive ordering math in the background.
Location: src/worker/stockCalculatorWorker.ts
INPUTS:
affected_medicine_ids: number[] (from Component 2.1)
Stored variables in app_settings (e.g., refill_notice_days, clinical_learning_sensitivity)
WORKER MATHEMATICAL EQUATIONS:
TOTAL UNITS POOL RESOLUTION
: Total live stock base units must treat packs/strips and loose items as a single fungible pool
. 
Total_Units_Pool=(inventory_master.quantity×medicines.pack_size)+inventory_master.loose_quantity
REORDER / LOW-STOCK CROSS-CHECK GATE
: Verify if the item has dipped below its designated safety threshold
. Low_Stock_Trigger_State = \begin{cases} 1 & \text{if } Total_Units_Pool \le inventory_master.reorder_level \ 0 & \text{otherwise} \end{cases}
6-MONTH SALES VELOCITY (BURN RATE)
: Analyze sales patterns over the last 180 days (6 months) to determine the item's rate of consumption. 
Daily_Sales_Velocity= 
180
∑ 
i=1
180
​
 Sale_Qty(i)
​
 
PURCHASE-TO-SELL SPEED RATIO
: Determine if the item qualifies as a "Heavy Sell" (moving out faster than it is procured). 
Average_Purchase_Lead_Time_Days=Average days between invoice arrivals for this ID
 
Burn_Rate_Ratio= 
Total_Units_Pool
Daily_Sales_Velocity×Average_Purchase_Lead_Time_Days
​
 
 Heavy_Sell_Trigger_State = \begin{cases} 1 & \text{if } Burn_Rate_Ratio \ge 1.2 \ 0 & \text{otherwise} \end{cases}
NEW MEDICINE COLD-START RATIO CALCULATOR
: For items with less than 30 days of sales history (no legacy data), dynamically establish pattern: 
Days_Since_First_Purchase=Current_Date−First_Purchase_Date
 
Micro_Velocity= 
Days_Since_First_Purchase
Total_Units_Sold_To_Date
​
 
 
Burn_Rate_Ratio 
new
​
 = 
Total_Units_Pool
Micro_Velocity×Default_Lead_Time_Days
​
 
DATABASE WRITE OUTPUTS (Writes to the cache table):
Target Table: precalculated_stock_metrics
JSON Columns Schema:
COMPONENT 2.3: Server-Sent Events (SSE) Live Sync Push
Purpose: Broadcasts a silent sync signal to the frontend the instant the background calculations table has been updated.
Location: src/routes/notifications.ts
INPUTS (Internal server method call):
Cache updated flag: cache_type: 'sales_sync' | 'purchases_sync'
Affected record count: count: number
OUTPUTS (Raw SSE HTTP Stream):
Content-Type: text/event-stream
Cache Control: no-cache
SSE Event Payload:
COMPONENT 2.4: Frontend Module-Level Cache & Keep-Alive Hydration
Purpose: Keeps the frontend pages fully cached in local computer RAM so that opening components is instant
.
Location: frontend/src/pages/POS/index.tsx, PharmarackCart/index.tsx
INPUTS:
Incoming SSE Stream: window.addEventListener('sales_sync', ...)
Single Endpoint Response: GET /api/pharmarack/auto-refill-suggestions
 (Returns the flat, pre-calculated table in <5ms)
FRONTEND STATE ACTION:
OUTPUTS:
Instant modal population: <5ms
Browser Main CPU Thread Block: 0ms (Zero JS mapping or calculation loops on render frame) [RC-3]
================================================================================3. THE 9-PAGE PRE-CALCULATED DATA-FLOW MAP
This architecture is applied across 9 heavy-lifting pages, transforming their operations
:
Pharmarack Cart (Live Cart)
OLD: Fetched all historical patient refills, checked stock, did Math.max
.
NEW: Reads precalculated_stock_metrics WHERE low_stock_flag = 1
.
Dashboard
OLD: Ran heavy SQL counts over years of historical sales invoices on cold boot
.
NEW: Reads SELECT count(*) FROM precalculated_stock_metrics WHERE low_stock_flag = 1.
POS (Point of Sale)
OLD: Ran recursive FEFO sorting and parsed expiry arrays on every single render keystroke [RC-3].
NEW: Pulls batch details instantly from the pre-computed FTS5 cache table.
Reports
OLD: Synchronously scanned all sales rows on load, locking the database on older HDDs
.
NEW: Writes daily aggregations to a reporting stats cache nightly at 9:30 PM
.
Investigation (Stock Ledger)
OLD: Performed expensive regex parsing over raw free-text log files on-the-fly
.
NEW: Reads a structured JSON metadata block written directly alongside database mutations.
Purchases
OLD: Recalculated GST and margin structures on every keystroke in the bill form
.
NEW: Caches forms locally via useMemo; merges values on Save transaction only.
Inventory
OLD: Triggered full-table queries joining medicines and batches on scroll
.
NEW: Displays virtualized rows pulled straight from indexed cache views
.
CRM (Refills)
OLD: Calculated refill dates against shelf counts for thousands of patients concurrently
.
NEW: Background worker checks dates at 9:00 AM daily and saves flags directly to the DB
.
Returns & Expiry
OLD: Scanned years of active batches with custom string parsers in React
.
NEW: Reads pre-computed expiry tables updated on every manual purchase entry
.
================================================================================4. AGENT VERIFICATION PROTOCOL (MANDATORY STEPS BEFORE DONE)
To prevent hallucinated completion, the agent MUST run these verification commands:
Step 4.1: Backend Typecheck $ npx tsc --noEmit (Run from project root)
Step 4.2: Frontend Typecheck $ npx tsc -b --force --noEmit (Run from frontend/ directory)
Step 4.3: Synchronize Graph $ node scripts/quick-update.mjs (Run from project root after any code change)

---

### Key Takeaways for your System Stability

1. **Calculations only fire on changes (Writes)**: By capturing mutations inside the database write interceptor, the application ignores passive page browsing. If no one is selling or purchasing, your CPU usage sits at **0%**, maintaining a highly optimized footprint of ~105-140 MB of RAM [31, 32].
2. **Deterministic Cold Starts**: When new medicines are introduced with no historical sales data, the dynamic cold-start formula uses the micro-velocity of the first 30 days to protect your stock levels without waiting for a full 6-month cycle to build [21].
3. **No Phantom Inventories**: Because the calculation logic strictly utilizes the unified base-units equation (`quantity * packSize + loose_quantity`) [18], you avoid stock inflation or "ghost batches" that used to occur during raw imports from older platforms [33].

📊 **What should we do next?** We can look into applying these **Pre-Calculated Background Cache** changes to the background **Stock Calculator worker** (`src/worker/stockCalculatorWorker.ts`) or begin structuring the backend endpoints to support this data-flow model!