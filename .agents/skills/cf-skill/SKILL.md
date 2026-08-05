---
name: cf-skill
description: "Systematic decision-making framework for AI coding agents to reason through user intent, codebase exploration, architectural trade-offs, minimal surgical implementation, and verification. Use when deciding what or how to build, resolving ambiguity, or planning code changes."
---

# AI Agent Decision-Making Framework (cf-skill)

## Overview

This skill defines the core decision logic and reasoning framework used by AI coding agents when building or modifying an application. It provides a disciplined, tool-agnostic decision path from understanding user intent to verifying working changes.

---

## 1. The Core Loop

Every task, no matter how small or large, runs through five stages:

```
Understand → Explore → Decide → Build → Verify
```

- **Understand**: What is the user actually asking for? What is the underlying goal behind the literal words?
- **Explore**: What already exists in this codebase that is relevant? What patterns, utilities, tables, or endpoints already solve part of this?
- **Decide**: When there are multiple valid ways to build it, which one fits *this* codebase, *this* user, and *this* constraint set?
- **Build**: Implement the smallest correct change that satisfies the goal.
- **Verify**: Prove it works — run it, test it, read the actual output — before claiming completion.

> **CRITICAL:** Skipping "Explore" leads to duplicated logic, inconsistent patterns, and reinventing features that already exist elsewhere in the codebase.

---

## 2. Understanding Intent & Managing Ambiguity

Separate the request into three distinct layers:
1. **The literal ask** — the exact words used by the user.
2. **The functional goal** — the actual outcome that constitutes "done" in the user's mind.
3. **The unstated constraints** — implicit rules (do not break other features, match existing style, do not introduce unapproved dependencies, preserve data integrity).

### Ambiguity Resolution Matrix

| Situation | Action |
|---|---|
| Multiple reasonable interpretations, wrong pick wastes work or is destructive | Ask structured multiple-choice questions with clear options and tradeoffs |
| One clearly reasonable interpretation, others are unwanted edge cases | Proceed and explicitly state the assumption |
| Decision only user can make (business logic, pricing, legal/compliance) | Ask user for clarification |
| Technical detail inferable from codebase (naming, file path, error handling) | Infer from existing code without asking |
| Task is reversible and low-cost to redo | Proceed and allow user to redirect if needed |
| Task is destructive, irreversible, or affects production/shared data | Always confirm before executing |

---

## 3. Codebase Exploration Rules

Before proposing or implementing an approach:

- **Audit Precedent:** Find existing implementations of the target pattern in the workspace. Extend established patterns rather than inventing new ones.
- **Match Conventions:** Follow established naming styles, directory hierarchies, and architectural separation (e.g., API clients, route handlers, service layers).
- **Inspect Exact Schemas:** View authoritative table/column definitions and function signatures rather than guessing field names or types.
- **Check Known Failure Modes:** Review known bugs or past session issues before attributing unexpected test failures to new changes.

---

## 4. Architectural Decision Rules

When evaluating multiple valid implementation options:

1. **Consistency Beats Novelty:** Existing codebase patterns take precedence over personal preference or general external best practices.
2. **Simplicity First (YAGNI):** Implement the minimal code that satisfies the requirement. Avoid speculative abstractions for unrequested future needs.
3. **Evaluate Reversibility:** Make cheap, reversible choices quickly. Surface expensive or hard-to-undo choices (database schema changes, public API contracts, external dependencies) explicitly.
4. **Assess Blast Radius:** Scope changes locally. Require user confirmation for changes with high blast radius (shared state, data migrations, destructive operations).
5. **Honor User Constraints:** Standing user directives and project rules override default preferences.

---

## 5. Universal Execution Principles

1. **Read Before Writing:** Never assume schemas, types, or signatures without inspecting authoritative files first.
2. **Search Before Inventing:** Check for existing utility functions and components before building custom helpers.
3. **Separate Reversible vs. Irreversible:** Gate irreversible operations behind explicit user confirmation.
4. **Structure Clarifications:** Present ambiguity as concrete multiple-choice options with trade-offs.
5. **Verify Before Claiming Success:** Gather empirical runtime proof (tests, builds, log outputs) before declaring a task complete.
