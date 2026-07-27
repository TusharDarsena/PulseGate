# Required package.json change

The uploaded project export did not contain `frontend/package.json`, so this bundle does not replace or guess its existing contents.

From `frontend/`, install the pinned stable Playwright Test release used by this slice:

```bash
npm install --save-dev @playwright/test@1.61.1
npx playwright install chromium
```

Merge this entry into the existing `scripts` object:

```json
{
  "scripts": {
    "screenshots:step1": "playwright test --config=playwright.screenshots.config.ts"
  }
}
```
