#requires -Version 5.1

<#
.SYNOPSIS
Creates a compact, coding-focused ZIP of the StellarTickets repository.

.DESCRIPTION
Includes:
  - Git-tracked files
  - New, non-ignored files
  - Active source, tests, migrations, contracts, documentation and CI files

Excludes by default:
  - .agents/
  - .codex/
  - JavaScript lockfiles
  - node_modules and build output
  - Soroban test snapshots
  - screenshots and test output outside active source directories
  - environment secrets
  - old ZIPs and generated repository dumps
  - this packaging script itself

The ZIP contains:
  - _AI_REPO_NAVIGATION.md
  - _AI_FILE_LIST.txt
  - _AI_SKIPPED_FILES.txt

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\New-StellarTicketsCodingZip.ps1
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Get-Location).Path,

    [Parameter()]
    [string]$OutputDirectory = "",

    [Parameter()]
    [ValidateRange(1, 500)]
    [int]$MaxFileSizeMB = 15,

    [Parameter()]
    [switch]$IncludeExamples,

    [Parameter()]
    [switch]$IncludePatches,

    [Parameter()]
    [switch]$IncludeAgentConfig,

    [Parameter()]
    [switch]$IncludeLockFiles,

    [Parameter()]
    [switch]$IncludeContractSnapshots
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-RelativePath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return (($Path -replace "\\", "/").TrimStart("/"))
}

function Test-MatchesAnyPattern {
    param(
        [Parameter(Mandatory)]
        [string]$Value,

        [Parameter(Mandatory)]
        [string[]]$Patterns
    )

    foreach ($pattern in $Patterns) {
        if ($Value -like $pattern) {
            return $true
        }
    }

    return $false
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue

if (-not $gitCommand) {
    throw "Git is required but git.exe was not found."
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

$insideWorkTree = & $gitCommand.Source `
    -C $RepoRoot `
    rev-parse `
    --is-inside-work-tree 2>$null

if (
    $LASTEXITCODE -ne 0 -or
    ($insideWorkTree | Select-Object -First 1) -ne "true"
) {
    throw "The supplied path is not inside a Git repository: $RepoRoot"
}

$repositoryTopLevel = & $gitCommand.Source `
    -C $RepoRoot `
    rev-parse `
    --show-toplevel 2>$null

if ($LASTEXITCODE -ne 0 -or -not $repositoryTopLevel) {
    throw "Could not determine the Git repository root."
}

$RepoRoot = (
    Resolve-Path -LiteralPath (
        ($repositoryTopLevel | Select-Object -First 1).Trim()
    )
).Path

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path `
        (Split-Path -Parent $RepoRoot) `
        "_coding-packages"
}

$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

New-Item `
    -ItemType Directory `
    -Path $OutputDirectory `
    -Force | Out-Null

# ---------------------------------------------------------------------------
# Coding-source allowlist
# ---------------------------------------------------------------------------

$AllowedRoots = @(
    ".github",
    "contracts",
    "docs",
    "frontend",
    "scripts",
    "supabase"
)

if ($IncludeExamples) {
    $AllowedRoots += "examples"
}

if ($IncludePatches) {
    $AllowedRoots += "patches"
}

if ($IncludeAgentConfig) {
    $AllowedRoots += ".agents"
    $AllowedRoots += ".codex"
}

# Only these files are allowed directly at repository root.
$AllowedRootFilePatterns = @(
    "AGENTS.md",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "LICENSE",
    "LICENSE.*",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".nvmrc",
    ".node-version",
    ".tool-versions",
    ".env.example",
    ".env.sample",
    ".env.template",
    "package.json",
    "tsconfig.json",
    "tsconfig.*.json",
    "eslint.config.*",
    "prettier.config.*",
    "vite.config.*",
    "vitest.config.*",
    "playwright.config.*",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain",
    "rust-toolchain.toml",
    "deny.toml",
    "supabase_schema.sql",
    "Dockerfile",
    "Dockerfile.*",
    "docker-compose.yml",
    "docker-compose.yaml",
    "docker-compose.*.yml",
    "docker-compose.*.yaml",
    "vercel.json",
    "netlify.toml"
)

if ($IncludeLockFiles) {
    $AllowedRootFilePatterns += @(
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "bun.lockb"
    )
}

# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------

# Do not put "screenshots" here.
# frontend/e2e/screenshots contains active Playwright source files.
$ExcludedDirectoryNames = @(
    ".git",
    ".pnpm-store",
    "node_modules",
    "target",
    "dist",
    ".dist",
    "build",
    "out",
    "coverage",
    ".nyc_output",
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".vite",
    ".next",
    ".svelte-kit",
    ".angular",
    ".temp",
    "tmp",
    "temp",
    "test-results",
    "playwright-report",
    "blob-report",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "zip for e2e, not relevant"
)

$ExcludedFilePatterns = @(
    "*.zip",
    "*.7z",
    "*.rar",
    "*.tar",
    "*.gz",
    "*.tgz",
    "*.log",
    "*.tmp",
    "*.temp",
    "*.bak",
    "*.swp",
    "*.swo",
    "*.pid",
    "*.dmp",
    "*.exe",
    "*.dll",
    "*.so",
    "*.dylib",
    "*.wasm",
    "*.class",
    "*.pyc",
    "*.pyo",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
    "*.keystore",
    "id_rsa*",
    "credentials*.json",
    "service-account*.json",
    "service_account*.json",
    "secrets*.json",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "repomix-output.*",
    "source_library_workspace*.html*",
    "screenshot-*-context.*",

    # Never package the packaging script itself.
    "New-StellarTicketsCodingZip*.ps1"
)

$JavaScriptLockFileNames = @(
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
)

$SafeEnvironmentFileNames = @(
    ".env.example",
    ".env.sample",
    ".env.template"
)

function Test-IsAllowedPath {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath
    )

    $normalized = Normalize-RelativePath $RelativePath

    if (-not $normalized.Contains("/")) {
        return Test-MatchesAnyPattern `
            -Value $normalized `
            -Patterns $AllowedRootFilePatterns
    }

    $topLevel = $normalized.Split("/")[0]

    return $AllowedRoots -contains $topLevel
}

function Get-ExclusionReason {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath
    )

    $normalized = Normalize-RelativePath $RelativePath
    $parts = $normalized.Split("/")
    $fileName = $parts[$parts.Count - 1]

    if ($parts.Count -gt 1) {
        for ($index = 0; $index -lt ($parts.Count - 1); $index++) {
            if ($ExcludedDirectoryNames -contains $parts[$index]) {
                return "excluded directory: $($parts[$index])"
            }
        }
    }

    if (
        -not $IncludeContractSnapshots -and
        $normalized -match "(^|/)test_snapshots/"
    ) {
        return "generated Soroban test snapshot"
    }

    if (
        -not $IncludeLockFiles -and
        $JavaScriptLockFileNames -contains $fileName
    ) {
        return "JavaScript lockfile excluded by default"
    }

    if (
        $fileName -like ".env*" -and
        $SafeEnvironmentFileNames -notcontains $fileName
    ) {
        return "local environment or secret file"
    }

    foreach ($pattern in $ExcludedFilePatterns) {
        if ($fileName -like $pattern) {
            return "excluded file pattern: $pattern"
        }
    }

    return $null
}

# ---------------------------------------------------------------------------
# Snapshot information
# ---------------------------------------------------------------------------

$repoName = Split-Path -Leaf $RepoRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$commitHash = (
    & $gitCommand.Source `
        -C $RepoRoot `
        rev-parse `
        HEAD 2>$null |
        Select-Object -First 1
)

if (-not $commitHash) {
    $commitHash = "unknown"
}

$commitHash = $commitHash.Trim()

$shortCommit = (
    & $gitCommand.Source `
        -C $RepoRoot `
        rev-parse `
        --short=10 `
        HEAD 2>$null |
        Select-Object -First 1
)

if (-not $shortCommit) {
    $shortCommit = "no-commit"
}

$shortCommit = $shortCommit.Trim()

$branchName = (
    & $gitCommand.Source `
        -C $RepoRoot `
        branch `
        --show-current 2>$null |
        Select-Object -First 1
)

if (-not $branchName) {
    $branchName = "(detached HEAD)"
}

$branchName = $branchName.Trim()

$zipName = (
    "$repoName-coding-source-" +
    "$timestamp-" +
    "$shortCommit.zip"
)

$zipPath = Join-Path $OutputDirectory $zipName

$stagingRoot = Join-Path `
    ([System.IO.Path]::GetTempPath()) `
    ("stellar-coding-source-" + [Guid]::NewGuid().ToString("N"))

$maxFileBytes = [int64]$MaxFileSizeMB * 1MB
$copiedCount = 0
$copiedBytes = [int64]0

$skipped = [System.Collections.Generic.List[object]]::new()

try {
    New-Item `
        -ItemType Directory `
        -Path $stagingRoot `
        -Force | Out-Null

    # Includes tracked files and new non-ignored files.
    $gitOutput = @(
        & $gitCommand.Source `
            -c core.quotepath=false `
            -C $RepoRoot `
            ls-files `
            --cached `
            --others `
            --exclude-standard 2>&1
    )

    if ($LASTEXITCODE -ne 0) {
        throw (
            "git ls-files failed:" +
            [Environment]::NewLine +
            ($gitOutput -join [Environment]::NewLine)
        )
    }

    $candidatePaths = @(
        $gitOutput |
            Where-Object {
                $_ -is [string] -and
                -not [string]::IsNullOrWhiteSpace($_)
            } |
            ForEach-Object {
                Normalize-RelativePath $_
            } |
            Sort-Object -Unique
    )

    foreach ($relativePath in $candidatePaths) {
        if (-not (Test-IsAllowedPath -RelativePath $relativePath)) {
            $skipped.Add(
                [pscustomobject]@{
                    Path   = $relativePath
                    Reason = "outside coding allowlist"
                }
            )

            continue
        }

        $exclusionReason = Get-ExclusionReason `
            -RelativePath $relativePath

        if ($exclusionReason) {
            $skipped.Add(
                [pscustomobject]@{
                    Path   = $relativePath
                    Reason = $exclusionReason
                }
            )

            continue
        }

        $nativeRelativePath = $relativePath -replace (
            "/",
            [System.IO.Path]::DirectorySeparatorChar
        )

        $sourcePath = Join-Path $RepoRoot $nativeRelativePath

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            $skipped.Add(
                [pscustomobject]@{
                    Path   = $relativePath
                    Reason = "path is absent from the working tree"
                }
            )

            continue
        }

        $sourceItem = Get-Item `
            -LiteralPath $sourcePath `
            -Force

        if (
            (
                $sourceItem.Attributes -band
                [System.IO.FileAttributes]::ReparsePoint
            ) -ne 0
        ) {
            $skipped.Add(
                [pscustomobject]@{
                    Path   = $relativePath
                    Reason = "symbolic link or reparse point"
                }
            )

            continue
        }

        if ($sourceItem.Length -gt $maxFileBytes) {
            $sizeMB = [Math]::Round(
                $sourceItem.Length / 1MB,
                2
            )

            $skipped.Add(
                [pscustomobject]@{
                    Path   = $relativePath
                    Reason = (
                        "file is $sizeMB MB; " +
                        "limit is $MaxFileSizeMB MB"
                    )
                }
            )

            continue
        }

        $destinationPath = Join-Path `
            $stagingRoot `
            $nativeRelativePath

        $destinationDirectory = Split-Path `
            -Parent $destinationPath

        New-Item `
            -ItemType Directory `
            -Path $destinationDirectory `
            -Force | Out-Null

        Copy-Item `
            -LiteralPath $sourcePath `
            -Destination $destinationPath `
            -Force

        $copiedCount++
        $copiedBytes += $sourceItem.Length
    }

    if ($copiedCount -eq 0) {
        throw "No files passed the coding-source filters."
    }

    # -----------------------------------------------------------------------
    # Generate repository navigation
    # -----------------------------------------------------------------------

    $stagedFiles = @(
        Get-ChildItem `
            -LiteralPath $stagingRoot `
            -Recurse `
            -File `
            -Force |
            ForEach-Object {
                $relative = $_.FullName.Substring(
                    $stagingRoot.Length
                )

                Normalize-RelativePath (
                    $relative -replace "^[\\/]+", ""
                )
            } |
            Sort-Object
    )

    $areaCounts = @(
        $stagedFiles |
            Group-Object {
                if ($_.Contains("/")) {
                    $_.Split("/")[0]
                }
                else {
                    "(root)"
                }
            } |
            Sort-Object Name
    )

    $supabaseFunctions = @(
        $stagedFiles |
            Where-Object {
                $_ -match (
                    "^supabase/functions/" +
                    "[^/]+/index\.ts$"
                )
            } |
            Sort-Object
    )

    $migrations = @(
        $stagedFiles |
            Where-Object {
                $_ -match "^supabase/migrations/.*\.sql$"
            } |
            Sort-Object
    )

    $contractManifests = @(
        $stagedFiles |
            Where-Object {
                $_ -match "^contracts/[^/]+/Cargo\.toml$"
            } |
            Sort-Object
    )

    $testFiles = @(
        $stagedFiles |
            Where-Object {
                $_ -notmatch "(^|/)test_snapshots/" -and
                (
                    $_ -match (
                        "(^|/)" +
                        "(__tests__|tests?|e2e)/"
                    ) -or
                    $_ -match "\.(test|spec)\.[^.]+$" -or
                    $_ -match "/test\.rs$"
                )
            } |
            Sort-Object
    )

    $contractSnapshots = @(
        $stagedFiles |
            Where-Object {
                $_ -match "(^|/)test_snapshots/"
            } |
            Sort-Object
    )

    $gitStatus = @(
        & $gitCommand.Source `
            -c core.quotepath=false `
            -C $RepoRoot `
            status `
            --short 2>$null
    )

    $recentCommits = @(
        & $gitCommand.Source `
            -C $RepoRoot `
            log `
            -n 8 `
            --date=short `
            --pretty=format:"%h %ad %s" 2>$null
    )

    $navigationLines = [System.Collections.Generic.List[string]]::new()

    $navigationLines.Add("# AI Repository Navigation")
    $navigationLines.Add("")
    $navigationLines.Add(
        "This file is generated for the current coding ZIP."
    )
    $navigationLines.Add(
        "Start from the user's task and search relevant identifiers."
    )
    $navigationLines.Add(
        "Do not read README.md, AGENTS.md, tests, or documentation automatically."
    )
    $navigationLines.Add(
        "Open them only when the task requires their instructions or context."
    )
    $navigationLines.Add("")
    $navigationLines.Add("## Snapshot")
    $navigationLines.Add("")
    $navigationLines.Add("- Repository: $repoName")
    $navigationLines.Add(
        "- Generated: " +
        (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    )
    $navigationLines.Add("- Branch: $branchName")
    $navigationLines.Add("- HEAD: $commitHash")
    $navigationLines.Add(
        "- Included source files: $copiedCount"
    )
    $navigationLines.Add(
        "- Included source size: " +
        "$([Math]::Round($copiedBytes / 1MB, 2)) MB"
    )
    $navigationLines.Add(
        "- Maximum individual file size: $MaxFileSizeMB MB"
    )
    $navigationLines.Add(
        "- Agent configuration included: " +
        [string][bool]$IncludeAgentConfig
    )
    $navigationLines.Add(
        "- JavaScript lockfiles included: " +
        [string][bool]$IncludeLockFiles
    )
    $navigationLines.Add(
        "- Contract snapshots included: " +
        [string][bool]$IncludeContractSnapshots
    )
    $navigationLines.Add("")
    $navigationLines.Add("## Task-dependent entry points")
    $navigationLines.Add("")
    $navigationLines.Add(
        "- Frontend routes: frontend/src/App.tsx"
    )
    $navigationLines.Add(
        "- Frontend implementation: frontend/src/"
    )
    $navigationLines.Add(
        "- Frontend tests and capture source: frontend/e2e/"
    )
    $navigationLines.Add(
        "- Smart contracts: contracts/"
    )
    $navigationLines.Add(
        "- Supabase functions: supabase/functions/"
    )
    $navigationLines.Add(
        "- Current database evolution: supabase/migrations/"
    )
    $navigationLines.Add(
        "- Database bootstrap only: supabase_schema.sql"
    )
    $navigationLines.Add(
        "- Architecture decisions: docs/architecture.md"
    )
    $navigationLines.Add(
        "- Repository instructions: AGENTS.md and nested AGENTS.md files"
    )
    $navigationLines.Add(
        "- Setup and usage: README.md and package manifests"
    )
    $navigationLines.Add("")
    $navigationLines.Add("## Included areas")
    $navigationLines.Add("")

    foreach ($group in $areaCounts) {
        $navigationLines.Add(
            "- $($group.Name): $($group.Count) files"
        )
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Supabase function entry points")
    $navigationLines.Add("")

    if ($supabaseFunctions.Count -eq 0) {
        $navigationLines.Add("- None detected")
    }
    else {
        foreach ($path in $supabaseFunctions) {
            $navigationLines.Add("- $path")
        }
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Database migrations")
    $navigationLines.Add("")

    if ($migrations.Count -eq 0) {
        $navigationLines.Add("- None detected")
    }
    else {
        foreach ($path in $migrations) {
            $navigationLines.Add("- $path")
        }
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Contract crates")
    $navigationLines.Add("")

    if ($contractManifests.Count -eq 0) {
        $navigationLines.Add("- None detected")
    }
    else {
        foreach ($path in $contractManifests) {
            $navigationLines.Add("- $path")
        }
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Test surface")
    $navigationLines.Add("")
    $navigationLines.Add(
        "- Test source files: $($testFiles.Count)"
    )
    $navigationLines.Add(
        "- Generated contract snapshots: " +
        "$($contractSnapshots.Count)"
    )

    foreach ($path in ($testFiles | Select-Object -First 40)) {
        $navigationLines.Add("- $path")
    }

    if ($testFiles.Count -gt 40) {
        $remaining = $testFiles.Count - 40
        $navigationLines.Add(
            "- ...and $remaining more; see _AI_FILE_LIST.txt"
        )
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Working-tree status")
    $navigationLines.Add("")

    if ($gitStatus.Count -eq 0) {
        $navigationLines.Add("- Clean")
    }
    else {
        foreach ($line in $gitStatus) {
            $navigationLines.Add("- $line")
        }
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Recent commits")
    $navigationLines.Add("")

    if ($recentCommits.Count -eq 0) {
        $navigationLines.Add("- No commit history available")
    }
    else {
        foreach ($line in $recentCommits) {
            $navigationLines.Add("- $line")
        }
    }

    $navigationLines.Add("")
    $navigationLines.Add("## Working rule")
    $navigationLines.Add("")
    $navigationLines.Add(
        "For coding requests, implement the requested code only."
    )
    $navigationLines.Add(
        "Do not run tests or verification unless the user explicitly requests a separate testing or verification step."
    )

    $navigationPath = Join-Path `
        $stagingRoot `
        "_AI_REPO_NAVIGATION.md"

    $navigationLines |
        Set-Content `
            -LiteralPath $navigationPath `
            -Encoding UTF8

    # -----------------------------------------------------------------------
    # Generate skipped-file report
    # -----------------------------------------------------------------------

    $skippedLines = [System.Collections.Generic.List[string]]::new()

    $skippedLines.Add("# Skipped files")
    $skippedLines.Add("")
    $skippedLines.Add(
        "These Git-visible paths were omitted from the coding ZIP."
    )
    $skippedLines.Add("")

    if ($skipped.Count -eq 0) {
        $skippedLines.Add("None.")
    }
    else {
        foreach ($item in ($skipped | Sort-Object Path)) {
            $skippedLines.Add(
                "$($item.Path)`t$($item.Reason)"
            )
        }
    }

    $skippedPath = Join-Path `
        $stagingRoot `
        "_AI_SKIPPED_FILES.txt"

    $skippedLines |
        Set-Content `
            -LiteralPath $skippedPath `
            -Encoding UTF8

    # -----------------------------------------------------------------------
    # Generate final included-file list
    # -----------------------------------------------------------------------

    $finalFiles = @(
        Get-ChildItem `
            -LiteralPath $stagingRoot `
            -Recurse `
            -File `
            -Force |
            ForEach-Object {
                $relative = $_.FullName.Substring(
                    $stagingRoot.Length
                )

                Normalize-RelativePath (
                    $relative -replace "^[\\/]+", ""
                )
            }
    )

    $finalFiles += "_AI_FILE_LIST.txt"

    $fileListPath = Join-Path `
        $stagingRoot `
        "_AI_FILE_LIST.txt"

    $finalFiles |
        Sort-Object -Unique |
        Set-Content `
            -LiteralPath $fileListPath `
            -Encoding UTF8

    # -----------------------------------------------------------------------
    # Create ZIP manually so entry names always use forward slashes
    # -----------------------------------------------------------------------

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    $zipFileStream = [System.IO.File]::Open(
        $zipPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )

    try {
        $zipArchive = New-Object System.IO.Compression.ZipArchive(
            $zipFileStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )

        try {
            $filesToArchive = Get-ChildItem `
                -LiteralPath $stagingRoot `
                -Recurse `
                -File `
                -Force

            foreach ($file in $filesToArchive) {
                $relativeEntryPath = $file.FullName.Substring(
                    $stagingRoot.Length
                )

                $relativeEntryPath = $relativeEntryPath.TrimStart(
                    [char[]]@("\", "/")
                )

                $relativeEntryPath = $relativeEntryPath.Replace(
                    "\",
                    "/"
                )

                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zipArchive,
                    $file.FullName,
                    $relativeEntryPath,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
        finally {
            $zipArchive.Dispose()
        }
    }
    finally {
        $zipFileStream.Dispose()
    }

    # -----------------------------------------------------------------------
    # Hard validation
    # -----------------------------------------------------------------------

    $validationArchive = [System.IO.Compression.ZipFile]::OpenRead(
        $zipPath
    )

    try {
        $rawEntryNames = @(
            $validationArchive.Entries |
                ForEach-Object {
                    $_.FullName
                }
        )

        foreach ($requiredEntry in @(
            "_AI_REPO_NAVIGATION.md",
            "_AI_FILE_LIST.txt",
            "_AI_SKIPPED_FILES.txt"
        )) {
            if ($rawEntryNames -notcontains $requiredEntry) {
                throw (
                    "ZIP validation failed: missing " +
                    $requiredEntry
                )
            }
        }

        $backslashEntries = @(
            $rawEntryNames |
                Where-Object {
                    $_ -match "\\"
                }
        )

        if ($backslashEntries.Count -gt 0) {
            throw (
                "ZIP validation failed: Windows-style " +
                "entry paths were found: " +
                ($backslashEntries -join ", ")
            )
        }

        if (-not $IncludeAgentConfig) {
            $agentEntries = @(
                $rawEntryNames |
                    Where-Object {
                        $_ -match "^\.agents/" -or
                        $_ -match "^\.codex/"
                    }
            )

            if ($agentEntries.Count -gt 0) {
                throw (
                    "ZIP validation failed: agent configuration " +
                    "was included unexpectedly: " +
                    ($agentEntries -join ", ")
                )
            }
        }

        if (-not $IncludeLockFiles) {
            $lockEntries = @(
                $rawEntryNames |
                    Where-Object {
                        $baseName = $_.Split("/")[-1]

                        $JavaScriptLockFileNames -contains $baseName
                    }
            )

            if ($lockEntries.Count -gt 0) {
                throw (
                    "ZIP validation failed: JavaScript lockfiles " +
                    "were included unexpectedly: " +
                    ($lockEntries -join ", ")
                )
            }
        }

        if (-not $IncludeContractSnapshots) {
            $snapshotEntries = @(
                $rawEntryNames |
                    Where-Object {
                        $_ -match "(^|/)test_snapshots/"
                    }
            )

            if ($snapshotEntries.Count -gt 0) {
                throw (
                    "ZIP validation failed: generated contract " +
                    "snapshots were included unexpectedly: " +
                    ($snapshotEntries -join ", ")
                )
            }
        }

        $selfEntries = @(
            $rawEntryNames |
                Where-Object {
                    $_.Split("/")[-1] -like (
                        "New-StellarTicketsCodingZip*.ps1"
                    )
                }
        )

        if ($selfEntries.Count -gt 0) {
            throw (
                "ZIP validation failed: the packaging script " +
                "included itself: " +
                ($selfEntries -join ", ")
            )
        }

        $unsafeEnvironmentEntries = @(
            $rawEntryNames |
                Where-Object {
                    $baseName = $_.Split("/")[-1]

                    $baseName -like ".env*" -and
                    $SafeEnvironmentFileNames -notcontains $baseName
                }
        )

        if ($unsafeEnvironmentEntries.Count -gt 0) {
            throw (
                "ZIP validation failed: unsafe environment files " +
                "were included: " +
                ($unsafeEnvironmentEntries -join ", ")
            )
        }

        $entryCount = $validationArchive.Entries.Count
        $uncompressedBytes = [int64]0

        foreach ($entry in $validationArchive.Entries) {
            $uncompressedBytes += $entry.Length
        }
    }
    finally {
        $validationArchive.Dispose()
    }

    $zipItem = Get-Item -LiteralPath $zipPath

    Write-Host ""
    Write-Host `
        "Coding ZIP created successfully." `
        -ForegroundColor Green

    Write-Host "Path: $zipPath"
    Write-Host "Files: $entryCount"
    Write-Host (
        "ZIP size: " +
        "$([Math]::Round($zipItem.Length / 1MB, 2)) MB"
    )
    Write-Host (
        "Uncompressed size: " +
        "$([Math]::Round($uncompressedBytes / 1MB, 2)) MB"
    )
    Write-Host "Skipped Git-visible paths: $($skipped.Count)"
    Write-Host (
        "Agent config included: " +
        [string][bool]$IncludeAgentConfig
    )
    Write-Host (
        "JavaScript lockfiles included: " +
        [string][bool]$IncludeLockFiles
    )
    Write-Host (
        "Contract snapshots included: " +
        [string][bool]$IncludeContractSnapshots
    )
    Write-Host "Portable ZIP paths: True"
    Write-Host ""

    [pscustomobject]@{
        ZipPath                    = $zipPath
        EntryCount                 = $entryCount
        ZipSizeMB                  = [Math]::Round(
            $zipItem.Length / 1MB,
            2
        )
        UncompressedSizeMB         = [Math]::Round(
            $uncompressedBytes / 1MB,
            2
        )
        SkippedPathCount           = $skipped.Count
        AgentConfigIncluded        = [bool]$IncludeAgentConfig
        JavaScriptLocksIncluded    = [bool]$IncludeLockFiles
        ContractSnapshotsIncluded  = [bool]$IncludeContractSnapshots
        PortableZipPaths           = $true
        Branch                     = $branchName
        Commit                     = $commitHash
    }
}
catch {
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    throw
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item `
            -LiteralPath $stagingRoot `
            -Recurse `
            -Force
    }
}