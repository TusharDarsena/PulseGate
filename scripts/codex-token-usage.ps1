param(
  [ValidateSet("Sol", "Terra", "Luna")]
  [string]$Model = "Terra",
  [switch]$Watch,
  [int]$IntervalSeconds = 15,
  [string]$SessionPath
)

$ErrorActionPreference = "Stop"
$culture = [System.Globalization.CultureInfo]::InvariantCulture

$rates = @{
  Sol = @{ input = 125.0; cached = 12.5; output = 750.0 }
  Terra = @{ input = 62.5; cached = 6.25; output = 375.0 }
  Luna = @{ input = 25.0; cached = 2.5; output = 150.0 }
}

function Get-LatestSessionPath {
  $sessionRoot = Join-Path $env:USERPROFILE ".codex\sessions"
  if (-not (Test-Path -LiteralPath $sessionRoot)) {
    throw "Codex session directory was not found: $sessionRoot"
  }

  $latest = Get-ChildItem -LiteralPath $sessionRoot -Recurse -Filter "*.jsonl" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw "No Codex session logs were found under $sessionRoot"
  }

  $latest.FullName
}

function Format-Number([double]$Value) {
  [Math]::Round($Value, 2).ToString("N2", $culture)
}

function Format-Integer([double]$Value) {
  $Value.ToString("N0", $culture)
}

function Show-Usage {
  param([string]$Path)

  $lastTokenEvent = $null
  $sessionMeta = $null

  Get-Content -LiteralPath $Path -ErrorAction Stop | ForEach-Object {
    if (-not $_) { return }

    try {
      $entry = $_ | ConvertFrom-Json -ErrorAction Stop
    } catch {
      return
    }

    if ($entry.type -eq "session_meta") {
      $sessionMeta = $entry.payload
    }

    if ($entry.type -eq "event_msg" -and $entry.payload.type -eq "token_count") {
      $lastTokenEvent = $entry
    }
  }

  Clear-Host
  Write-Host "Codex usage snapshot" -ForegroundColor Cyan
  Write-Host ("Session: " + $Path)

  if ($sessionMeta -and $sessionMeta.cwd) {
    Write-Host ("Workspace: " + $sessionMeta.cwd)
  }

  if (-not $lastTokenEvent) {
    Write-Host ""
    Write-Host "No token_count events found yet."
    return
  }

  $usage = $lastTokenEvent.payload.info.total_token_usage
  $last = $lastTokenEvent.payload.info.last_token_usage
  $limits = $lastTokenEvent.payload.rate_limits

  $inputTokens = [double]$usage.input_tokens
  $cachedTokens = [double]$usage.cached_input_tokens
  $uncachedTokens = [Math]::Max(0, $inputTokens - $cachedTokens)
  $outputTokens = [double]$usage.output_tokens
  $reasoningTokens = [double]$usage.reasoning_output_tokens
  $totalTokens = [double]$usage.total_tokens
  $contextWindow = [double]$lastTokenEvent.payload.info.model_context_window

  $modelRates = $rates[$Model]
  $estimatedCredits =
    ($uncachedTokens / 1000000.0 * $modelRates.input) +
    ($cachedTokens / 1000000.0 * $modelRates.cached) +
    ($outputTokens / 1000000.0 * $modelRates.output)

  Write-Host ""
  Write-Host ("Model estimate: " + $Model)
  Write-Host ("Total tokens: " + (Format-Integer $totalTokens))
  Write-Host ("Input tokens: " + (Format-Integer $inputTokens))
  Write-Host ("Cached input: " + (Format-Integer $cachedTokens))
  Write-Host ("Uncached input estimate: " + (Format-Integer $uncachedTokens))
  Write-Host ("Output tokens: " + (Format-Integer $outputTokens))
  Write-Host ("Reasoning output: " + (Format-Integer $reasoningTokens))
  Write-Host ("Estimated credits: " + (Format-Number $estimatedCredits))

  if ($limits -and $limits.primary -and $null -ne $limits.primary.used_percent) {
    Write-Host ("Plan limit used: " + $limits.primary.used_percent + "%")
  }

  if ($last) {
    Write-Host ""
    Write-Host "Last model step"
    Write-Host ("Input: " + (Format-Integer ([double]$last.input_tokens)))
    Write-Host ("Cached: " + (Format-Integer ([double]$last.cached_input_tokens)))
    Write-Host ("Output: " + (Format-Integer ([double]$last.output_tokens)))
    Write-Host ("Total: " + (Format-Integer ([double]$last.total_tokens)))

    if ($contextWindow -gt 0) {
      $stepContextPercent = ([double]$last.input_tokens / $contextWindow) * 100
      Write-Host ("Step context window: " + (Format-Number $stepContextPercent) + "%")
    }
  }

  Write-Host ""
  Write-Host "Tip: use -Model Sol, -Model Terra, or -Model Luna to change the estimate."
}

$pathToRead = if ($SessionPath) { (Resolve-Path -LiteralPath $SessionPath).Path } else { Get-LatestSessionPath }

if ($Watch) {
  while ($true) {
    Show-Usage -Path $pathToRead
    Start-Sleep -Seconds $IntervalSeconds
  }
} else {
  Show-Usage -Path $pathToRead
}
