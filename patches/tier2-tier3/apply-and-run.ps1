$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

node .\patches\tier2-tier3\apply-captures.mjs

Set-Location .\frontend
npx playwright test `
  --config=playwright.screenshots.config.ts `
  --grep "organizer-dashboard-populated-desktop|auth-default-mobile|create-event-preparing-desktop|not-found-default-desktop"
