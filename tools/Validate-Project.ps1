<#
.SYNOPSIS
  Validates Film Making for Dummies projects against INDEXING.md v2.0.

.DESCRIPTION
  Proves the guarantees in SYNC_PROTOCOL.md section 7. Checks ID grammar, registry
  integrity, disk/manifest agreement, canonical variants and cross-references.
  Prints the next free number per kind and the project state hash.

  With -Project (or $env:SHM_ROOT) one project is validated. Without either, every
  project in the repo is validated in turn, plus the system checks: each project folder
  has a sound project.json, codes are unique, and nothing stray sits in the repo root.

  Projects are top-level folders: <repo>/<slug>/, each with a project.json beside the
  system folders (10_PANEL, tools, docs, templates).

.PARAMETER Project
  The slug of the project to validate (its top-level folder name).

.PARAMETER Quiet
  Only print errors, warnings and the summary.

.OUTPUTS
  Exit code 0 if clean, 1 if any error was found.
#>
[CmdletBinding()]
param(
    [string]$Project,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Shm-Common.ps1')

$KINDS       = $ShmKinds
$STATUSES    = $ShmStatuses
$ROLES       = @('HERO','TURNAROUND','PLATE','DETAIL','BOARD','RENDER')
$FLAGS       = @('NEEDS-HERO-SHEET','NEEDS-CANONICAL','REVIEW-SPLIT','NO-ASSET')
$MEDIA_EXT   = @('.png','.jpg','.jpeg','.webp','.mp4','.mov')
$ASSET_DIRS  = @('01_CHARACTERS','02_GROUPS','03_LOCATIONS','04_PROPS','05_CREATURES',
                 '06_COSTUMES','07_EPISODES','08_REFERENCE','09_OUTPUT')

# What the repo root may hold besides the projects themselves. Dot-entries are always
# allowed (.git, .claude, and the panel's .generate.lock and .new-<slug>-<random>
# staging folders). skills-lock.json is the vendored-skills lockfile: gitignored,
# reinstalled, and not project data. Both lists live in Shm-Common.ps1.
$ROOT_ALLOWED = @($ShmSystemDirs + $ShmSystemFiles)

function Split-List ([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return @() }
    return ($s -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

# Any path segment starting with '_' is working space, not the indexed library:
# 07_EPISODES/_TEMPLATE, 09_OUTPUT/_staging, 09_OUTPUT/_rejected. Files under
# those are deliberately unregistered and must not report as orphans.
function Test-ShmWorkingPath {
    param([string]$FullPath, [string]$RootPath)
    $rel = $FullPath.Substring($RootPath.Length).TrimStart('\', '/')
    foreach ($seg in ($rel -split '[\\/]')) { if ($seg.StartsWith('_')) { return $true } }
    return $false
}

<#
  Validates one project and writes its report. Sets $script:ProjResult to
  {Errors; Warnings} for the caller to total up.
#>
function Invoke-ProjectValidation {
    param([Parameter(Mandatory)][object]$Proj)

    $errors   = New-Object System.Collections.ArrayList
    $warnings = New-Object System.Collections.ArrayList
    function Add-Err  ([string]$m) { [void]$errors.Add($m) }
    function Add-Warn ([string]$m) { [void]$warnings.Add($m) }

    $Root        = $Proj.Root
    $Code        = $Proj.Code
    $codeRx      = [regex]::Escape($Code)
    $P           = Get-ShmPaths -Project $Proj
    $EntitiesCsv = $P.Entities
    $ManifestCsv = $P.Manifest

    $kindAlt   = ($KINDS -join '|')
    $RX_ID     = '^' + $codeRx + '-(' + $kindAlt + ')-\d{3}-[A-Z0-9]+(-[A-Z0-9]+)*$'
    $RX_FILE   = '^' + $codeRx + '-(' + $kindAlt + ')-\d{3}-[A-Z0-9]+(-[A-Z0-9]+)*_V\d{2}(_T\d{2})?_[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|jpeg|webp|mp4|mov)$'
    # Accepted shot renders live in 07_EPISODES/<episode>/shots/ and are NOT manifest
    # rows by design (INDEXING.md section 7: the manifest indexes reusable entities;
    # a shot's provenance is JOB_LEDGER.csv and the review log). Check their name
    # against the shot-output grammar instead of reporting them as orphans.
    $RX_SHOT_FILE = '^' + $codeRx + '-EP\d{3}(-SQ\d{2})?-SC\d{3}-SH\d{4}_V\d{2}(_T\d{2})?\.(png|jpg|jpeg|webp|mp4|mov)$'

    if (-not $Quiet) {
        Write-Output "Film Making for Dummies - project validator - INDEXING.md v2.0"
        Write-Output "Project: $($Proj.Name) ($Code) - $($Proj.Slug)"
        Write-Output "Root: $Root"
        Write-Output ""
    } else {
        Write-Output "Project: $($Proj.Name) ($Code) - $($Proj.Slug)"
    }

    # ------------------------------------------------------------ load

    $entities = @()
    $manifest = @()
    if (-not (Test-Path -LiteralPath $EntitiesCsv)) { Add-Err "Missing $EntitiesCsv" }
    else { $entities = @(Import-Csv -LiteralPath $EntitiesCsv) }
    if (-not (Test-Path -LiteralPath $ManifestCsv)) { Add-Err "Missing $ManifestCsv" }
    else { $manifest = @(Import-Csv -LiteralPath $ManifestCsv) }

    # ------------------------------------------------------------ 1. entity rows

    $seenId    = @{}
    $seenSlug  = @{}
    $seenShort = @{}

    foreach ($e in $entities) {
        $id = $e.id

        if ($id -cnotmatch $RX_ID) { Add-Err "ENTITY id fails grammar: '$id'"; continue }
        if ($seenId.ContainsKey($id)) { Add-Err "ENTITY duplicate id: $id" }
        $seenId[$id] = $true

        $parts  = $id.Substring($Code.Length + 1) -split '-', 2
        $kind   = $parts[0]
        $rest   = $parts[1]
        $number = $rest.Substring(0, 3)
        $slug   = $rest.Substring(4)

        if ($e.kind   -cne $kind)   { Add-Err "$id : kind column '$($e.kind)' does not match id kind '$kind'" }
        if ($e.number -ne $number)  { Add-Err "$id : number column '$($e.number)' does not match id number '$number'" }
        if ($e.slug   -cne $slug)   { Add-Err "$id : slug column '$($e.slug)' does not match id slug '$slug'" }

        $expectedShort = "$kind-$number"
        if ($e.short_id -cne $expectedShort) { Add-Err "$id : short_id should be '$expectedShort', found '$($e.short_id)'" }
        if ($seenShort.ContainsKey($e.short_id)) { Add-Err "ENTITY duplicate short_id: $($e.short_id)" }
        $seenShort[$e.short_id] = $true

        if ($seenSlug.ContainsKey($slug)) { Add-Err "ENTITY duplicate slug '$slug' on $id and $($seenSlug[$slug])" }
        $seenSlug[$slug] = $id

        if ($STATUSES -notcontains $e.status) { Add-Err "$id : unknown status '$($e.status)'" }

        if ($e.family -ne '' -and $slug -cnotlike "$($e.family)*") {
            Add-Warn "$id : slug does not lead with its family word '$($e.family)'"
        }

        foreach ($f in (Split-List $e.flags)) {
            if ($FLAGS -notcontains $f) { Add-Warn "$id : unknown flag '$f'" }
        }

        if ([string]::IsNullOrWhiteSpace($e.description)) { Add-Warn "$id : empty description - it will be useless in the context pack" }
    }

    # related must resolve (second pass, needs all ids loaded)
    foreach ($e in $entities) {
        foreach ($rel in (Split-List $e.related)) {
            if (-not $seenId.ContainsKey($rel)) { Add-Err "$($e.id) : related id does not exist: '$rel'" }
        }
    }

    # ------------------------------------------------------------ 2. manifest rows

    $manifestByEntity = @{}
    $manifestFiles    = @{}

    foreach ($m in $manifest) {
        $fn = $m.filename

        if ($fn -cnotmatch $RX_FILE) { Add-Err "MANIFEST filename fails grammar: '$fn'" }
        if ($manifestFiles.ContainsKey($fn)) { Add-Err "MANIFEST duplicate filename row: $fn" }
        $manifestFiles[$fn] = $m

        if (-not $seenId.ContainsKey($m.entity_id)) {
            Add-Err "MANIFEST '$fn' references unknown entity_id '$($m.entity_id)'"
            continue
        }

        # filename must embed its own entity id and variant
        if ($fn -cnotlike "$($m.entity_id)_*") {
            Add-Err "MANIFEST '$fn' does not start with its entity_id '$($m.entity_id)'"
        }
        $tail = $fn.Substring($m.entity_id.Length + 1)
        $fileVariant = $tail.Substring(0, 3)
        if ($fileVariant -cne $m.variant) {
            Add-Err "MANIFEST '$fn' embeds variant '$fileVariant' but the variant column says '$($m.variant)'"
        }

        if ($m.variant -cnotmatch '^V\d{2}$') { Add-Err "MANIFEST '$fn' bad variant '$($m.variant)'" }
        if ($m.take    -cnotmatch '^T\d{2}$') { Add-Err "MANIFEST '$fn' bad take '$($m.take)'" }
        if ($ROLES    -notcontains $m.role)   { Add-Err "MANIFEST '$fn' unknown role '$($m.role)'" }
        if ($STATUSES -notcontains $m.status) { Add-Err "MANIFEST '$fn' unknown status '$($m.status)'" }
        if ([string]::IsNullOrWhiteSpace($m.original_filename)) {
            Add-Warn "MANIFEST '$fn' has no original_filename - the rename is not reversible"
        }

        if (-not $manifestByEntity.ContainsKey($m.entity_id)) { $manifestByEntity[$m.entity_id] = @() }
        $manifestByEntity[$m.entity_id] += $m
    }

    # ------------------------------------------------------------ 3. disk vs manifest

    $episodesDir  = Join-Path $Root '07_EPISODES'

    $onDisk = @{}
    foreach ($d in $ASSET_DIRS) {
        $p = Join-Path $Root $d
        if (-not (Test-Path -LiteralPath $p)) { continue }
        Get-ChildItem -LiteralPath $p -Recurse -File |
            Where-Object { $MEDIA_EXT -contains $_.Extension.ToLower() } |
            Where-Object { -not (Test-ShmWorkingPath -FullPath $_.FullName -RootPath $Root) } |
            ForEach-Object {
                $isShotRender = ($_.Directory.Name -ceq 'shots') -and
                                ($_.Directory.Parent.Parent.FullName -eq $episodesDir)
                if ($isShotRender) {
                    if ($_.Name -cnotmatch $RX_SHOT_FILE) {
                        Add-Err "SHOT render name fails grammar: $($_.FullName.Substring($Root.Length + 1))"
                    }
                } else {
                    $onDisk[$_.Name] = $_
                }
            }
    }

    foreach ($name in $onDisk.Keys) {
        if (-not $manifestFiles.ContainsKey($name)) {
            Add-Err "ORPHAN FILE on disk with no manifest row: $($onDisk[$name].FullName.Substring($Root.Length + 1))"
        }
    }
    foreach ($name in $manifestFiles.Keys) {
        if (-not $onDisk.ContainsKey($name)) {
            Add-Err "MISSING FILE: manifest lists '$name' but it is not on disk"
        } else {
            $actualFolder = Split-Path (Split-Path $onDisk[$name].FullName) -Leaf
            if ($actualFolder -cne $manifestFiles[$name].folder) {
                Add-Err "MANIFEST '$name' says folder '$($manifestFiles[$name].folder)' but it lives in '$actualFolder'"
            }
        }
    }

    # loose media in the project root
    Get-ChildItem -LiteralPath $Root -File | Where-Object { $MEDIA_EXT -contains $_.Extension.ToLower() } | ForEach-Object {
        Add-Err "UNFILED media in project root: $($_.Name) - move it to $($Proj.Slug)/99_INBOX or index it"
    }

    # ------------------------------------------------------------ 4. variants and canonicals

    foreach ($e in $entities) {
        $rows     = @()
        if ($manifestByEntity.ContainsKey($e.id)) { $rows = $manifestByEntity[$e.id] }
        $variants = @($rows | Select-Object -ExpandProperty variant -Unique | Sort-Object)
        $declared = [int]$e.variant_count

        if ($variants.Count -ne $declared) {
            Add-Err "$($e.id) : variant_count says $declared but the manifest has $($variants.Count) [$($variants -join ',')]"
        }

        if ($declared -eq 0) {
            if ($e.canonical_variant -ne '') { Add-Err "$($e.id) : has no assets but declares canonical_variant '$($e.canonical_variant)'" }
            if ((Split-List $e.flags) -notcontains 'NO-ASSET') { Add-Warn "$($e.id) : has no assets but is not flagged NO-ASSET" }
        }
        elseif ($e.canonical_variant -eq '') {
            if ($declared -gt 1) {
                Add-Err "$($e.id) : $declared variants and no canonical_variant - prompts cannot resolve a hero reference"
            } else {
                Add-Warn "$($e.id) : single variant with no canonical_variant, should be $($variants[0])"
            }
        }
        elseif ($variants -notcontains $e.canonical_variant) {
            Add-Err "$($e.id) : canonical_variant '$($e.canonical_variant)' has no asset [have: $($variants -join ',')]"
        }

        if ($rows.Count -gt 0) {
            $folders = @($rows | Select-Object -ExpandProperty folder -Unique)
            if ($folders.Count -gt 1) { Add-Warn "$($e.id) : assets spread across folders [$($folders -join ',')]" }
            elseif ($folders[0] -cne $e.folder) { Add-Err "$($e.id) : folder column '$($e.folder)' but assets are in '$($folders[0])'" }
        }
    }

    # ------------------------------------------------------------ 5. next free numbers + state hash

    $nextFree  = Get-ShmNextNumbers -Entities $entities
    $stateHash = Get-ShmStateHash   -Entities $entities

    # ------------------------------------------------------------ report

    if (-not $Quiet) {
        Write-Output "Entities : $($entities.Count)"
        Write-Output "Assets   : $($manifest.Count) in manifest, $($onDisk.Count) on disk"
        Write-Output ""
        Write-Output "Next free number per kind:"
        foreach ($k in $nextFree.Keys) { Write-Output ("  {0}  {1}" -f $k, $nextFree[$k]) }
        Write-Output ""
    }

    foreach ($w in $warnings) { Write-Output "[WARN]  $w" }
    foreach ($e in $errors)   { Write-Output "[ERROR] $e" }

    Write-Output ""
    Write-Output "state_hash: $stateHash"
    if ($errors.Count -eq 0) {
        Write-Output "RESULT: PASS ($($warnings.Count) warning(s))"
    } else {
        Write-Output "RESULT: FAIL - $($errors.Count) error(s), $($warnings.Count) warning(s)"
    }

    $script:ProjResult = [pscustomobject]@{ Errors = $errors.Count; Warnings = $warnings.Count }
}

# ---------------------------------------------------------------- single project

$single = (-not [string]::IsNullOrWhiteSpace($Project)) -or (-not [string]::IsNullOrWhiteSpace($env:SHM_ROOT))

if ($single) {
    $proj = Resolve-ShmProject -Project $Project
    Invoke-ProjectValidation -Proj $proj
    if ($script:ProjResult.Errors -eq 0) { exit 0 } else { exit 1 }
}

# ---------------------------------------------------------------- every project + system checks

$repoRoot    = Get-ShmRepoRoot

$sysErrors   = New-Object System.Collections.ArrayList
$sysWarnings = New-Object System.Collections.ArrayList
$toValidate  = @()
$codeOwner   = @{}

if (-not $Quiet) {
    Write-Output "Film Making for Dummies - project validator - all projects"
    Write-Output "Repo: $repoRoot"
    Write-Output ""
}

# One pass over the repo root. A folder with a project.json is a project; the system
# entries are skipped; anything else is stray. Dot-entries are machine-local (.git,
# .claude, the panel's .generate.lock and .new-<slug>-<random> staging folders).
foreach ($item in (Get-ChildItem -LiteralPath $repoRoot -Force | Sort-Object Name)) {
    if ($item.Name.StartsWith('.')) { continue }

    if (-not $item.PSIsContainer) {
        if ($ROOT_ALLOWED -contains $item.Name) { continue }
        [void]$sysErrors.Add("STRAY file in repo root: $($item.Name) - move it into a project's 99_INBOX")
        continue
    }

    $slug = $item.Name
    $json = Join-Path $item.FullName 'project.json'

    if (-not (Test-Path -LiteralPath $json)) {
        if ($ROOT_ALLOWED -contains $slug) { continue }
        [void]$sysErrors.Add("STRAY folder in repo root: $slug - it is not a project (no project.json) and not a system folder")
        continue
    }
    if ($ROOT_ALLOWED -contains $slug) {
        [void]$sysErrors.Add("PROJECT '$slug' uses the name of a system folder - rename it")
        continue
    }

    if ($slug -cnotmatch $ShmSlugPattern) {
        [void]$sysErrors.Add("PROJECT folder name '$slug' is not a valid slug (lowercase letters, digits, hyphens)")
    }

    try { $j = Read-ShmProjectJson -Path $json }
    catch { [void]$sysErrors.Add("PROJECT $slug/project.json is not readable JSON: $($_.Exception.Message)"); continue }

    $ok = $true
    $schemaInt = 0
    if ($null -eq $j.schema -or -not [int]::TryParse([string]$j.schema, [ref]$schemaInt) -or $schemaInt -lt 1) {
        [void]$sysErrors.Add("PROJECT $slug/project.json : missing or invalid 'schema'"); $ok = $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$j.name)) {
        [void]$sysErrors.Add("PROJECT $slug/project.json : missing 'name'"); $ok = $false
    }
    if ([string]$j.slug -cne $slug) {
        [void]$sysErrors.Add("PROJECT $slug/project.json : slug '$($j.slug)' does not match its folder name '$slug'"); $ok = $false
    }
    $code = [string]$j.code
    if ($code -cnotmatch $ShmCodePattern) {
        [void]$sysErrors.Add("PROJECT $slug/project.json : code '$code' must be 2-4 uppercase letters"); $ok = $false
    } elseif ($ShmReservedCodes -ccontains $code) {
        [void]$sysErrors.Add("PROJECT $slug/project.json : code '$code' is a reserved word (kind or $((@('EP','SC','SH','SQ','NEW','NEXT','JOB')) -join '/'))"); $ok = $false
    } elseif ($codeOwner.ContainsKey($code)) {
        [void]$sysErrors.Add("PROJECT code '$code' is used by both $($codeOwner[$code]) and $slug"); $ok = $false
    } else {
        $codeOwner[$code] = $slug
    }

    if ($ok) { $toValidate += (New-ShmProjectObject -Root $item.FullName -Json $j -Slug $slug) }
}

$totalErrors   = 0
$totalWarnings = 0
$passed        = 0

foreach ($proj in $toValidate) {
    Write-Output "================================================================ $($proj.Slug)"
    Invoke-ProjectValidation -Proj $proj
    Write-Output ""
    $totalErrors   += $script:ProjResult.Errors
    $totalWarnings += $script:ProjResult.Warnings
    if ($script:ProjResult.Errors -eq 0) { $passed++ }
}

Write-Output "================================================================ system"
foreach ($w in $sysWarnings) { Write-Output "[WARN]  $w" }
foreach ($e in $sysErrors)   { Write-Output "[ERROR] $e" }
$totalErrors   += $sysErrors.Count
$totalWarnings += $sysWarnings.Count

Write-Output ""
Write-Output "Projects : $($toValidate.Count) validated, $passed passed"
if ($totalErrors -eq 0) {
    Write-Output "RESULT: PASS ($totalWarnings warning(s))"
    exit 0
} else {
    Write-Output "RESULT: FAIL - $totalErrors error(s), $totalWarnings warning(s)"
    exit 1
}
