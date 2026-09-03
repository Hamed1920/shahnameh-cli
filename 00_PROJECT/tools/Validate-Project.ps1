<#
.SYNOPSIS
  Validates the Shahnameh project against INDEXING.md v2.0.

.DESCRIPTION
  Proves the guarantees in SYNC_PROTOCOL.md section 7. Checks ID grammar, registry
  integrity, disk/manifest agreement, canonical variants and cross-references.
  Prints the next free number per kind and the project state hash.

.PARAMETER Quiet
  Only print errors, warnings and the summary.

.OUTPUTS
  Exit code 0 if clean, 1 if any error was found.
#>
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Shm-Common.ps1')

$Root         = Split-Path (Split-Path $PSScriptRoot)
$RegistryDir  = Join-Path $Root '00_PROJECT\registry'
$EntitiesCsv  = Join-Path $RegistryDir 'ENTITIES.csv'
$ManifestCsv  = Join-Path $RegistryDir 'ASSET_MANIFEST.csv'

$KINDS       = @('CHR','GRP','LOC','PRP','CRT','COS','VEH','FX','REF')
$STATUSES    = @('RESERVED','CONCEPT','APPROVED','LOCKED','RETIRED')
$ROLES       = @('HERO','TURNAROUND','PLATE','DETAIL','BOARD','RENDER')
$FLAGS       = @('NEEDS-HERO-SHEET','NEEDS-CANONICAL','REVIEW-SPLIT','NO-ASSET')
$MEDIA_EXT   = @('.png','.jpg','.jpeg','.webp','.mp4','.mov')
$ASSET_DIRS  = @('01_CHARACTERS','02_GROUPS','03_LOCATIONS','04_PROPS','05_CREATURES',
                 '06_COSTUMES','07_EPISODES','08_REFERENCE','09_OUTPUT')

$kindAlt   = ($KINDS -join '|')
$RX_ID     = '^SHM-(' + $kindAlt + ')-\d{3}-[A-Z0-9]+(-[A-Z0-9]+)*$'
$RX_SHORT  = '^(' + $kindAlt + ')-\d{3}$'
$RX_FILE   = '^SHM-(' + $kindAlt + ')-\d{3}-[A-Z0-9]+(-[A-Z0-9]+)*_V\d{2}(_T\d{2})?_[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|jpeg|webp|mp4|mov)$'

$errors   = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList

function Add-Err  ([string]$m) { [void]$errors.Add($m) }
function Add-Warn ([string]$m) { [void]$warnings.Add($m) }
function Split-List ([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return @() }
    return ($s -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

# ---------------------------------------------------------------- load

if (-not (Test-Path -LiteralPath $EntitiesCsv)) { throw "Missing $EntitiesCsv" }
if (-not (Test-Path -LiteralPath $ManifestCsv)) { throw "Missing $ManifestCsv" }

$entities = @(Import-Csv -LiteralPath $EntitiesCsv)
$manifest = @(Import-Csv -LiteralPath $ManifestCsv)

if (-not $Quiet) {
    Write-Output "Shahnameh project validator - INDEXING.md v2.0"
    Write-Output "Root: $Root"
    Write-Output ""
}

# ---------------------------------------------------------------- 1. entity rows

$seenId    = @{}
$seenSlug  = @{}
$seenShort = @{}

foreach ($e in $entities) {
    $id = $e.id

    if ($id -cnotmatch $RX_ID) { Add-Err "ENTITY id fails grammar: '$id'"; continue }
    if ($seenId.ContainsKey($id)) { Add-Err "ENTITY duplicate id: $id" }
    $seenId[$id] = $true

    $parts  = $id -split '-', 3
    $kind   = $parts[1]
    $rest   = $parts[2]
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

# ---------------------------------------------------------------- 2. manifest rows

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

# ---------------------------------------------------------------- 3. disk vs manifest

$onDisk = @{}
foreach ($d in $ASSET_DIRS) {
    $p = Join-Path $Root $d
    if (-not (Test-Path -LiteralPath $p)) { continue }
    Get-ChildItem -LiteralPath $p -Recurse -File | Where-Object { $MEDIA_EXT -contains $_.Extension.ToLower() } | ForEach-Object {
        $onDisk[$_.Name] = $_
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
    Add-Err "UNFILED media in project root: $($_.Name) - move it to 99_INBOX or index it"
}

# ---------------------------------------------------------------- 4. variants and canonicals

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

# ---------------------------------------------------------------- 5. next free numbers + state hash

$nextFree  = Get-ShmNextNumbers -Entities $entities
$stateHash = Get-ShmStateHash   -Entities $entities

# ---------------------------------------------------------------- report

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
    exit 0
} else {
    Write-Output "RESULT: FAIL - $($errors.Count) error(s), $($warnings.Count) warning(s)"
    exit 1
}
