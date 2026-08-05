# How I Decide What to Build: A Reasoning Framework

This document explains the actual logic I use — as an AI coding agent — when I build or modify an application, from the moment a request comes in to the moment code is verified working. It's written so any agent (or any developer reading this) can follow the same decision path and reach the same kind of end point: a working, correctly-scoped change that matches what the user actually needed, not just what they literally typed.

---

## 1. The core loop

Every task, no matter how small or large, runs through the same five stages. I don't skip stages — I compress them for trivial tasks and expand them for complex ones.

```
Understand → Explore → Decide → Build → Verify
```

- **Understand**: What is the user actually asking for? What's the underlying goal behind the literal words?
- **Explore**: What already exists in this codebase that's relevant? What patterns, utilities, tables, endpoints already solve part of this?
- **Decide**: When there are multiple valid ways to build it, which one fits *this* codebase, *this* user, *this* constraint set?
- **Build**: Implement the smallest correct change that satisfies the goal.
- **Verify**: Prove it works — run it, test it, read the output — before claiming done.

Skipping "Explore" is the single most common cause of bad output from any coding agent: it leads to duplicated logic, invented patterns that don't match the rest of the app, or reinventing something that already exists three files away.

---

## 2. Understanding intent, not just the literal request

Users rarely specify a fully-formed spec. My job is to separate three things:

1. **The literal ask** — what words were used.
2. **The functional goal** — what outcome makes this "done" in the user's mind.
3. **The unstated constraints** — things the user assumes I'll respect without saying them (don't break other features, match existing style, don't introduce new dependencies casually, don't lose data).

When these three are unclear or in tension, that's the signal to ask — not to guess and build. A well-placed question before writing code is cheaper than a wrong implementation after.

**Heuristic for when to ask vs. when to proceed:**

| Situation | Action |
|---|---|
| Multiple reasonable interpretations, and picking wrong wastes significant work or is destructive | Ask (structured multiple-choice question, not open-ended) |
| One clearly reasonable interpretation, other options are edge cases nobody would actually want | Proceed, note the assumption |
| Missing a decision only the user can make (business logic, pricing, legal/compliance-adjacent choice) | Ask |
| Missing a technical detail I can infer from the existing codebase (naming convention, file location, error-handling style) | Infer from the code, don't ask |
| The task is reversible and cheap to redo if wrong | Proceed, let them redirect |
| The task is destructive, irreversible, or affects shared/production systems | Always confirm first, regardless of how "obvious" the answer seems |

Concretely, in this project (`AI PHARMACY v2`), that distinction has shown up as: *not* asking whether to use SQLite (it's already the codebase's committed choice, visible in every route file), but *always* asking before doing something like altering how sales deduct inventory (a business-logic decision with real financial consequences per this project's own established rule — see the "strict inventory-only sales" memory).

---

## 3. Exploring before deciding

Before proposing an approach, I look for:

- **Existing implementations of the same pattern.** If there's already a `reportExporter.ts` and a route that streams CSV, a new export feature should extend that pattern, not invent a second one.
- **Naming and structural conventions.** Route files under `src/routes/`, services under a services directory, frontend API calls centralized in `frontend/src/services/api.ts` — matching these isn't stylistic preference, it's what keeps the codebase navigable for the next person (human or agent).
- **Data model reality, not assumed schema.** I check actual table/column definitions rather than guessing field names — this codebase has a documented history of exactly this kind of bug (a memory here notes `medicines.pack_size` didn't exist and was confused with `pack_unit`; another notes a stock-ledger rebuild bug from conflating two independent quantity columns). Guessing schema is a direct source of production bugs.
- **Known failure modes already discovered.** This project keeps a memory log of pre-existing issues (e.g., ~16 failing Jest suites unrelated to new work, an FTS5 virtual table that silently broke all inserts, a `dbManager.close()` that was a no-op without `force:true`). Before I treat a test failure or a weird runtime behavior as caused by my change, I check whether it's already a known pre-existing condition — otherwise I'll chase a ghost.

This is why, structurally, exploration always happens through targeted reads/greps of the actual code (or a dedicated search subagent for broad questions) rather than from memory or general assumption. Memory of past sessions is useful context, but it's treated as a hint to verify, not a fact to build on — code changes, memory doesn't always keep up.

---

## 4. Deciding between options

When there genuinely are multiple valid ways to build something (architecture, library choice, UI pattern, data flow), the selection logic is:

1. **Consistency beats novelty.** If the codebase already has a way of doing X (state management, API call pattern, modal component), the existing pattern wins by default — introducing a second competing pattern for the same problem is a tax on every future change, not a one-time cost.
2. **Minimum sufficient complexity.** I build the smallest thing that satisfies the actual requirement — not the most extensible, most generic, or most "future-proof" version. Speculative abstraction for hypothetical future needs is avoided; three similar lines beat a premature shared helper.
3. **Reversibility of the decision.** If a choice is cheap to change later (a helper function's internal implementation), I just pick the reasonable default and move. If a choice is expensive to change later (a database schema shape, a public API contract, a third-party service integration), I slow down, surface it explicitly, and often ask.
4. **Blast radius.** Local, contained, reversible changes (editing a file, adding a route) get made directly. Changes with wider blast radius — anything touching shared state, production data, another team's system, or anything hard to undo (force-push, schema migration on live data, deleting something) — get confirmed with the user first, even under a general instruction to "just build it."
5. **What the user has already told me they prefer.** Explicit past feedback overrides my defaults. If a user has said "don't auto-create stock in any sale path, ever" or "stop adding trailing summaries," that instruction is a standing constraint on every future decision in that scope, not advice I weigh once.

When the decision genuinely can't be resolved by the above — it's a business/product call, not a technical one — that's exactly the case for a structured multiple-choice question (2–4 concrete options, each with the tradeoff spelled out) rather than an open-ended "what do you want?" A concrete choice is easier for a user to react to than a blank page.

---

## 5. How this generalizes to *any* agent, not just me

The reason this framework produces the same end point regardless of which agent runs it is that it doesn't depend on model-specific cleverness — it depends on a fixed sequence of cheap, checkable steps:

1. **Read before writing.** Never propose a schema field, function signature, or config key without having actually seen it in the code.
2. **Search for precedent before inventing.** A pattern-match against the existing codebase is a stronger prior than "best practice in general."
3. **Separate reversible from irreversible actions**, and gate only the irreversible ones on confirmation.
4. **Externalize genuine ambiguity as a structured question**, don't silently guess on high-cost decisions.
5. **Verify against reality before declaring success** — run the code, run the tests, read the actual output, rather than asserting correctness from having "written it correctly."

Any agent — human developer, LLM-based coding agent, or a multi-agent pipeline with separate planning/execution/review roles — that follows this sequence converges on the same kind of outcome: a change that fits the existing system, respects what's expensive to undo, and was verified rather than assumed. The specific tools differ (grep vs. an IDE's "find usages," a subagent vs. a human teammate doing code review), but the decision logic is tool-agnostic.

---

## 6. Applied example from this project

To make this concrete rather than abstract, here's how the framework played out on a real change in `AI PHARMACY v2`:

- **Request**: "Fix that also if app not sure in media will forward to the pharmacy phone number" (WhatsApp/OCR escalation).
- **Understand**: The literal ask is narrow (forward uncertain media), but the functional goal is "don't silently drop or mis-process an order the system isn't confident about."
- **Explore**: Before touching anything, the WhatsApp/OCR/escalation pipeline was audited end-to-end first — what's built, what's wired, where the fallback gaps are — because building an escalation path on top of a pipeline with unknown gaps would have meant fixing the wrong layer.
- **Decide**: Reuse the existing WhatsApp messaging service and existing settings-driven phone number storage rather than inventing a new notification channel or a new config location — matching the project's own later decision to consolidate distributor/staff contact info to a single source of truth instead of scattering it across settings.
- **Build**: Smallest change that closes the gap — route the "unsure" classification branch to an existing send-message function with the pharmacy number, rather than restructuring the whole gate.
- **Verify**: Confirmed against a real failure mode already on record — an earlier bug where an empty lookup table made the OCR gate falsely permissive ("empty lookup = permissive" pattern) — checking the fix didn't reintroduce that shape elsewhere.

That's the framework running in practice: understand the real goal behind a terse instruction, explore the actual pipeline before assuming it works as described, pick the option that reuses existing infrastructure, build minimally, and verify against a known failure pattern rather than just re-reading the new code and calling it correct.

---

## 7. Summary

- Ambiguity gets resolved by exploration first, questions second, assumption last.
- Existing code is the primary source of truth for conventions — not general best practice, not memory of past sessions (which is a hint to verify, not a fact).
- Decisions are gated by reversibility and blast radius, not by how confident I feel.
- "Done" means verified, not written — running the code and reading real output, not asserting success from the diff.
- Any agent following this same sequence — read, search for precedent, separate reversible from irreversible, ask only the genuinely ambiguous high-cost questions, verify before claiming success — converges on the same quality of outcome, because the logic doesn't depend on the specific model, only on the discipline of the sequence.
