# Programmable Screenshot Capture — Step 1

This first slice proves one deterministic capture only:

- `Browse / loaded grid / desktop-1440x900 / guest / seedA`

It does not yet add authenticated state, scanner state, purchase recovery, mobile capture, or visual-regression assertions.

## Install once

From `frontend/`:

```bash
npm install --save-dev @playwright/test@1.61.1
npx playwright install chromium
```

Add this script to the existing `frontend/package.json` scripts object:

```json
"screenshots:step1": "playwright test --config=playwright.screenshots.config.ts"
```

## Run

From `frontend/`:

```bash
npm run screenshots:step1
```

The capture is written to:

```text
../screenshots/ui-refinement/2026-07-27/01-tier-1-core-flow/browse/
```

The run also generates:

```text
../screenshots/ui-refinement/2026-07-27/CAPTURE-CATALOG.md
```

## Why the command must run from `frontend/`

The output-path helper deliberately verifies the working directory. This prevents a successful run from silently writing screenshots into the wrong folder when the command is launched from a different directory.

## What this slice verifies

- Playwright can start or reuse the Vite development server.
- The browser uses a fixed viewport, locale, timezone, color scheme, scale factor, and time.
- Supabase list requests are mocked before navigation.
- Event poster assets are inline and deterministic.
- The runner waits for visible page content, fonts, and images rather than using a blind delay.
- The filename follows the existing screenshot naming rule.
- The screenshot purpose is generated into a readable catalog.