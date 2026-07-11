# GLOBAL STABILITY & VERIFICATION LAYER (NON-DESTRUCTIVE)

OBJECTIVE
Implement a permanent, centralized Verification & Stability Layer that protects the entire application whenever any feature is added, modified, or removed.

THIS IS A SAFETY LAYER.
IT MUST NEVER CHANGE THE EXISTING UI, UX, DATABASE STRUCTURE, BUSINESS LOGIC, OR WORKING FEATURES.

==================================================
CORE RULES (MANDATORY)
==================================================

1. Never rewrite existing working code unless absolutely required.
2. Never redesign or replace the current UI.
3. Never rename APIs, routes, services, models, or database tables unless compatibility is maintained.
4. Never break existing workflows.
5. Every new feature must be backward compatible.
6. Every modification must pass verification before becoming active.
7. If verification fails:
   - Abort the new change.
   - Keep the existing implementation running.
   - Show detailed diagnostics.
8. Existing users must never notice any interruption.
9. Prefer extension over replacement.
10. Preserve all current application behavior.

==================================================
GLOBAL VERIFICATION PIPELINE
==================================================

Before enabling ANY change:

Step 1
Verify project integrity.

Step 2
Verify backend startup.

Step 3
Verify frontend connectivity.

Step 4
Verify API communication.

Step 5
Verify database connectivity.

Step 6
Verify read operations.

Step 7
Verify write operations.

Step 8
Verify transactions.

Step 9
Verify business logic.

Step 10
Verify UI rendering.

Step 11
Verify navigation.

Step 12
Verify existing features.

Only after ALL checks pass may the new feature become active.

==================================================
DATABASE VERIFICATION
==================================================

Continuously verify:

• Database connection is alive.
• Database is not locked.
• Read operations succeed.
• Write operations succeed.
• Insert operations succeed.
• Update operations succeed.
• Delete operations succeed.
• Transactions commit successfully.
• Rollback functions correctly.
• Required tables exist.
• Required columns exist.
• Required indexes exist.
• Foreign keys remain valid.
• Connection pool/session remains healthy.
• No silent database failures.
• No partial writes.
• No corrupted records.

If any check fails:

• Stop only the failing transaction.
• Never corrupt data.
• Never lose data.
• Never crash the application.
• Report the exact failure.

==================================================
BACKEND HEALTH VERIFICATION
==================================================

Continuously verify:

• Backend process is running.
• APIs are registered.
• Routes are reachable.
• Internal services respond.
• Required dependencies are initialized.
• Authentication state is valid.
• Request handlers execute correctly.
• Response serialization succeeds.

If frontend reports
"Backend is not running"

but backend health checks succeed,

then:

• Detect false backend errors.
• Diagnose API mismatch.
• Diagnose network mismatch.
• Diagnose timeout.
• Diagnose incorrect endpoint.
• Diagnose response parsing.
• Diagnose CORS/proxy configuration if applicable.
• Log the actual root cause instead of displaying a misleading backend error.

==================================================
FRONTEND VERIFICATION
==================================================

Verify:

• API endpoint availability.
• Request payload.
• Response payload.
• Response parsing.
• State updates.
• Cache synchronization.
• UI refresh.
• Error handling.
• Loading state.
• Success state.

Never allow the frontend to display incorrect error messages when the backend is healthy.

==================================================
POS BILL VERIFICATION
==================================================

Before saving a bill verify:

Medicine exists.

MRP is valid.

Quantity is valid.

Stock validation passes.

Price calculations are correct.

Discount calculations are correct.

Tax calculations are correct.

Doctor information is valid.

Patient information is valid.

Bill items are complete.

Total matches item calculations.

Payment details are valid.

Invoice number generation succeeds.

Database transaction is ready.

Sales history update is ready.

Inventory update is ready.

Audit log is ready.

If any verification fails:

Do NOT save partial data.

Do NOT reduce stock.

Do NOT create incomplete invoices.

Do NOT corrupt sales history.

Return the precise reason for failure.

==================================================
SAVE BILL VERIFICATION
==================================================

After clicking Save:

Verify request reached backend.

Verify backend accepted request.

Verify database write succeeded.

Verify transaction committed.

Verify inventory updated.

Verify sales history updated.

Verify patient history updated.

Verify invoice stored.

Verify frontend received success response.

Verify UI refreshed correctly.

Only then show:

"Bill Saved Successfully"

Otherwise show the exact failed verification step.

==================================================
SALES HISTORY VERIFICATION
==================================================

Immediately after saving:

Verify bill exists.

Verify sales history refreshed.

Verify filters are correct.

Verify pagination.

Verify search index.

Verify cached data.

Verify newly created invoice is visible.

If missing:

Automatically diagnose whether the failure occurred during:

• Save
• Commit
• Refresh
• Query
• Cache
• UI rendering

==================================================
AUTOCOMPLETE VERIFICATION
==================================================

Verify autocomplete independently for:

• Medicines
• Patients
• Doctors

Ensure:

Suggestions load correctly.

Search remains responsive.

Existing behavior is preserved.

Selection inserts correct values.

No duplicate records.

No incorrect mapping.

No broken references.

==================================================
ERROR DIAGNOSTICS
==================================================

Never report generic errors.

Instead identify the exact layer:

Frontend

API

Validation

Business Logic

Database

Transaction

Query

Cache

Synchronization

Rendering

Network

Configuration

Dependency

Return actionable diagnostics with the failing component and reason.

==================================================
SAFE FEATURE INTEGRATION
==================================================

Whenever a new feature is added:

Run a complete regression verification.

Confirm:

Existing UI unchanged.

Existing APIs unchanged.

Existing workflows unchanged.

Existing database unchanged.

Existing billing unchanged.

Existing inventory unchanged.

Existing reports unchanged.

Existing autocomplete unchanged.

Existing sales history unchanged.

Only activate the new feature after all compatibility checks pass.

==================================================
SELF-HEALING
==================================================

Automatically detect:

Broken connections.

Temporary database failures.

Backend restart.

Lost API connections.

Cache inconsistencies.

Stale state.

Retry only safe operations where appropriate.

Never duplicate transactions.

Never duplicate invoices.

Never duplicate stock deductions.

Never duplicate sales entries.

==================================================
FINAL GUARANTEE
==================================================

This verification layer must function as a permanent safety framework for the application.

Its purpose is to:

• Prevent regressions.
• Prevent accidental UI changes.
• Prevent business logic corruption.
• Prevent database corruption.
• Prevent broken frontend-backend communication.
• Prevent false backend error messages.
• Prevent failed bill saves.
• Ensure saved bills appear correctly in sales history.
• Ensure every new feature integrates safely with the existing architecture.

The Verification Layer must observe, validate, diagnose, and protect the system while preserving 100% of the existing working behavior. It must extend the application safely without replacing or restructuring the current implementation.