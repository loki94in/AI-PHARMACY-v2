# 🔄 Complete Data Flow — Start to Bottom

This document shows exactly how data moves through the application, from user click to database and back.

---

## 1. Request Lifecycle (Frontend → Database → Frontend)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant FE as React SPA<br/>(localhost:5173)
    participant VP as Vite Proxy
    participant EX as Express Server<br/>(localhost:3000)
    participant MW as Middleware Chain
    participant RT as Route Handler
    participant SV as Service Layer
    participant DB as SQLite (WAL)

    U->>FE: Click / Interact
    FE->>FE: Component calls api.xxx()
    FE->>VP: axios GET/POST /api/...
    VP->>EX: Proxy forward to :3000
    EX->>MW: 1. Helmet (security headers)
    MW->>MW: 2. CORS (origin check)
    MW->>MW: 3. Rate Limiter (300/15min)
    MW->>MW: 4. JSON body parser (15MB limit)
    MW->>MW: 5. Activity Tracker
    MW->>MW: 6. authenticateApiKey()
    MW->>RT: Route matched → handler
    RT->>SV: Business logic call
    SV->>DB: dbManager.getConnection()
    DB-->>SV: Singleton DB handle
    SV->>DB: SQL query (parameterized)
    DB-->>SV: Result rows
    SV-->>RT: Processed data
    RT-->>EX: res.json(data)
    EX-->>VP: HTTP response
    VP-->>FE: JSON data
    FE->>FE: setState → re-render
    FE-->>U: Updated UI
```

### Step-by-step in pure text:

1. **User interacts** (clicks button, submits form, navigates page)
2. **React component** calls a method from `frontend/src/services/api.ts` (e.g., `api.getInventory()`)
3. **Axios client** sends HTTP request to `/api/inventory` with session token in `x-session-token` header
4. **Vite dev proxy** forwards the request from `localhost:5173` to `localhost:3000`
5. **Express server** receives the request and runs the middleware chain:
   - **Helmet**: Adds security headers (X-Frame-Options, etc.)
   - **CORS**: Checks `Origin` header against whitelist
   - **Rate Limiter**: Checks if IP has exceeded 300 requests in 15 minutes
   - **Body Parser**: Parses JSON body (max 15MB)
   - **Activity Tracker**: Records timestamp of last user activity
   - **Auth**: Validates session token against database (skipped in dev mode)
6. **Route handler** (`src/routes/inventory.ts`) receives the request
7. **Handler** calls `dbManager.getConnection()` to get the singleton database handle
8. **SQLite query** executes with parameterized SQL (prevents SQL injection)
9. **Result rows** returned from SQLite
10. **Route handler** formats data and sends `res.json(data)`
11. **Response flows back** through Express → Vite proxy → React
12. **React component** updates state → re-renders the UI

---

## 2. Database Connection Flow (Singleton Pattern)

```mermaid
graph LR
    A["Any Route/Service/Worker"] -->|"dbManager.getConnection()"| B["DatabaseManager Singleton"]
    B -->|"First call"| C["open(filename, sqlite3.Database)"]
    C --> D["PRAGMA busy_timeout = 5000"]
    D --> E["Cache connection in this.connection"]
    B -->|"Subsequent calls"| F["Return cached connection"]
    E --> F
    F --> G["Execute SQL"]
```

### How it works:

- `DatabaseManager` is a **singleton class** — only one instance exists across the entire application
- On the **first call** to `getConnection()`:
  1. Opens the SQLite database file (`data/app.db`)
  2. Sets `busy_timeout = 5000` (wait up to 5 seconds if database is locked)
  3. Caches the connection handle in `this.connection`
- On **all subsequent calls**: Returns the cached connection immediately (no overhead)
- The entire application (all 33 routes, all 26 services) shares **ONE database connection**

---

## 3. Authentication Flow

```mermaid
flowchart TD
    REQ["Incoming API Request"] --> ENV{"NODE_ENV?"}
    ENV -->|"development/test"| PASS["✅ Skip auth → next()"]
    ENV -->|"production"| LICENSE{"Path starts with<br/>/api/license?"}
    LICENSE -->|"Yes"| PASS
    LICENSE -->|"No"| TOKEN{"x-session-token<br/>header present?"}
    TOKEN -->|"No"| REJECT["❌ 401 Unauthorized"]
    TOKEN -->|"Yes"| VALIDATE{"Token matches<br/>DB session token<br/>OR legacy API key?"}
    VALIDATE -->|"Yes"| PASS
    VALIDATE -->|"No"| REJECT
```

### Token sources (checked in order):
1. `x-session-token` header
2. `x-api-key` header (legacy)
3. `api-key` query parameter
4. `apiKey` query parameter

### Token validation:
- Reads `license_session_token` from `app_settings` table
- Falls back to legacy API key from environment config
- WhatsApp Business webhook (`/api/wa-business/webhook`) is always public (Meta sends requests without our token)

---

## 4. Real-Time Notification Flow (SSE)

```mermaid
sequenceDiagram
    participant FE as Frontend (Topbar)
    participant SSE as SSE Stream<br/>/api/notifications/stream
    participant BE as Backend Event
    participant WK as Background Worker

    FE->>SSE: new EventSource("/api/notifications/stream")
    
    Note over FE,SSE: Connection stays open (long-lived)

    WK->>BE: Job progress update
    BE->>SSE: event: catalog_job_progress
    SSE-->>FE: { type: "catalog_job_progress", payload: { progress: 45 } }
    FE->>FE: Update progress bar in topbar

    WK->>BE: Job complete
    BE->>SSE: event: catalog_job_update
    SSE-->>FE: { type: "catalog_job_update", payload: { status: "done" } }
    FE->>FE: Show toast "Catalogue ingestion completed!"

    Note over FE,SSE: Auto-reconnect on disconnect (5s retry)
```

### SSE event types:
| Event Type | Payload | Frontend Action |
|-----------|---------|-----------------|
| `catalog_job_progress` | `{ id, progress, total_count, processed_count }` | Update topbar progress bar |
| `catalog_job_update` | `{ id, status, error }` | Toast notification |
| `sales_sync` | `{ count }` | Badge on sidebar + toast |
| `purchases_sync` | `{ count }` | Badge on sidebar + toast |
| `auth_failure` | `{ message }` | Error toast → redirect to settings |
| `notification` | `{ message }` | Toast notification |

---

## 5. Frontend API Client Flow

```mermaid
flowchart TD
    PAGE["Page Component<br/>(e.g., Inventory)"] --> CALL["api.getInventory()"]
    CALL --> AXIOS["apiClient (Axios instance)"]
    AXIOS --> INTERCEPT_REQ["Request Interceptor:<br/>Attach x-session-token<br/>from localStorage"]
    INTERCEPT_REQ --> SEND["HTTP Request<br/>GET /api/inventory"]
    SEND --> RESPONSE["HTTP Response"]
    RESPONSE --> INTERCEPT_RES{"standardizeData<br/>flag set?"}
    INTERCEPT_RES -->|"Yes"| CAMEL["Convert snake_case<br/>→ camelCase"]
    INTERCEPT_RES -->|"No"| RAW["Return raw data"]
    CAMEL & RAW --> THEN[".then(res => res.data)"]
    THEN --> STATE["setState(data)"]
    STATE --> RENDER["React re-render"]
```

### Key details:
- **Base URL**: `/api` (Vite proxy handles the forwarding)
- **Token attachment**: Reads `session_token` or `api_key` from `localStorage`, attaches as `x-session-token` header
- **Error handling**: 401 responses log a warning (token missing/invalid)
- **Data standardization**: Opt-in `snake_case` → `camelCase` conversion (most endpoints still use raw snake_case for backwards compatibility with 432+ UI elements)

---

## 6. Mobile App Sync Flow

```mermaid
flowchart TD
    MOBILE["Mobile App<br/>(React Native)"] --> OFFLINE["Create sale/purchase<br/>in local storage"]
    OFFLINE --> CONNECT{"Connected to<br/>desktop server?"}
    CONNECT -->|"No"| QUEUE["Queue in local storage"]
    CONNECT -->|"Yes"| SYNC["POST /api/sales/staged<br/>or /api/purchases/staged"]
    SYNC --> STAGED["Server creates<br/>staged_sales / staged_purchases<br/>rows"]
    STAGED --> SSE["SSE event →<br/>desktop frontend"]
    SSE --> BADGE["Sidebar shows<br/>sync review badge"]
    BADGE --> REVIEW["User opens<br/>Staged Review Modal"]
    REVIEW --> APPROVE{"Approve?"}
    APPROVE -->|"Yes"| COMMIT["Commits to production<br/>(sales_invoices, inventory_master)"]
    APPROVE -->|"No"| REJECT["Mark as rejected"]
```

---

## 7. Database Schema — Entity Relationships

```mermaid
erDiagram
    medicines {
        int id PK
        text name
        text api_reference
        text manufacturer
        text category
        real mrp
        text item_code
        text hsn_code
    }
    
    inventory_master {
        int id PK
        int medicine_id FK
        int quantity
        int loose_quantity
        text batch_no
        datetime expiry_date
        real cost_price
        real mrp
    }
    
    sales_invoices {
        int id PK
        text invoice_no UK
        int customer_id FK
        datetime date
        real total_amount
        real tax_amount
    }
    
    sale_items {
        int id PK
        int invoice_id FK
        int inventory_id FK
        int quantity
        real unit_price
    }
    
    purchases {
        int id PK
        int distributor_id FK
        text invoice_no
        real total_amount
    }
    
    purchase_items {
        int id PK
        int purchase_id FK
        int medicine_id FK
        text batch_no
        int quantity
        real cost_price
        real mrp
    }
    
    distributors {
        int id PK
        text name UK
        text gstin
        text phone
    }
    
    customers {
        int id PK
        text name
        text phone
        real credit_balance
    }
    
    returns {
        int id PK
        text return_no UK
        int original_invoice_id FK
        text type
        real total_amount
    }
    
    stock_ledger {
        int id PK
        int medicine_id FK
        text batch_no
        int quantity
        text transaction_type
    }

    medicines ||--o{ inventory_master : "has batches"
    medicines ||--o{ purchase_items : "purchased as"
    medicines ||--o{ stock_ledger : "tracked in"
    inventory_master ||--o{ sale_items : "sold from"
    sales_invoices ||--o{ sale_items : "contains"
    customers ||--o{ sales_invoices : "buys"
    purchases ||--o{ purchase_items : "contains"
    distributors ||--o{ purchases : "supplies"
    returns ||--o{ return_items : "contains"
```

### Table count by domain:
| Domain | Tables |
|--------|--------|
| **Core Business** | `medicines`, `inventory_master`, `sales_invoices`, `sale_items`, `purchases`, `purchase_items`, `returns`, `return_items`, `stock_ledger` |
| **CRM** | `customers`, `doctors`, `patient_refills` |
| **Catalog** | `catalog_jobs`, `processed_files`, `medicine_reference`, `medicine_aliases`, `catalog_mappings` |
| **Communication** | `pending_whatsapp_jobs`, `message_templates`, `push_tokens`, `emails`, `email_attachments`, `processed_emails` |
| **Operations** | `dispatch_orders`, `delivery_boys`, `expiry_returns_tracking`, `compliance_logs` |
| **System** | `app_settings`, `action_logs`, `settings`, `held_bills`, `staged_sales`, `staged_purchases` |
| **AI/OCR** | `ocr_corrections`, `ocr_audit_queue`, `distributor_learning_profiles`, `distributor_historical_files` |
