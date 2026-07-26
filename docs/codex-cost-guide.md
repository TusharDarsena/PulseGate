# Codex Cost Guide

This guide is based on the local Codex records from July 24, 2026. It is meant
to prevent repeated context and tool loops while preserving useful verification.

## What Caused The Spike

The day used 68.4 million tokens and cost $50.22. Four sessions contributed:

| Session | Wall time | Input | Cached input | Output | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Wallet foundation | 60.8 min | 522k | 26.58M | 84.7k | $18.44 |
| Wallet helper | 46.4 min | 79.8k | 146.9k | 753 | $0.50 |
| Event data / Phase 2 | 136.7 min | 1.35M | 37.07M | 123.7k | $28.99 |
| Phase 2 helper | 94.0 min | 210.7k | 2.25M | 3.7k | $2.29 |

The two main sessions made 508 model steps and 275 shell calls. Most billed
tokens were cached conversation/context repeatedly carried into each step.

The 45-minute Phase 2 run used 14.75M tokens:

| Segment | Time | Tokens | Model steps | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| Implementation | 18.8 min | 7.53M | 46 | 27 |
| Verification/toolchain | 26.4 min | 7.21M | 66 | 54 |

Waiting itself was not the main charge. Repeated model resumptions around
installs, builds, tests, diagnostics, and polling repeatedly processed the large
task history. Verification and toolchain work caused roughly half of this turn's
tokens.

## Working Rules

1. Use a fresh task for a new implementation phase or unrelated debugging
   problem. Do not keep adding phases to a multi-hour task.
2. Give the goal, relevant paths, hard boundaries, and "done when" criteria.
   Avoid asking for a full-repository read when a feature has known ownership.
3. Use low reasoning for narrow edits and routine commands; reserve high
   reasoning for architecture, difficult debugging, or security-sensitive work.
4. Keep Fast mode off unless the time saving is worth its higher credit rate.
5. While coding, run only the smallest check that can catch the current mistake.
   Run full build/test suites once after implementation.
6. Do not install or replace toolchains during feature implementation unless the
   task is blocked. Handle environment repair in a separate task.
7. Run long commands once and wait sparsely. Avoid short polling loops.
8. Stop after repeated failures, inspect the cause, and change the approach
   before rerunning.
9. Use focused Repomix packs. The committed configuration excludes generated
   bindings, snapshots, lockfiles, screenshots, reports, historical HTML dumps,
   and agent-skill sources, and rejects packs above 120k tokens.
10. Check usage after each substantial phase so a runaway task is visible before
    it becomes the day's bill.

## Live Usage Check

Codex writes local `token_count` events while a task is running. To see a
current snapshot for the latest task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\codex-token-usage.ps1
```

To keep it open as a live dashboard:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\codex-token-usage.ps1 -Watch
```

The helper reports total tokens, cached input, output, context-window use, the
latest model step, and an estimated credit count. Use `-Model Sol`, `-Model
Terra`, or `-Model Luna` to change the estimate. The estimate is local and may
not exactly match the billing dashboard, but it is useful for catching runaway
tasks quickly.

## Prompt Pattern

Use a compact request such as:

```text
Goal: implement <specific outcome>.
Relevant area: <paths or feature>.
Keep unchanged: <one or two important boundaries>.
Verification: focused checks while coding; full build/tests once at the end.
Done when: <observable result>.
Stop and report before installing toolchains or starting unrelated cleanup.
```
