#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$RepoRoot = (Get-Location).Path,
    [string]$OutputDirectory = "",

    [switch]$IncludeTests,
    [switch]$IncludeStyles,
    [switch]$IncludeGeneratedBindings,
    [switch]$IncludeVisualE2E,
    [switch]$IncludeTestFunding
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Resolve repository
# ---------------------------------------------------------------------------

$resolvedRoot = @(
    git -C $RepoRoot rev-parse --show-toplevel 2>$null
)

if ($LASTEXITCODE -ne 0 -or $resolvedRoot.Count -eq 0) {
    throw "Run this script inside the PulseGate Git repository."
}

$RepoRoot = $resolvedRoot[0].Trim()

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path `
        (Split-Path -Parent $RepoRoot) `
        "_ingests"
}

New-Item `
    -ItemType Directory `
    -Path $OutputDirectory `
    -Force | Out-Null

# Tracked files plus new non-ignored files.
$files = @(
    git -c core.quotepath=false -C $RepoRoot `
        ls-files --cached --others --exclude-standard
) |
    ForEach-Object { $_ -replace "\\", "/" } |
    Sort-Object -Unique

# ---------------------------------------------------------------------------
# Output helper
# ---------------------------------------------------------------------------

function Write-Ingest {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Title,

        [Parameter(Mandatory)]
        [string[]]$Paths
    )

    $selected = @(
        $Paths |
            Sort-Object -Unique |
            Where-Object {
                $nativePath = $_ -replace `
                    "/", `
                    [IO.Path]::DirectorySeparatorChar

                Test-Path `
                    -LiteralPath (Join-Path $RepoRoot $nativePath) `
                    -PathType Leaf
            }
    )

    $outputPath = Join-Path $OutputDirectory $Name
    $encoding = [Text.UTF8Encoding]::new($false)

    $writer = [IO.StreamWriter]::new(
        $outputPath,
        $false,
        $encoding
    )

    try {
        $writer.WriteLine($Title)
        $writer.WriteLine(
            "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        )
        $writer.WriteLine("Files: $($selected.Count)")
        $writer.WriteLine()

        foreach ($relativePath in $selected) {
            $nativePath = $relativePath -replace `
                "/", `
                [IO.Path]::DirectorySeparatorChar

            $fullPath = Join-Path $RepoRoot $nativePath

            $writer.WriteLine(
                "================================================"
            )
            $writer.WriteLine("FILE: $relativePath")
            $writer.WriteLine(
                "================================================"
            )
            $writer.WriteLine(
                [IO.File]::ReadAllText($fullPath)
            )
            $writer.WriteLine()
        }
    }
    finally {
        $writer.Dispose()
    }

    $size = (Get-Item -LiteralPath $outputPath).Length
    $estimatedTokens = [Math]::Ceiling($size / 4)

    Write-Host $Name -ForegroundColor Green
    Write-Host "  Files: $($selected.Count)"
    Write-Host "  Size: $([Math]::Round($size / 1KB, 1)) KB"
    Write-Host "  Estimated tokens: $estimatedTokens"
}

# ---------------------------------------------------------------------------
# 1. Soroban smart contracts
# ---------------------------------------------------------------------------

$contractFiles = @(
    $files | Where-Object {
        $path = $_

        $isManifest =
            $path -eq "contracts/Cargo.toml" -or
            $path -match "^contracts/[^/]+/Cargo\.toml$"

        $isRustSource =
            $path -match "^contracts/[^/]+/src/.*\.rs$"

        $isTest =
            $path -match "/test\.rs$"

        $isSnapshot =
            $path -match "(^|/)test_snapshots/"

        -not $isSnapshot -and (
            $isManifest -or
            (
                $isRustSource -and
                ($IncludeTests -or -not $isTest)
            )
        )
    }
)

# ---------------------------------------------------------------------------
# 2. Frontend UI and application layer
# ---------------------------------------------------------------------------

# Small frontend-only helpers that contain application behaviour.
$frontendHelpers = @(
    "frontend/src/lib/authIntent.ts",
    "frontend/src/lib/eventActions.ts",
    "frontend/src/lib/eventModel.ts",
    "frontend/src/lib/utils.ts"
)

$frontendFiles = @(
    $files | Where-Object {
        $path = $_

        $isEntry =
            $path -in @(
                "frontend/src/main.tsx",
                "frontend/src/App.tsx"
            )

        $isApplicationSource =
            $path -match (
                "^frontend/src/" +
                "(auth|components|hooks|pages|types)/.*\.(ts|tsx)$"
            )

        $isStore =
            $path -match "^frontend/src/store/.*\.(ts|tsx)$"

        $isFrontendHelper =
            $frontendHelpers -contains $path

        $isTest =
            $path -match "\.(test|spec)\.(ts|tsx)$" -or
            $path -match "^frontend/src/test/"

        $isStyle =
            $path -match "^frontend/src/.*\.css$"

        $isGeneratedBinding =
            $path -match "^frontend/src/contracts/"

        $isVisualE2E =
            $path -match "^frontend/e2e/" -or
            $path -eq "frontend/playwright.screenshots.config.ts"

        (
            (
                $isEntry -or
                $isApplicationSource -or
                $isStore -or
                $isFrontendHelper
            ) -and
            ($IncludeTests -or -not $isTest)
        ) -or
        (
            $IncludeTests -and
            $isTest
        ) -or
        (
            $IncludeStyles -and
            $isStyle
        ) -or
        (
            $IncludeGeneratedBindings -and
            $isGeneratedBinding
        ) -or
        (
            $IncludeVisualE2E -and
            $isVisualE2E
        )
    }
)

# ---------------------------------------------------------------------------
# 3. Backend, database and Web3 integrations
# ---------------------------------------------------------------------------

$integrationFiles = @(
    "frontend/src/lib/constants.ts",
    "frontend/src/lib/dfns.ts",
    "frontend/src/lib/purchaseOperations.ts",
    "frontend/src/lib/qr.ts",
    "frontend/src/lib/soroban.ts",
    "frontend/src/lib/stellar.ts",
    "frontend/src/lib/supabase.ts",
    "frontend/src/lib/ticketOperations.ts"
)

$backendFiles = @(
    $files | Where-Object {
        $path = $_

        $isEdgeFunction =
            $path -match "^supabase/functions/.*\.ts$"

        # Exclude explicitly non-production function areas by default.
        $isDeveloperFunction =
            $path -match (
                "^supabase/functions/" +
                "(_dev|_proof|proof|dev|experimental)/"
            )

        $isTestFunding =
            $path -match "^supabase/functions/test-funding/"

        $isMigration =
            $path -match "^supabase/migrations/.*\.sql$"

        $isIntegration =
            $integrationFiles -contains $path

        $isTest =
            $path -match "\.(test|spec)\.(ts|tsx)$"

        $includeFunction =
            $isEdgeFunction -and
            -not $isDeveloperFunction -and
            (
                $IncludeTestFunding -or
                -not $isTestFunding
            )

        (
            $includeFunction -or
            $isMigration -or
            $isIntegration
        ) -and
        (
            $IncludeTests -or
            -not $isTest
        )
    }
)

# ---------------------------------------------------------------------------
# Generate ingests
# ---------------------------------------------------------------------------

Write-Ingest `
    -Name "Soroban Smart Contracts (On-Chain Core).txt" `
    -Title "Soroban Smart Contracts - On-Chain Core" `
    -Paths $contractFiles

Write-Ingest `
    -Name "Frontend UI & Application Layer.txt" `
    -Title "Frontend UI and Application Layer" `
    -Paths $frontendFiles

Write-Ingest `
    -Name "Backend, Database & Web3 Integrations.txt" `
    -Title "Backend, Database and Web3 Integrations" `
    -Paths $backendFiles

Write-Host ""
Write-Host "Ingest files created in:" -ForegroundColor Green
Write-Host $OutputDirectory
Write-Host ""
Write-Host "Tests included: $([bool]$IncludeTests)"
Write-Host "Styles included: $([bool]$IncludeStyles)"
Write-Host (
    "Generated bindings included: " +
    "$([bool]$IncludeGeneratedBindings)"
)
Write-Host "Visual E2E included: $([bool]$IncludeVisualE2E)"
Write-Host "Test funding included: $([bool]$IncludeTestFunding)"
