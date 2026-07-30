[CmdletBinding()]
param(
  [ValidateRange(1, 65)]
  [int] $UserCount = 65,

  [ValidateRange(2, 120)]
  [int] $TargetRuntimeMinutes = 60,

  [ValidatePattern('^[a-zA-Z0-9-]+$')]
  [string] $RunId = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss"),

  [string] $StellarCli = "C:\tmp\stellar.exe",
  [string] $ConfigDir = "C:\Users\asus\.config\stellar",
  [string] $OrganizerIdentity = "organizer",
  [string] $NodeRuntime = "C:\Users\asus\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [switch] $Resume
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TestnetPassphrase = "Test SDF Network ; September 2015"
$RpcUrl = "https://soroban-testnet.stellar.org"
$HorizonUrl = "https://horizon-testnet.stellar.org"
$FriendbotUrl = "https://friendbot.stellar.org"
$ExplorerBaseUrl = "https://stellar.expert/explorer/testnet"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnvFile = Join-Path $RepoRoot "frontend\.env.local"
$StateDirectory = Join-Path $PSScriptRoot ".state"
$StateFile = Join-Path $StateDirectory "$RunId.json"
$LockFile = Join-Path $StateDirectory "worker.lock"
$ProofDirectory = Join-Path $RepoRoot "proofs\testnet-users-$RunId"
$CaptureScript = Join-Path $PSScriptRoot "capture-proofs.mjs"

function Write-WorkerLog {
  param([string] $Message)
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Write-Host "[$stamp] $Message"
}

function Get-UtcIso {
  return (Get-Date).ToUniversalTime().ToString("o")
}

function ConvertTo-ContractString {
  param([Parameter(Mandatory)][string] $Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Get-EnvFileValue {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][string] $Name
  )

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
    Select-Object -First 1
  if (-not $line) {
    throw "Missing $Name in $Path"
  }

  return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Invoke-External {
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [Parameter(Mandatory)][string[]] $Arguments
  )

  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1 |
      ForEach-Object { $_.ToString() } |
      Out-String
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
      ExitCode = $exitCode
      Output = $output.Trim()
    }
  }
  finally {
    $ErrorActionPreference = $previousErrorPreference
  }
}

function Invoke-Stellar {
  param([Parameter(Mandatory)][string[]] $Arguments)
  $allArguments = @("--config-dir", $ConfigDir) + $Arguments
  return Invoke-External -FilePath $StellarCli -Arguments $allArguments
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory)][ValidateSet("GET", "POST")][string] $Method,
    [Parameter(Mandatory)][string] $Uri,
    [object] $Body
  )

  if ($Method -eq "GET") {
    return Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec 30
  }

  return Invoke-RestMethod `
    -Method Post `
    -Uri $Uri `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 12 -Compress) `
    -TimeoutSec 30
}

function Invoke-WithRetry {
  param(
    [Parameter(Mandatory)][scriptblock] $Action,
    [string] $Description = "request",
    [int] $Attempts = 6
  )

  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      return & $Action
    }
    catch {
      $lastError = $_
      if ($attempt -eq $Attempts) {
        break
      }
      $delay = [Math]::Min(30, [Math]::Pow(2, $attempt))
      Write-WorkerLog "$Description failed (attempt $attempt/$Attempts); retrying in $delay seconds."
      Start-Sleep -Seconds $delay
    }
  }

  throw "$Description failed after $Attempts attempts: $($lastError.Exception.Message)"
}

function Invoke-Rpc {
  param(
    [Parameter(Mandatory)][string] $Method,
    [hashtable] $Parameters = @{}
  )

  $response = Invoke-JsonRequest -Method POST -Uri $RpcUrl -Body @{
    jsonrpc = "2.0"
    id = 1
    method = $Method
    params = $Parameters
  }
  $hasError = $response.PSObject.Properties.Name -contains "error"
  if ($hasError -and $null -ne $response.error) {
    throw "RPC $Method failed: $($response.error | ConvertTo-Json -Compress)"
  }
  if (-not ($response.PSObject.Properties.Name -contains "result")) {
    throw "RPC $Method returned neither a result nor an error."
  }
  return $response.result
}

function Get-HorizonAccount {
  param([Parameter(Mandatory)][string] $Address)
  $encoded = [uri]::EscapeDataString($Address)
  return Invoke-JsonRequest -Method GET -Uri "$HorizonUrl/accounts/$encoded"
}

function Get-AccountTransactions {
  param(
    [Parameter(Mandatory)][string] $Address,
    [ValidateSet("asc", "desc")][string] $Order = "desc",
    [int] $Limit = 20
  )

  $encoded = [uri]::EscapeDataString($Address)
  $page = Invoke-JsonRequest -Method GET `
    -Uri "$HorizonUrl/accounts/$encoded/transactions?order=$Order&limit=$Limit&include_failed=true"
  return @($page._embedded.records)
}

function Get-LatestTransactionToken {
  param([Parameter(Mandatory)][string] $Address)
  try {
    $records = @(Get-AccountTransactions -Address $Address -Order desc -Limit 1)
    if ($records.Count -eq 0) {
      return $null
    }
    return [string] $records[0].paging_token
  }
  catch {
    return $null
  }
}

function Find-NewSuccessfulTransaction {
  param(
    [Parameter(Mandatory)][string] $Address,
    [string] $BeforeToken,
    [Parameter(Mandatory)][datetime] $StartedUtc,
    [int] $TimeoutSeconds = 100
  )

  $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
  do {
    try {
      $records = @(Get-AccountTransactions -Address $Address -Order desc -Limit 20)
      foreach ($record in $records) {
        $created = [datetime]::Parse([string] $record.created_at).ToUniversalTime()
        $isNewToken = -not $BeforeToken -or ([string] $record.paging_token -ne $BeforeToken)
        if (
          $isNewToken -and
          $created -ge $StartedUtc.AddSeconds(-15) -and
          [bool] $record.successful
        ) {
          return $record
        }
      }
    }
    catch {
      # Horizon can lag RPC briefly. The loop below retries with a bounded delay.
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date).ToUniversalTime() -lt $deadline)

  return $null
}

function Wait-ForRpcSuccess {
  param(
    [Parameter(Mandatory)][string] $Hash,
    [int] $TimeoutSeconds = 100
  )

  $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
  do {
    $result = Invoke-WithRetry `
      -Description "RPC transaction lookup" `
      -Attempts 3 `
      -Action { Invoke-Rpc -Method "getTransaction" -Parameters @{ hash = $Hash } }
    if ($result.status -eq "SUCCESS") {
      return $result
    }
    if ($result.status -eq "FAILED") {
      throw "Transaction $Hash failed on Stellar Testnet."
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date).ToUniversalTime() -lt $deadline)

  throw "Transaction $Hash did not reach a terminal RPC status within $TimeoutSeconds seconds."
}

function Save-State {
  $tempFile = "$StateFile.tmp"
  $script:State.updatedUtc = Get-UtcIso
  $json = $script:State | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText(
    $tempFile,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $tempFile -Destination $StateFile -Force
}

function Resolve-SubmittingRecord {
  param([Parameter(Mandatory)] $Record)

  if ($Record.status -ne "submitting") {
    return $false
  }

  Write-WorkerLog "Resolving interrupted operation $($Record.id) before any replacement submission."
  $started = [datetime]::Parse([string] $Record.startedUtc).ToUniversalTime()
  $transaction = Find-NewSuccessfulTransaction `
    -Address ([string] $Record.sourceAddress) `
    -BeforeToken ([string] $Record.beforeToken) `
    -StartedUtc $started `
    -TimeoutSeconds 120

  if (-not $transaction) {
    throw "Operation $($Record.id) has unknown submission status. Re-run later with -Resume; it will not be resubmitted blindly."
  }

  Wait-ForRpcSuccess -Hash ([string] $transaction.hash) | Out-Null
  $Record.txHash = [string] $transaction.hash
  $Record.ledger = [long] $transaction.ledger
  $Record.closedUtc = [string] $transaction.created_at
  $Record.status = "confirmed"
  Save-State
  return $true
}

function Invoke-TrackedContractTransaction {
  param(
    [Parameter(Mandatory)] $Record,
    [Parameter(Mandatory)][string] $ContractId,
    [Parameter(Mandatory)][string] $SourceIdentity,
    [Parameter(Mandatory)][string] $SourceAddress,
    [Parameter(Mandatory)][string] $FunctionName,
    [Parameter(Mandatory)][hashtable] $FunctionArguments
  )

  if ($Record.status -eq "confirmed") {
    return $Record
  }
  if (Resolve-SubmittingRecord -Record $Record) {
    return $Record
  }

  $started = (Get-Date).ToUniversalTime()
  $beforeToken = Get-LatestTransactionToken -Address $SourceAddress
  $Record.sourceIdentity = $SourceIdentity
  $Record.sourceAddress = $SourceAddress
  $Record.startedUtc = $started.ToString("o")
  $Record.beforeToken = $beforeToken
  $Record.status = "submitting"
  Save-State

  $arguments = @(
    "contract", "invoke",
    "--id", $ContractId,
    "--source", $SourceIdentity,
    "--network", "testnet",
    "--send", "yes",
    "--auto-sign",
    "--",
    $FunctionName
  )
  foreach ($entry in $FunctionArguments.GetEnumerator()) {
    $arguments += "--$($entry.Key)"
    $arguments += [string] $entry.Value
  }

  Write-WorkerLog "Submitting $($Record.id) from $SourceIdentity."
  $result = Invoke-Stellar -Arguments $arguments

  $transaction = Find-NewSuccessfulTransaction `
    -Address $SourceAddress `
    -BeforeToken $beforeToken `
    -StartedUtc $started `
    -TimeoutSeconds 120

  if (-not $transaction) {
    $Record.error = $result.Output
    Save-State
    if ($result.ExitCode -ne 0) {
      throw "Stellar CLI failed for $($Record.id), and no successful Testnet transaction could be resolved: $($result.Output)"
    }
    throw "The CLI returned for $($Record.id), but its Testnet transaction could not be resolved. Re-run with -Resume."
  }

  Wait-ForRpcSuccess -Hash ([string] $transaction.hash) | Out-Null
  $Record.txHash = [string] $transaction.hash
  $Record.ledger = [long] $transaction.ledger
  $Record.closedUtc = [string] $transaction.created_at
  $Record.status = "confirmed"
  $Record.error = $null
  Save-State
  return $Record
}

function Get-IdentityAddress {
  param([Parameter(Mandatory)][string] $Identity)
  $result = Invoke-Stellar -Arguments @("keys", "address", $Identity)
  if ($result.ExitCode -ne 0 -or -not $result.Output.StartsWith("G")) {
    return $null
  }
  return $result.Output.Trim()
}

function Wait-ForFundedAccount {
  param(
    [Parameter(Mandatory)][string] $Address,
    [int] $TimeoutSeconds = 90
  )

  $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
  do {
    try {
      return Get-HorizonAccount -Address $Address
    }
    catch {
      Start-Sleep -Seconds 3
    }
  } while ((Get-Date).ToUniversalTime() -lt $deadline)

  return $null
}

function Ensure-FundedIdentity {
  param([Parameter(Mandatory)] $Actor)

  if ($Actor.activationStatus -eq "confirmed" -and $Actor.address) {
    try {
      Get-HorizonAccount -Address ([string] $Actor.address) | Out-Null
      return
    }
    catch {
      Write-WorkerLog "Account $($Actor.id) is absent, possibly after a Testnet reset; requesting fresh Testnet funding."
    }
  }

  $address = Get-IdentityAddress -Identity ([string] $Actor.identity)
  if (-not $address) {
    Write-WorkerLog "Creating Testnet identity $($Actor.identity) in the Windows secure store."
    $generated = Invoke-Stellar -Arguments @(
      "keys", "generate", [string] $Actor.identity,
      "--secure-store",
      "--fund",
      "--network", "testnet"
    )
    $address = Get-IdentityAddress -Identity ([string] $Actor.identity)
    if (-not $address) {
      throw "Could not create or read identity $($Actor.identity): $($generated.Output)"
    }
  }

  $account = Wait-ForFundedAccount -Address $address -TimeoutSeconds 20
  if (-not $account) {
    Invoke-WithRetry `
      -Description "Friendbot funding for $($Actor.id)" `
      -Attempts 7 `
      -Action {
        Invoke-JsonRequest -Method GET -Uri "$FriendbotUrl/?addr=$([uri]::EscapeDataString($address))" | Out-Null
      } | Out-Null
    $account = Wait-ForFundedAccount -Address $address -TimeoutSeconds 90
  }
  if (-not $account) {
    throw "Testnet account $address was not indexed by Horizon after funding."
  }

  $firstTransactions = @(Get-AccountTransactions -Address $address -Order asc -Limit 1)
  $Actor.address = $address
  $Actor.activationUtc = if ($firstTransactions.Count) {
    [string] $firstTransactions[0].created_at
  } else {
    Get-UtcIso
  }
  $Actor.activationStatus = "confirmed"
  Save-State
}

function Wait-Until {
  param([Parameter(Mandatory)][datetime] $TargetUtc)
  while ($true) {
    $remaining = $TargetUtc - (Get-Date).ToUniversalTime()
    if ($remaining.TotalSeconds -le 0) {
      return
    }
    $sleepSeconds = [Math]::Min(30, [Math]::Max(1, [Math]::Ceiling($remaining.TotalSeconds)))
    Start-Sleep -Seconds $sleepSeconds
  }
}

function Get-SeededShuffle {
  param(
    [Parameter(Mandatory)][object[]] $Items,
    [Parameter(Mandatory)][int] $Seed
  )

  $copy = [System.Collections.ArrayList]::new()
  foreach ($item in $Items) {
    [void] $copy.Add($item)
  }
  $random = [System.Random]::new($Seed)
  for ($index = $copy.Count - 1; $index -gt 0; $index--) {
    $other = $random.Next(0, $index + 1)
    $temp = $copy[$index]
    $copy[$index] = $copy[$other]
    $copy[$other] = $temp
  }
  return @($copy)
}

function New-OperationRecord {
  param([Parameter(Mandatory)][string] $Id)
  return [pscustomobject]@{
    id = $Id
    status = "pending"
    sourceIdentity = $null
    sourceAddress = $null
    startedUtc = $null
    beforeToken = $null
    txHash = $null
    ledger = $null
    closedUtc = $null
    error = $null
  }
}

function Get-OrCreateSecondaryOperation {
  param([Parameter(Mandatory)][string] $Id)
  $existing = @($script:State.secondaryOperations | Where-Object { $_.id -eq $Id }) | Select-Object -First 1
  if ($existing) {
    return $existing
  }
  $record = New-OperationRecord -Id $Id
  $script:State.secondaryOperations = @($script:State.secondaryOperations) + $record
  Save-State
  return $record
}

function Initialize-State {
  param(
    [Parameter(Mandatory)][string] $TicketContractId,
    [Parameter(Mandatory)][string] $MarketplaceContractId,
    [Parameter(Mandatory)][string] $OrganizerAddress
  )

  $started = (Get-Date).ToUniversalTime()
  $seed = [Math]::Abs($RunId.GetHashCode())
  $random = [System.Random]::new($seed)
  $smokeMode = $UserCount -le 3 -and $TargetRuntimeMinutes -le 5
  $activationWindowSeconds = if ($smokeMode) {
    [Math]::Max(10, [Math]::Floor($TargetRuntimeMinutes * 60 * 0.25))
  } else {
    [Math]::Max(60, [Math]::Floor($TargetRuntimeMinutes * 60 * 0.45))
  }
  $indices = @(1..$UserCount)
  $cohortOrder = @(Get-SeededShuffle -Items $indices -Seed ($seed + 17))
  $activityGroupSize = if ($smokeMode -or $UserCount -lt 6) {
    0
  } else {
    [Math]::Min(8, [Math]::Floor($UserCount / 6))
  }
  $roleCursor = 0
  $refundIds = @(
    $cohortOrder |
      Select-Object -Skip $roleCursor -First $activityGroupSize
  )
  $roleCursor += $activityGroupSize
  $listingOpenIds = @(
    $cohortOrder |
      Select-Object -Skip $roleCursor -First $activityGroupSize
  )
  $roleCursor += $activityGroupSize
  $listingCancelledIds = @(
    $cohortOrder |
      Select-Object -Skip $roleCursor -First $activityGroupSize
  )
  $roleCursor += $activityGroupSize
  $listingSoldIds = @(
    $cohortOrder |
      Select-Object -Skip $roleCursor -First $activityGroupSize
  )
  $roleCursor += $activityGroupSize
  $resaleBuyerIds = @(
    $cohortOrder |
      Select-Object -Skip $roleCursor -First $activityGroupSize
  )
  $cancelCount = $refundIds.Count
  $marketCount = $listingOpenIds.Count + $listingCancelledIds.Count + $listingSoldIds.Count

  $actors = @()
  for ($index = 1; $index -le $UserCount; $index++) {
    $fraction = if ($UserCount -le 1) { 0 } else { ($index - 1) / ($UserCount - 1) }
    $baseOffset = [Math]::Floor($activationWindowSeconds * $fraction)
    $jitter = $random.Next(0, 16)
    $activityRole = if ($refundIds -contains $index) {
      "refund"
    } elseif ($listingOpenIds -contains $index) {
      "listing-open"
    } elseif ($listingCancelledIds -contains $index) {
      "listing-cancelled"
    } elseif ($listingSoldIds -contains $index) {
      "listing-sold"
    } elseif ($resaleBuyerIds -contains $index) {
      "resale-buyer"
    } else {
      "purchase"
    }
    $cohort = switch ($activityRole) {
      "refund" { "cancelled"; break }
      { $_ -in @("listing-open", "listing-cancelled", "listing-sold") } {
        "marketplace"
        break
      }
      default { "general" }
    }
    $proofActivityLabel = switch ($activityRole) {
      "refund" { "Cancelled-event refund"; break }
      "listing-open" { "Marketplace listing created"; break }
      "listing-cancelled" { "Marketplace listing cancelled"; break }
      "listing-sold" { "Marketplace listing created (paired resale purchase shown separately)"; break }
      "resale-buyer" { "Marketplace resale purchase"; break }
      default { "Primary ticket purchase" }
    }
    $actors += [pscustomobject]@{
      id = "user-{0:d2}" -f $index
      index = $index
      identity = "st65-$RunId-{0:d2}" -f $index
      address = $null
      cohort = $cohort
      activityRole = $activityRole
      activationOffsetSeconds = [int] ($baseOffset + $jitter)
      activationStatus = "pending"
      activationUtc = $null
      ticketId = "st65-$RunId-ticket-{0:d2}" -f $index
      purchase = New-OperationRecord -Id ("purchase-{0:d2}" -f $index)
      proofTxHash = $null
      proofActivityLabel = $proofActivityLabel
    }
  }

  $eventStart = $started.AddHours(3)
  $eventEnd = $started.AddHours(6)
  return [pscustomobject]@{
    schemaVersion = 1
    runId = $RunId
    status = "running"
    startedUtc = $started.ToString("o")
    updatedUtc = $started.ToString("o")
    completedUtc = $null
    targetRuntimeMinutes = $TargetRuntimeMinutes
    smokeMode = $smokeMode
    network = "testnet"
    networkPassphrase = $TestnetPassphrase
    rpcUrl = $RpcUrl
    horizonUrl = $HorizonUrl
    explorerBaseUrl = $ExplorerBaseUrl
    ticketContractId = $TicketContractId
    marketplaceContractId = $MarketplaceContractId
    organizerIdentity = $OrganizerIdentity
    organizerAddress = $OrganizerAddress
    events = [pscustomobject]@{
      general = [pscustomobject]@{
        id = "st65-$RunId-general"
        name = "Stellar Community Night"
        startUnix = [long] ([DateTimeOffset] $eventStart).ToUnixTimeSeconds()
        endUnix = [long] ([DateTimeOffset] $eventEnd).ToUnixTimeSeconds()
        capacity = [long] [Math]::Max(10, $UserCount + 10)
        priceStroops = [long] 1000000
        creation = New-OperationRecord -Id "create-event-general"
      }
      marketplace = [pscustomobject]@{
        id = "st65-$RunId-market"
        name = "Creator Marketplace Session"
        startUnix = [long] ([DateTimeOffset] $eventStart.AddHours(1)).ToUnixTimeSeconds()
        endUnix = [long] ([DateTimeOffset] $eventEnd.AddHours(1)).ToUnixTimeSeconds()
        capacity = [long] [Math]::Max(10, $marketCount + 5)
        priceStroops = [long] 1200000
        creation = New-OperationRecord -Id "create-event-marketplace"
      }
      cancelled = [pscustomobject]@{
        id = "st65-$RunId-cancel"
        name = "Cancelled Workshop"
        startUnix = [long] ([DateTimeOffset] $eventStart.AddHours(2)).ToUnixTimeSeconds()
        endUnix = [long] ([DateTimeOffset] $eventEnd.AddHours(2)).ToUnixTimeSeconds()
        capacity = [long] [Math]::Max(10, $cancelCount + 5)
        priceStroops = [long] 800000
        creation = New-OperationRecord -Id "create-event-cancelled"
      }
    }
    actors = $actors
    secondaryOperations = @()
  }
}

function Assert-Preflight {
  if (-not (Test-Path -LiteralPath $StellarCli)) {
    throw "Stellar CLI not found at $StellarCli"
  }
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Missing $EnvFile. Deploy the Testnet contracts and populate frontend/.env.local first."
  }
  if (-not (Test-Path -LiteralPath $CaptureScript)) {
    throw "Missing screenshot helper $CaptureScript"
  }
  if (-not (Test-Path -LiteralPath $NodeRuntime)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
      throw "Node.js was not found at $NodeRuntime or on PATH."
    }
    $script:NodeRuntime = $nodeCommand.Source
  }

  $configuredPassphrase = Get-EnvFileValue -Path $EnvFile -Name "VITE_NETWORK_PASSPHRASE"
  $configuredRpc = (Get-EnvFileValue -Path $EnvFile -Name "VITE_RPC_URL").TrimEnd("/")
  $configuredHorizon = (Get-EnvFileValue -Path $EnvFile -Name "VITE_HORIZON_URL").TrimEnd("/")
  $configuredExplorer = (Get-EnvFileValue -Path $EnvFile -Name "VITE_STELLAR_EXPLORER_URL").TrimEnd("/")
  if ($configuredPassphrase -ne $TestnetPassphrase) {
    throw "Network fuse rejected a non-Testnet passphrase."
  }
  if ($configuredRpc -notmatch "soroban-testnet\.stellar\.org") {
    throw "Network fuse rejected RPC URL $configuredRpc"
  }
  if ($configuredHorizon -notmatch "horizon-testnet\.stellar\.org") {
    throw "Network fuse rejected Horizon URL $configuredHorizon"
  }
  if ($configuredExplorer -notmatch "/testnet$") {
    throw "Network fuse rejected explorer URL $configuredExplorer"
  }

  $health = Invoke-WithRetry -Description "Testnet RPC health check" -Action {
    Invoke-Rpc -Method "getHealth"
  }
  if ($health.status -ne "healthy") {
    throw "Stellar Testnet RPC is not healthy."
  }
}

function Ensure-Event {
  param(
    [Parameter(Mandatory)] $Event,
    [Parameter(Mandatory)][string] $TicketContractId,
    [Parameter(Mandatory)][string] $OrganizerAddress
  )

  Invoke-TrackedContractTransaction `
    -Record $Event.creation `
    -ContractId $TicketContractId `
    -SourceIdentity $OrganizerIdentity `
    -SourceAddress $OrganizerAddress `
    -FunctionName "create_event" `
    -FunctionArguments @{
      organizer = $OrganizerAddress
      event_id = ConvertTo-ContractString -Value ([string] $Event.id)
      name = ConvertTo-ContractString -Value ([string] $Event.name)
      date_unix = [string] $Event.startUnix
      end_unix = [string] $Event.endUnix
      capacity = [string] $Event.capacity
      price_per_ticket = [string] $Event.priceStroops
    } | Out-Null
}

function Get-ActorEvent {
  param([Parameter(Mandatory)] $Actor)
  switch ([string] $Actor.cohort) {
    "cancelled" { return $script:State.events.cancelled }
    "marketplace" { return $script:State.events.marketplace }
    default { return $script:State.events.general }
  }
}

function Ensure-ActorPurchase {
  param(
    [Parameter(Mandatory)] $Actor,
    [Parameter(Mandatory)][string] $TicketContractId
  )

  $event = Get-ActorEvent -Actor $Actor
  Invoke-TrackedContractTransaction `
    -Record $Actor.purchase `
    -ContractId $TicketContractId `
    -SourceIdentity ([string] $Actor.identity) `
    -SourceAddress ([string] $Actor.address) `
    -FunctionName "purchase" `
    -FunctionArguments @{
      event_id = ConvertTo-ContractString -Value ([string] $event.id)
      buyer = [string] $Actor.address
      ticket_id = ConvertTo-ContractString -Value ([string] $Actor.ticketId)
    } | Out-Null

  $Actor.proofTxHash = [string] $Actor.purchase.txHash
  Save-State
}

function Invoke-SecondaryActivity {
  $openSellers = @($script:State.actors | Where-Object { $_.activityRole -eq "listing-open" })
  $cancelledSellers = @($script:State.actors | Where-Object { $_.activityRole -eq "listing-cancelled" })
  $soldSellers = @($script:State.actors | Where-Object { $_.activityRole -eq "listing-sold" })
  $resaleBuyers = @($script:State.actors | Where-Object { $_.activityRole -eq "resale-buyer" })
  $refundActors = @($script:State.actors | Where-Object { $_.activityRole -eq "refund" })
  $allSellers = @($openSellers + $cancelledSellers + $soldSellers)

  foreach ($seller in $allSellers) {
    $listingId = "st65-$RunId-listing-{0:d2}" -f ([int] $seller.index)
    $listRecord = Get-OrCreateSecondaryOperation -Id ("list-{0:d2}" -f ([int] $seller.index))
    Invoke-TrackedContractTransaction `
      -Record $listRecord `
      -ContractId ([string] $script:State.marketplaceContractId) `
      -SourceIdentity ([string] $seller.identity) `
      -SourceAddress ([string] $seller.address) `
      -FunctionName "list_ticket" `
      -FunctionArguments @{
        seller = [string] $seller.address
        listing_id = ConvertTo-ContractString -Value $listingId
        ticket_id = ConvertTo-ContractString -Value ([string] $seller.ticketId)
        event_id = ConvertTo-ContractString -Value ([string] $script:State.events.marketplace.id)
        ask_price = "1600000"
      } | Out-Null
    $seller.proofTxHash = [string] $listRecord.txHash
    Save-State
  }

  for ($index = 0; $index -lt $soldSellers.Count; $index++) {
    if ($index -ge $resaleBuyers.Count) {
      throw "The activity plan has a sold listing without a paired resale buyer."
    }
    $seller = $soldSellers[$index]
    $buyer = $resaleBuyers[$index]
    $listingId = "st65-$RunId-listing-{0:d2}" -f ([int] $seller.index)
    $buyRecord = Get-OrCreateSecondaryOperation -Id ("buy-listing-{0:d2}" -f ([int] $seller.index))
    Invoke-TrackedContractTransaction `
      -Record $buyRecord `
      -ContractId ([string] $script:State.marketplaceContractId) `
      -SourceIdentity ([string] $buyer.identity) `
      -SourceAddress ([string] $buyer.address) `
      -FunctionName "buy_listing" `
      -FunctionArguments @{
        seller = [string] $seller.address
        listing_id = ConvertTo-ContractString -Value $listingId
        buyer = [string] $buyer.address
      } | Out-Null
    $buyer.proofTxHash = [string] $buyRecord.txHash
    Save-State
  }

  foreach ($seller in $cancelledSellers) {
    $listingId = "st65-$RunId-listing-{0:d2}" -f ([int] $seller.index)
    $cancelRecord = Get-OrCreateSecondaryOperation -Id ("cancel-listing-{0:d2}" -f ([int] $seller.index))
    Invoke-TrackedContractTransaction `
      -Record $cancelRecord `
      -ContractId ([string] $script:State.marketplaceContractId) `
      -SourceIdentity ([string] $seller.identity) `
      -SourceAddress ([string] $seller.address) `
      -FunctionName "cancel_listing" `
      -FunctionArguments @{
        seller = [string] $seller.address
        listing_id = ConvertTo-ContractString -Value $listingId
      } | Out-Null
    $seller.proofTxHash = [string] $cancelRecord.txHash
    Save-State
  }

  if ($refundActors.Count -gt 0) {
    $cancelEventRecord = Get-OrCreateSecondaryOperation -Id "cancel-event"
    Invoke-TrackedContractTransaction `
      -Record $cancelEventRecord `
      -ContractId ([string] $script:State.ticketContractId) `
      -SourceIdentity ([string] $script:State.organizerIdentity) `
      -SourceAddress ([string] $script:State.organizerAddress) `
      -FunctionName "cancel_event" `
      -FunctionArguments @{
        event_id = ConvertTo-ContractString -Value ([string] $script:State.events.cancelled.id)
        organizer = [string] $script:State.organizerAddress
      } | Out-Null

    foreach ($actor in $refundActors) {
      $refundRecord = Get-OrCreateSecondaryOperation -Id ("refund-{0:d2}" -f ([int] $actor.index))
      Invoke-TrackedContractTransaction `
        -Record $refundRecord `
        -ContractId ([string] $script:State.ticketContractId) `
        -SourceIdentity ([string] $actor.identity) `
        -SourceAddress ([string] $actor.address) `
        -FunctionName "refund" `
        -FunctionArguments @{
          ticket_id = ConvertTo-ContractString -Value ([string] $actor.ticketId)
          attendee = [string] $actor.address
        } | Out-Null
      $actor.proofTxHash = [string] $refundRecord.txHash
      Save-State
    }
  }
}

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $ProofDirectory -Force | Out-Null
try {
  $script:WorkerLock = [System.IO.File]::Open(
    $LockFile,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
}
catch {
  throw "Another Testnet user worker appears to be running. Lock: $LockFile"
}

Assert-Preflight

$TicketContractId = Get-EnvFileValue -Path $EnvFile -Name "VITE_TICKET_CONTRACT_ID"
$MarketplaceContractId = Get-EnvFileValue -Path $EnvFile -Name "VITE_MARKETPLACE_CONTRACT_ID"
$OrganizerAddress = Get-IdentityAddress -Identity $OrganizerIdentity
if (-not $OrganizerAddress) {
  throw "Required organizer identity '$OrganizerIdentity' is missing from $ConfigDir"
}
Get-HorizonAccount -Address $OrganizerAddress | Out-Null

if (Test-Path -LiteralPath $StateFile) {
  if (-not $Resume) {
    throw "Run state already exists at $StateFile. Use -Resume or choose another -RunId."
  }
  $script:State = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
  if (
    $script:State.networkPassphrase -ne $TestnetPassphrase -or
    $script:State.ticketContractId -ne $TicketContractId -or
    $script:State.marketplaceContractId -ne $MarketplaceContractId
  ) {
    throw "Resume fuse rejected changed network or contract identity."
  }
  Write-WorkerLog "Resuming run $RunId."
}
else {
  $script:State = Initialize-State `
    -TicketContractId $TicketContractId `
    -MarketplaceContractId $MarketplaceContractId `
    -OrganizerAddress $OrganizerAddress
  Save-State
  Write-WorkerLog "Initialized Testnet run $RunId for $UserCount user accounts."
}

Ensure-Event -Event $script:State.events.general -TicketContractId $TicketContractId -OrganizerAddress $OrganizerAddress
if (-not [bool] $script:State.smokeMode) {
  Ensure-Event -Event $script:State.events.marketplace -TicketContractId $TicketContractId -OrganizerAddress $OrganizerAddress
  Ensure-Event -Event $script:State.events.cancelled -TicketContractId $TicketContractId -OrganizerAddress $OrganizerAddress
}

$runStartedUtc = [datetime]::Parse([string] $script:State.startedUtc).ToUniversalTime()
foreach ($actor in @($script:State.actors | Sort-Object activationOffsetSeconds)) {
  $activationTarget = $runStartedUtc.AddSeconds([int] $actor.activationOffsetSeconds)
  Wait-Until -TargetUtc $activationTarget
  Ensure-FundedIdentity -Actor $actor
  Ensure-ActorPurchase -Actor $actor -TicketContractId $TicketContractId
}

if (-not [bool] $script:State.smokeMode) {
  Invoke-SecondaryActivity
}

$missingProofTransactions = @(
  $script:State.actors |
    Where-Object { -not $_.address -or -not $_.proofTxHash }
)
if ($missingProofTransactions.Count -gt 0) {
  throw "$($missingProofTransactions.Count) accounts are missing a public address or confirmed proof transaction."
}

$script:State.status = "capturing-proofs"
Save-State

$captureResult = Invoke-External -FilePath $NodeRuntime -Arguments @(
  $CaptureScript,
  "--state", $StateFile,
  "--output", $ProofDirectory
)
if ($captureResult.ExitCode -ne 0) {
  throw "Proof capture failed: $($captureResult.Output)"
}

$script:State.status = "complete"
$script:State.completedUtc = Get-UtcIso
Save-State

Write-WorkerLog "Run $RunId completed."
Write-WorkerLog "GitHub-ready proof package: $ProofDirectory"
Write-Host $captureResult.Output
$script:WorkerLock.Dispose()
