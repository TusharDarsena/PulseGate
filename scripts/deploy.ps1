param(
  [string] $StellarCli = "C:\tmp\stellar.exe",
  [string] $ConfigDir = "C:\Users\asus\.config\stellar",
  [string] $Network = "testnet",
  [string] $XlmToken = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  [string] $RuntimeNode = "C:\Users\asus\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string] $FallbackPnpm = "C:\Users\asus\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd",
  [string] $AppOrigin = "https://stellar-gamma-weld.vercel.app",
  [switch] $SetSupabaseSecrets
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param([scriptblock] $Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath $StellarCli)) {
  throw "Stellar CLI not found at $StellarCli"
}

Invoke-Checked { & $StellarCli --config-dir $ConfigDir keys address organizer | Out-Null }

Push-Location contracts
try {
  Invoke-Checked { cargo +stable-x86_64-pc-windows-gnu build --target wasm32v1-none --release }
}
finally {
  Pop-Location
}

Invoke-Checked {
  & $StellarCli contract bindings typescript `
    --wasm contracts/target/wasm32v1-none/release/ticket.wasm `
    --output-dir frontend/src/contracts/ticket `
    --overwrite
}
Invoke-Checked {
  & $StellarCli contract bindings typescript `
    --wasm contracts/target/wasm32v1-none/release/marketplace.wasm `
    --output-dir frontend/src/contracts/marketplace `
    --overwrite
}

$env:CI = "true"
$env:Path = "C:\Users\asus\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:Path
foreach ($bindingDir in @("frontend/src/contracts/ticket", "frontend/src/contracts/marketplace")) {
  Push-Location $bindingDir
  try {
    Invoke-Checked { & $FallbackPnpm install --no-frozen-lockfile }
    Invoke-Checked { & $FallbackPnpm run build }
  }
  finally {
    Pop-Location
  }
}

$ticketId = & $StellarCli --config-dir $ConfigDir contract deploy `
  --wasm contracts/target/wasm32v1-none/release/ticket.wasm `
  --source organizer `
  --network $Network
if ($LASTEXITCODE -ne 0) { throw "TicketContract deployment failed" }

$marketplaceId = & $StellarCli --config-dir $ConfigDir contract deploy `
  --wasm contracts/target/wasm32v1-none/release/marketplace.wasm `
  --source organizer `
  --network $Network
if ($LASTEXITCODE -ne 0) { throw "MarketplaceContract deployment failed" }

$admin = & $StellarCli --config-dir $ConfigDir keys address organizer
if ($LASTEXITCODE -ne 0) { throw "Could not read organizer address" }

Invoke-Checked {
  & $StellarCli --config-dir $ConfigDir contract invoke `
    --id $ticketId `
    --source organizer `
    --network $Network `
    -- initialize `
    --admin $admin `
    --marketplace_address $marketplaceId `
    --xlm_token $XlmToken
}

Invoke-Checked {
  & $StellarCli --config-dir $ConfigDir contract invoke `
    --id $marketplaceId `
    --source organizer `
    --network $Network `
    -- initialize `
    --admin $admin `
    --ticket_contract_address $ticketId `
    --royalty_rate 10
}

$envFile = "frontend/.env.local"
if (-not (Test-Path -LiteralPath $envFile)) {
  New-Item -Path $envFile -ItemType File | Out-Null
}

function Set-EnvValue {
  param([string] $Key, [string] $Value)
  $lines = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile } else { @() }
  $next = "$Key=$Value"
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") {
      $found = $true
      $next
    }
    else {
      $line
    }
  }
  if (-not $found) { $updated += $next }
  Set-Content -LiteralPath $envFile -Value $updated
}

Set-EnvValue "VITE_TICKET_CONTRACT_ID" $ticketId
Set-EnvValue "VITE_MARKETPLACE_CONTRACT_ID" $marketplaceId
Set-EnvValue "VITE_NETWORK_PASSPHRASE" '"Test SDF Network ; September 2015"'
Set-EnvValue "VITE_RPC_URL" '"https://soroban-testnet.stellar.org:443"'
Set-EnvValue "VITE_HORIZON_URL" '"https://horizon-testnet.stellar.org"'
Set-EnvValue "VITE_STELLAR_EXPLORER_URL" '"https://stellar.expert/explorer/testnet"'

if ($SetSupabaseSecrets) {
  Invoke-Checked {
    & $RuntimeNode ".\node_modules\supabase\dist\supabase.js" secrets set `
      STELLAR_NETWORK=StellarTestnet `
      "STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015" `
      TICKET_CONTRACT_ID=$ticketId `
      STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443 `
      STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org `
      STELLAR_FRIENDBOT_URL=https://friendbot.stellar.org `
      APP_ORIGIN=$AppOrigin
  }
}

Write-Output "Ticket Contract ID: $ticketId"
Write-Output "Marketplace Contract ID: $marketplaceId"
Write-Output "Saved contract IDs to frontend/.env.local"
if (-not $SetSupabaseSecrets) {
  Write-Output "Run with -SetSupabaseSecrets to update linked Supabase Edge Function secrets."
}
