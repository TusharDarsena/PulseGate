# StellarTickets Agent Guide

Use this file for rules that must be present in every task. Load more detailed
guidance only for the part of the repository being changed:

- `contracts/AGENTS.md` for Soroban/Rust work.
- `frontend/AGENTS.md` for React, wallet, QR, routing, and Supabase adapter work.
- `docs/architecture.md` for intended system boundaries and the rationale
  behind architectural choices.
- `docs/agent-handbook.md` for the complete historical project map and coupling
  tables. Read only the sections relevant to the current task.
- `docs/codex-cost-guide.md` for this repository's cost-conscious workflow.

## System Model

StellarTickets has two authoritative Soroban contracts, generated TypeScript
bindings, a React/Vite frontend, and a Supabase read model.

> Soroban owns truth. Supabase makes that truth discoverable.

Supabase must never authorize a purchase, transfer, refund, fund release, or
venue entry. For every state-changing flow: confirm the chain transaction
first, update the mirror second, then invalidate affected reads.

## Non-Negotiable Boundaries

- Never hand-edit generated contract bindings.
- Pages and components do not import generated bindings or instantiate contract
  clients. Handwritten contract integration stays in `frontend/src/lib/soroban.ts`.
- Keep attendee/Dfns and organizer/Freighter identities and signers separate.
- Never place raw wallet secrets in browser storage, Zustand, Supabase, logs, or
  application code.
- QR entry requires local payload/signature validation, an authoritative on-chain
  owner/status check, and a successful organizer-signed `mark_used()` call.
- Contract IDs, network values, generated bindings, and both contracts' stored
  peer addresses must stay synchronized after ABI or deployment changes.
- Preserve checked arithmetic, lifecycle guards, authorization, and
  checks/effects/interactions ordering in economic flows.

## Change Follow-Through

When changing a shared boundary, update every affected layer in the same change:

- Contract ABI/type/error changes: Rust tests, cross-contract mirrors, generated
  bindings, frontend adapter/error mapping, callers, and architecture docs.
- Lifecycle changes: contract guards/tests, UI conditions, Supabase status
  mapping, scanner/refund/release behavior, and architecture docs.
- Supabase schema changes: migration/schema, RLS, adapter types/helpers, hooks,
  page writes, and row mapping.
- Wallet, QR, or route changes: all producers/consumers, hydration or protection
  gates, navigation, refresh/direct-link behavior, and relevant docs.

Do not add decision entries for routine fixes. Update the relevant decision
section in `docs/architecture.md` only when adding or reversing a significant
architectural decision.

## Cost-Conscious Workflow

- Start with targeted searches and the smallest relevant files. Do not read or
  pack the whole repository unless the task genuinely spans it.
- Batch related read-only inspection where practical and cap command output.
- During implementation, run focused checks only. Run broad test suites,
  production builds, dependency installs, and toolchain setup once at the end
  unless a focused run is needed to unblock the change.
- Do not rerun an unchanged failing command. Inspect its failure and change the
  cause first.
- For a long-running command, launch it once with a suitable timeout or wait
  sparsely. Do not create rapid polling loops.
- If the user postpones tests, make the implementation changes first and run no
  suite until the user requests final verification.
- Treat a new phase or substantially different problem as a fresh task when the
  existing task has accumulated extensive tool output and history.
- Never paste `repomix-output.*` into a task by default. Use the repository's
  Repomix configuration and include only the area needed.

## Completion

A change is complete when authoritative behavior is correct, downstream layers
are synchronized, generated files were regenerated rather than patched, focused
tests cover the behavior, and no flow trusts Supabase for authorization.
