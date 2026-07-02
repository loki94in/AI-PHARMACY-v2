# 🚀 Improvement Recommendations

18 concrete recommendations to improve the project, organized by priority.

---

## 🔴 Critical Improvements (Security)

### 1. Hardcoded Default Credentials

**Problem**: `src/database.ts` seeds default passwords in plaintext:
```sql
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('login_password', 'admin123')
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('master_password', 'master999')
```

**Risk**: Any attacker who knows the default credentials can access the system if they're never changed.

**Recommendation**:
- Force password change on first login
- Hash passwords with `bcrypt` before storing
- Never store plaintext passwords in any table
- Add password strength requirements (minimum length, complexity)

---

### 2. API Key Hardcoded in Config

**Problem**: `src/config/index.ts` has a hardcoded fallback API key:
```typescript
apiKey: process.env.API_KEY || 'Pass@123',
```

**Risk**: If `API_KEY` environment variable is not set, the application uses a well-known default password.

**Recommendation**:
- Remove the fallback value entirely
- Require `API_KEY` environment variable in production
- Fail at startup if not set: `if (!process.env.API_KEY) throw new Error('API_KEY required')`
- Use a cryptographically random key (UUID v4 or similar)

---

### 3. Auth Bypass in Development

**Problem**: `src/middleware/auth.ts` completely skips authentication in non-production:
```typescript
if (process.env.NODE_ENV !== 'production') {
  return next();
}
```

**Risk**: If someone accidentally deploys without setting `NODE_ENV=production`, all API endpoints are completely unprotected.

**Recommendation**:
- Replace blanket NODE_ENV check with an explicit `SKIP_AUTH=true` env var
- Log a prominent warning when auth is skipped
- Add auth bypass only for specific development scenarios, not globally

---

## 🟡 Important Improvements (Architecture)

### 4. Split the Monolithic App.tsx (53KB, 1182 lines)

**Problem**: `frontend/src/App.tsx` contains the sidebar, topbar, notification panel, device indicators, SSE listener, toast system, theme toggle, and all route definitions in a single 1,182-line file.

**Impact**: Hard to maintain, review, and test. Any change risks breaking unrelated features.

**Recommendation**: Extract into focused modules:
```
frontend/src/
├── App.tsx                    # Just routing and layout skeleton
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx        # Navigation menu
│   │   ├── Topbar.tsx         # Header with notifications, theme, devices
│   │   └── NotificationPanel.tsx  # Notification dropdown
│   └── ...
├── hooks/
│   ├── useNotifications.ts    # Notification state management
│   ├── useSSE.ts              # SSE connection management
│   └── useTheme.ts            # Theme toggle logic
└── routes.tsx                 # Route definitions
```

---

### 5. Split the Monolithic purchases.ts Route (75KB)

**Problem**: `src/routes/purchases.ts` is the largest route file at 75KB, handling CRUD operations, email-to-purchase reconciliation, PDF generation, staged sync, and price history.

**Recommendation**: Split into focused route files:
```
src/routes/purchases/
├── index.ts                   # Re-exports the combined router
├── crud.ts                    # Basic CRUD operations
├── reconciliation.ts          # Email-to-purchase reconciliation
├── pdf.ts                     # PDF invoice generation
├── staged.ts                  # Mobile sync staging
└── priceHistory.ts            # Price history lookup
```

---

### 6. Replace Try/Catch ALTER TABLE with Proper Migrations

**Problem**: `src/database.ts` has 60+ individual ALTER TABLE statements wrapped in try/catch. Schema changes are not tracked or versioned.

**Recommendation**: Implement a migration system:
```
src/database/migrations/
├── 001_initial_schema.ts
├── 002_add_manufacturer.ts
├── 003_add_purchase_items.ts
└── ...
```

With a tracking table:
```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Benefits:
- Schema history is auditable
- Migrations run only once
- Can add DOWN migrations for rollback
- New developers can see exactly how the schema evolved

---

### 7. Add Connection Pooling for Concurrent Workers

**Problem**: Workers fork separate processes and each opens its own SQLite connection. Under heavy catalog import load, this can cause WAL checkpoint delays.

**Recommendation**: 
- Use `better-sqlite3` directly (synchronous API) for worker processes
- This eliminates Promise overhead and is faster for batch INSERT operations
- The synchronous API is better suited for batch processing patterns

---

### 8. Add Comprehensive Input Validation

**Problem**: Input validation is inconsistent across routes. Some routes validate inputs thoroughly, others trust request body directly.

**Recommendation**: Add schema validation for all API endpoints using Zod:
```typescript
import { z } from 'zod';

const createSaleSchema = z.object({
  patient_name: z.string().min(1).max(200),
  items: z.array(z.object({
    inventory_id: z.number().int().positive(),
    quantity: z.number().int().min(1).max(9999),
  })).min(1)
});

// In route handler:
const data = createSaleSchema.parse(req.body);
```

---

## 🟢 Nice-to-Have Improvements

### 9. Add API Response Caching

**Problem**: Frequently-accessed data like medicine lists hit SQLite on every request, even if the data hasn't changed.

**Recommendation**: Add an in-memory LRU cache for hot paths:
```typescript
const medicineListCache = new Map();
const CACHE_TTL = 30_000; // 30 seconds

function getCachedMedicines(key: string) {
  const cached = medicineListCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}
```

---

### 10. Add Missing Database Indexes

**Current indexes** (already defined):
- ✅ `idx_medicines_name`
- ✅ `idx_medicines_api_ref`
- ✅ `idx_inventory_master_medicine_id`
- ✅ `idx_inventory_master_batch_no`
- ✅ `idx_inventory_master_search_filter`
- ✅ `idx_catalog_jobs_status`

**Missing indexes that would improve performance:**
```sql
CREATE INDEX idx_sales_invoices_date ON sales_invoices (date);
CREATE INDEX idx_sale_items_invoice_id ON sale_items (invoice_id);
CREATE INDEX idx_purchases_distributor_id ON purchases (distributor_id);
CREATE INDEX idx_purchase_items_purchase_id ON purchase_items (purchase_id);
CREATE INDEX idx_customers_phone ON customers (phone);
CREATE INDEX idx_stock_ledger_medicine_id ON stock_ledger (medicine_id);
CREATE INDEX idx_returns_date ON returns (date);
```

---

### 11. Add Structured Logging

**Problem**: All logging uses `console.log` and `console.error` with no structure, making it hard to search, filter, or analyze logs.

**Recommendation**: Use `pino` logger:
```typescript
import pino from 'pino';
const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });

// Instead of: console.log('Processing catalog job', jobId);
logger.info({ module: 'catalog', jobId: 123 }, 'Processing started');
```

Benefits: JSON output, log levels, module tagging, external log aggregation support.

---

### 12. Add Health Check Endpoint

**Problem**: No way to programmatically check if the server and its dependencies are healthy.

**Recommendation**: Add `GET /api/health`:
```json
{
  "status": "ok",
  "uptime": 3600,
  "database": "connected",
  "workers": {
    "catalog": "running",
    "email": "running"
  },
  "memory": {
    "heapUsed": "85MB",
    "rss": "120MB"
  },
  "version": "0.1.0"
}
```

---

### 13. Reduce emailService.ts Size (121KB)

**Problem**: `src/services/emailService.ts` is 121KB — the largest single file in the entire project.

**Recommendation**: Split into focused modules:
```
src/services/email/
├── index.ts                   # Re-exports the service
├── imapClient.ts              # IMAP connection management
├── attachmentParser.ts        # Attachment extraction & parsing
├── distributorMatcher.ts      # Distributor identification logic
├── invoiceExtractor.ts        # Invoice data extraction
└── emailSyncService.ts        # Email sync orchestration
```

---

### 14. Enable TypeScript Strict Mode

**Problem**: TypeScript is configured but not in strict mode. Many `any` types are used throughout, reducing type safety.

**Recommendation**: Gradually enable strict mode:
1. Add `"strict": true` to `tsconfig.json`
2. Fix type errors module by module
3. Replace `any` with proper interfaces
4. Add return type annotations to all exported functions

---

### 15. Add End-to-End Testing

**Problem**: The test suite (18 files) covers unit and integration tests, but no end-to-end UI tests exist. UI regressions are only caught manually.

**Recommendation**: Add Playwright tests for critical flows:
```typescript
test('complete POS sale flow', async ({ page }) => {
  await page.goto('/pos');
  await page.fill('#medicine-search', 'Paracetamol');
  await page.click('.search-result:first-child');
  await page.fill('#patient-name', 'Test Patient');
  await page.click('#generate-bill');
  await expect(page.locator('.toast-success')).toBeVisible();
});
```

---

### 16. Use Database Transactions Consistently

**Problem**: Some multi-step operations (like sale creation: insert invoice → insert items → update stock → insert ledger) should be atomic but aren't consistently wrapped in transactions.

**Recommendation**: Use the existing `dbManager.transaction()` method:
```typescript
await dbManager.transaction(async (db) => {
  const invoice = await db.run('INSERT INTO sales_invoices ...');
  await db.run('INSERT INTO sale_items ...');
  await db.run('UPDATE inventory_master SET quantity = quantity - ?');
  await db.run('INSERT INTO stock_ledger ...');
});
// If any step fails, ALL changes are rolled back
```

---

### 17. Add Graceful Degradation for External Services

**Problem**: If WhatsApp/Telegram/Email services are down, some request paths can hang or produce confusing errors.

**Current state**: Most external calls are wrapped in try/catch, but some still block request completion.

**Recommendation**: Move ALL external service calls to the background queue pattern:
- Already implemented for WhatsApp (`pending_whatsapp_jobs`)
- Apply same pattern to Telegram notifications
- Apply same pattern to email operations
- This ensures request-response cycle is never blocked by external service availability

---

### 18. Add Frontend Error Boundary

**Problem**: An unhandled React error in one page component crashes the entire SPA, showing a blank white screen.

**Recommendation**: Add `<ErrorBoundary>` wrapper around each route:
```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError() { return { hasError: true }; }
  
  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. <button onClick={() => this.setState({ hasError: false })}>Try again</button></div>;
    }
    return this.props.children;
  }
}
```

---

## Priority Matrix

| # | Improvement | Priority | Effort | Impact |
|---|-----------|----------|--------|--------|
| 1 | Hardcoded credentials | 🔴 Critical | Low | High — Security vulnerability |
| 2 | API key hardcoded | 🔴 Critical | Low | High — Security vulnerability |
| 3 | Auth bypass in dev | 🔴 Critical | Low | High — Deployment risk |
| 4 | Split App.tsx | 🟡 Important | Medium | High — Maintainability |
| 5 | Split purchases.ts | 🟡 Important | Medium | Medium — Maintainability |
| 6 | Proper migrations | 🟡 Important | High | High — Schema management |
| 7 | Worker connection pooling | 🟡 Important | Medium | Medium — Performance |
| 8 | Input validation | 🟡 Important | High | High — Security + reliability |
| 9 | API response caching | 🟢 Nice-to-have | Low | Medium — Performance |
| 10 | Missing indexes | 🟢 Nice-to-have | Low | Medium — Query performance |
| 11 | Structured logging | 🟢 Nice-to-have | Medium | Medium — Operations |
| 12 | Health check endpoint | 🟢 Nice-to-have | Low | Low — Monitoring |
| 13 | Split emailService | 🟢 Nice-to-have | Medium | Medium — Maintainability |
| 14 | TypeScript strict mode | 🟢 Nice-to-have | High | Medium — Type safety |
| 15 | E2E testing | 🟢 Nice-to-have | High | High — Quality assurance |
| 16 | Consistent transactions | 🟢 Nice-to-have | Medium | High — Data integrity |
| 17 | Graceful degradation | 🟢 Nice-to-have | Medium | Medium — Reliability |
| 18 | Error boundary | 🟢 Nice-to-have | Low | Medium — User experience |
