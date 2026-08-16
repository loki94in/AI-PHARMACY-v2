# Universal Agent Bug-Fix Rulebook

> **Scope:** Any AI agent · Any codebase · Any user-reported issue  
> **Type:** Binding workflow + guardrails (not a project bug list)  
> **Version:** 1.0 · 2026-08-02  
> **Portable:** Copy this file to any repo root; pair with that project’s `AGENTS.md` and bug register.

---

## 1. What this document is

This is a **universal rulebook** for fixing bugs, regressions, and broken behavior. It does **not** list project-specific defects. It tells every agent **how** to work safely and consistently.

| Layer | Document | Role |
|-------|----------|------|
| **Universal (this file)** | `AGENT_BUG_FIX_RULEBOOK.md` | Workflow, priorities, guardrails, checklist |
| **Project contracts** | `AGENTS.md`, `README.md`, nested `AGENTS.md` | That repo’s architecture, ownership, conventions |
| **Project bug history** | e.g. `SMALL_BUG_FIX_PLAN.md`, `CHANGELOG.md`, issues | What is already fixed vs still open **in this repo** |

**Rule:** Always follow this rulebook first, then the **current project’s** docs. Never skip project docs because this file is generic.

---

## 2. When to use this rulebook

Use it **before writing code** when the user mentions:

- bug, fix, broken, error, crash, regression, not working  
- wrong data, empty screen, slow, timeout, flaky  
- UI mixup, wrong label, missing rows, duplicate logic  
- “don’t break what works”, “small fix”, “minimal change”  

If the task is **purely a new feature** with no defect, use the project’s normal dev guide. If the feature touches a known-bug area, still read the project bug register.

---

## 3. Mandatory read order (every bug-fix session)

Adapt paths to whatever exists in the repo:

| Step | What to read | Why |
|------|----------------|-----|
| 1 | **This rulebook** | Universal process |
| 2 | **Project `AGENTS.md`** (root → folder you edit) | Ownership, contracts, “do not touch” |
| 3 | **Project bug register** (if present) | Open vs fixed issues; avoid regressions |
| 4 | **`README.md` / architecture docs** | Stack, run/test commands |
| 5 | **Files near the bug** | Real patterns, naming, tests |

If the project defines a post-edit script (e.g. `quick-update.mjs`, `lint`, `test`), run what **`AGENTS.md`** requires—not only what this file suggests.

---

## 4. Bug-fix workflow (follow every time)

### A — Classify

1. Search the project bug register / issues for an existing entry.  
2. **Open** → follow the documented plan; don’t redesign.  
3. **Fixed** → treat as **regression**; restore fix without undoing the original solution.  
4. **New** → proceed; document when done (Section 8).

Assign priority (Section 5).

### B — Diagnose (evidence, not guesses)

- Reproduce from the user’s steps.  
- Separate **frontend** vs **backend** vs **data** vs **config**.  
- For empty UI: check network/API response, not only rendering.  
- Check recent **git diff** / deploy changes.  
- Find **root cause** in code; avoid masking symptoms only.

### C — Plan minimally

Before coding, prefer the smallest fix that works:

1. **YAGNI** — is this change necessary?  
2. **Existing code** — extend a function/API already there?  
3. **Stdlib / existing dependency** — before adding packages?  
4. **Smallest diff** — one concern, matching local style.

**Avoid unless user asks:** full page rewrites, new dependencies, parallel data models, “while we’re here” refactors.

### D — Implement surgically

- Match existing naming, patterns, and test style.  
- Touch only files required for the fix.  
- Preserve public APIs and user-visible behavior outside the bug.  
- Follow project UI/theme/i18n rules if UI is involved.

### E — Verify

- Reproduce the original failure → confirm fixed.  
- Smoke-test **adjacent** flows the change could affect.  
- Run project tests / lint if available.  
- Confirm no new errors in console/logs.

### F — Document & hand off

- Update project bug register (open → fixed).  
- Update `AGENTS.md` only if **contracts** changed (ownership, APIs, workflows).  
- Note test steps for the user in plain language.

---

## 5. Priority scale (P0–P3)

| Priority | Meaning | Agent behavior |
|----------|---------|----------------|
| **P0** | Data loss, security issue, or **core task impossible** | Fix first; smallest safe patch |
| **P1** | Important daily workflow broken | Fix soon; diagnose data + API |
| **P2** | UX friction; workaround exists | Improve without redesigning algorithms |
| **P3** | Cosmetic, dead code, docs | Batch or do when user requests |

When unsure, ask the user—or default to **P1** if workflow is blocked, **P2** if merely annoying.

---

## 6. Universal guardrails (every project)

### 6.1 Always do

- **Minimal scope** — fix the reported issue only.  
- **Root cause** — prefer correcting source over hiding symptoms.  
- **Existing patterns** — reuse project abstractions.  
- **Protect working behavior** — don’t revert known-good fixes.  
- **Leave a trail** — update bug register / commit message.  
- **Respect user rules** — `AGENTS.md`, cursor rules, explicit “don’t change X”.

### 6.2 Never do (unless user explicitly asks)

- Large refactors bundled with a small bug fix  
- New dependencies for a one-line fix  
- Duplicate features/tables/routes “for convenience”  
- Disable tests, guards, or validation to “make it pass”  
- Force-push, hard reset, or destructive git without explicit approval  
- Commit secrets, `.env`, or credentials  

### 6.3 Regression prevention

Before finishing, ask:

1. What was **already fixed** in this repo that my change could break?  
2. Did I change a **shared** utility used by many pages?  
3. Did I alter **schema/migrations** without a backward path?  
4. Did I change **defaults** that affect all users?

If yes → add a test or manual check for that path.

### 6.4 When the user says “don’t break the structure”

Interpret as:

- Keep page/module boundaries  
- Keep data model and API shapes unless the bug *is* the shape  
- Keep caching and loading patterns  
- Surgical edits, not rewrites  

### 6.5 Zero Fabricated Business Data & Mandatory Audit Rule

**Fundamental Engineering Rule:**
- **Real data → process it.**
- **Missing data → request/validate it.**
- **Invalid data → reject it.**
- **Never → invent it.**

1. **NEVER** introduce, retain, or silently use fabricated, dummy, placeholder, guessed, synthetic, or arbitrary business data or fallback logic (batches, expiry dates, MRP, prices, cost prices, quantities, pack sizes, medicines, inventory, purchases, sales, bills, customers, suppliers, shop details, IDs).
2. **Missing data must remain missing** and require the legitimate workflow or user to provide it. Never invent a value just to prevent an error or make the UI work.
3. **Mandatory Pre & Post Audit on Every Task**: Before editing, audit the affected workflow and existing implementation across the codebase. After editing, audit again and report the 8-point summary.

---

## 7. Diagnosis toolkit (technology-agnostic)

| Symptom | Often check |
|---------|-------------|
| Empty list / page | API status, response body, date/filter params, auth |
| Intermittent slowness | Sync work on main thread, N+1 queries, missing index, cache cold start |
| “Worked yesterday” | Recent diff, env change, data migration, feature flag |
| Wrong number/total | Frontend calc vs backend calc; unit mismatch; rounding |
| Validation blocking save | Frontend vs backend rules disagree |
| Search misses typos | Local exact match only; fuzzy layer missing or too strict |

---

## 8. How to record a bug fix (any project)

Use this template in the project’s bug register or changelog:

```markdown
### [STATUS] P?-XX — Short title

| Field | Content |
|-------|---------|
| **What the user saw** | Observable symptom |
| **Root cause** | File/module and why |
| **How it was fixed** | Approach (or “Open — planned”) |
| **Priority** | P0–P3 |
| **What not to touch** | Related areas to leave alone |
| **Verified by** | Test steps |
```

**Status:** `Open` · `Fixed` · `Deferred` · `Won’t fix`

---

## 9. Agent checklist before “done”

- [ ] Read this rulebook + project `AGENTS.md` + bug register  
- [ ] Issue classified (open / fixed / new / regression)  
- [ ] Root cause identified with evidence  
- [ ] Change is minimal; no unrelated edits  
- [ ] Original bug no longer reproduces  
- [ ] No obvious regression on related flows  
- [ ] Project tests/lint/runbook followed  
- [ ] Bug register / docs updated  
- [ ] User can understand what changed (plain summary)

---

## 10. Agent promise (any project)

1. **Understand before coding** — read project context.  
2. **Fix causes, not only symptoms.**  
3. **Keep structure** — small, familiar diffs.  
4. **Protect prior fixes** — don’t re-break solved issues.  
5. **Document** — so the next agent or human isn’t lost.

---

## 11. Optional: copy into a new project

1. Copy `AGENT_BUG_FIX_RULEBOOK.md` to the new repo root.  
2. Copy `.agents/rules/bug-fix.md` (short always-on reminder).  
3. Create a project bug register (e.g. `BUG_REGISTER.md`) using Section 8 template.  
4. In that project’s `AGENTS.md`, add:  
   *“For defects, read `AGENT_BUG_FIX_RULEBOOK.md` then this file.”*

---

*Universal rulebook — not tied to any single app, page, or stack.*
