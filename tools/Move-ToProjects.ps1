<#
.SYNOPSIS
  Moves leftover runtime files from the old single-project root layout into the project folder.

.DESCRIPTION
  The multi-project branch moved every TRACKED file of the Shahnameh project from the repo
  root into its own top-level folder, <repo>/shahnameh-cli/ (and the tools and docs into
  tools/ and docs/). Git does not
  move gitignored or untracked files, so a machine that pulls that branch still has things
  like 00_PROJECT/queue/worker.lock, worker logs, sync inbox/processed/receipts, PLAN-*.json
  and registry *.bak files sitting in the old root folders.

  This script moves them:
      00_PROJECT/tools/*          -> tools/*
      00_PROJECT/INDEXING.md      -> docs/INDEXING.md
      00_PROJECT/SYNC_PROTOCOL.md -> docs/SYNC_PROTOCOL.md
      00_PROJECT/reference/*      -> docs/reference/*
      <old folder>/<path>         -> <slug>/<old folder>/<path>
  for the old folders 00_PROJECT, 01_CHARACTERS .. 09_OUTPUT and 99_INBOX.

  A target that already exists is never overwritten. If it is identical (SHA256) the source
  is deleted; if it differs, the incoming file is kept beside it as <name>.from-root<ext>
  and reported. Emptied old directories are removed. Running it again does nothing.

  Refuses to run while a worker is running (a worker.lock whose pid is a live process), or
  before the branch is pulled (<slug>/project.json missing).

.PARAMETER Slug
  The project the old root layout belonged to. Default: shahnameh-cli.

.PARAMETER RepoRoot
  The repo root. Default: the parent of this script's folder.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Move-ToProjects.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Slug = 'shahnameh-cli',
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) { $RepoRoot = Split-Path $PSScriptRoot }
$RepoRoot    = [System.IO.Path]::GetFullPath($RepoRoot)
$ProjectRoot = Join-Path $RepoRoot $Slug

$OLD_FOLDERS = @('00_PROJECT','01_CHARACTERS','02_GROUPS','03_LOCATIONS','04_PROPS','05_CREATURES',
                 '06_COSTUMES','07_EPISODES','08_REFERENCE','09_OUTPUT','99_INBOX')

# ---------------------------------------------------------------- preflight

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'project.json'))) {
    Write-Output "REFUSED: $ProjectRoot\project.json does not exist."
    Write-Output "Pull the branch that moved the project into the $Slug folder first, then run this again."
    exit 1
}

function Test-LiveLock {
    param([string]$LockPath)
    if (-not (Test-Path -LiteralPath $LockPath)) { return $false }
    $raw = ''
    try { $raw = [string](Get-Content -LiteralPath $LockPath -Raw) } catch { $raw = '' }
    $tok = @(($raw.Trim()) -split '\s+')[0]
    $procId = 0
    if (-not [int]::TryParse($tok, [ref]$procId) -or $procId -le 0) { return $false }
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    return ($null -ne $p)
}

foreach ($lock in @((Join-Path $RepoRoot '00_PROJECT\queue\worker.lock'),
                    (Join-Path $ProjectRoot '00_PROJECT\queue\worker.lock'))) {
    if (Test-LiveLock -LockPath $lock) {
        Write-Output "REFUSED: a worker is running (live pid in $lock)."
        Write-Output "Stop it first (create queue\worker.stop, or stop the panel), then run this again."
        exit 1
    }
}

# ---------------------------------------------------------------- plan + move

$moved     = New-Object System.Collections.ArrayList
$deduped   = New-Object System.Collections.ArrayList
$conflicts = New-Object System.Collections.ArrayList
$removed   = 0

function Get-TargetPath {
    param([string]$Folder, [string]$Rel)
    if ($Folder -ceq '00_PROJECT') {
        $first = ($Rel -split '[\\/]', 2)[0]
        $rest  = ''
        if ($Rel.Length -gt $first.Length) { $rest = $Rel.Substring($first.Length + 1) }
        if ($first -ceq 'tools' -and $rest)     { return (Join-Path (Join-Path $RepoRoot 'tools') $rest) }
        if ($first -ceq 'reference' -and $rest) { return (Join-Path (Join-Path $RepoRoot 'docs\reference') $rest) }
        if ($Rel -ceq 'INDEXING.md')            { return (Join-Path $RepoRoot 'docs\INDEXING.md') }
        if ($Rel -ceq 'SYNC_PROTOCOL.md')       { return (Join-Path $RepoRoot 'docs\SYNC_PROTOCOL.md') }
    }
    return (Join-Path (Join-Path $ProjectRoot $Folder) $Rel)
}

# .NET rather than Get-FileHash: under -WhatIf the cmdlet's own path resolution is
# suppressed and it returns nothing, which would make every file look identical.
function Get-FileSha {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs  = [System.IO.File]::OpenRead($Path)
    try {
        return (($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally { $fs.Dispose(); $sha.Dispose() }
}

$anyOld = $false

foreach ($folder in $OLD_FOLDERS) {
    $oldDir = Join-Path $RepoRoot $folder
    if (-not (Test-Path -LiteralPath $oldDir)) { continue }
    $anyOld = $true

    $files = @(Get-ChildItem -LiteralPath $oldDir -Recurse -File -Force | Sort-Object FullName)
    foreach ($f in $files) {
        $rel    = $f.FullName.Substring($oldDir.Length).TrimStart('\', '/')
        $target = Get-TargetPath -Folder $folder -Rel $rel
        $shown  = "$folder\$rel"

        if (Test-Path -LiteralPath $target) {
            if ((Get-FileSha $f.FullName) -ceq (Get-FileSha $target)) {
                if ($PSCmdlet.ShouldProcess($shown, "Delete (identical copy already at $target)")) {
                    Remove-Item -LiteralPath $f.FullName -Force
                }
                [void]$deduped.Add($shown)
                continue
            }

            # differs: keep both, never overwrite
            $dir  = Split-Path $target
            $base = [System.IO.Path]::GetFileNameWithoutExtension($target)
            $ext  = [System.IO.Path]::GetExtension($target)
            $n    = 1
            $alt  = Join-Path $dir "$base.from-root$ext"
            $same = $false
            while (Test-Path -LiteralPath $alt) {
                if ((Get-FileSha $f.FullName) -ceq (Get-FileSha $alt)) { $same = $true; break }
                $n++
                $alt = Join-Path $dir "$base.from-root-$n$ext"
            }
            if ($same) {
                if ($PSCmdlet.ShouldProcess($shown, "Delete (identical copy already at $alt)")) {
                    Remove-Item -LiteralPath $f.FullName -Force
                }
                [void]$deduped.Add($shown)
                continue
            }
            if ($PSCmdlet.ShouldProcess($shown, "Move to $alt (target differs, not overwritten)")) {
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                Move-Item -LiteralPath $f.FullName -Destination $alt
            }
            [void]$conflicts.Add("$shown -> $alt")
            continue
        }

        if ($PSCmdlet.ShouldProcess($shown, "Move to $target")) {
            New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
            Move-Item -LiteralPath $f.FullName -Destination $target
        }
        [void]$moved.Add("$shown -> $target")
    }

    # remove emptied directories, deepest first, then the old folder itself
    $dirs = @(Get-ChildItem -LiteralPath $oldDir -Recurse -Directory -Force |
              Sort-Object @{ Expression = { $_.FullName.Length } } -Descending)
    $dirs += (Get-Item -LiteralPath $oldDir -Force)
    foreach ($d in $dirs) {
        if (-not (Test-Path -LiteralPath $d.FullName)) { continue }
        if ($WhatIfPreference) {
            # Nothing really moved. Every file under the old folders is moved or deleted
            # above, so every directory would end up empty.
            [void]$PSCmdlet.ShouldProcess($d.FullName, 'Remove directory once emptied')
            $removed++
            continue
        }
        $left = @(Get-ChildItem -LiteralPath $d.FullName -Force)
        if ($left.Count -eq 0) {
            if ($PSCmdlet.ShouldProcess($d.FullName, 'Remove empty directory')) {
                Remove-Item -LiteralPath $d.FullName -Force
                $removed++
            }
        }
    }
}

# ---------------------------------------------------------------- summary

Write-Output ""
Write-Output "Move-ToProjects - old root layout -> the $Slug folder"
Write-Output "Repo: $RepoRoot"
if (-not $anyOld) {
    Write-Output "Nothing to do: no old root folders (00_PROJECT, 01_CHARACTERS .. 99_INBOX) remain."
    exit 0
}
if ($WhatIfPreference) { Write-Output "WhatIf: nothing was changed. Counts are what a real run would do." }
Write-Output ("Moved        : {0} file(s)" -f $moved.Count)
foreach ($m in $moved) { Write-Output "  $m" }
Write-Output ("Deduplicated : {0} file(s) deleted, an identical copy was already in place" -f $deduped.Count)
foreach ($m in $deduped) { Write-Output "  $m" }
Write-Output ("Conflicts    : {0} file(s) kept as .from-root - compare and merge by hand" -f $conflicts.Count)
foreach ($m in $conflicts) { Write-Output "  $m" }
Write-Output ("Directories  : {0} removed" -f $removed)
exit 0
