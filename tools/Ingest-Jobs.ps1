<#
.SYNOPSIS
  Ingests SHM-JOB blocks authored in Claude Chat or Claude Cowork into one project.

.DESCRIPTION
  Parses, validates, allocates IDs for NEW/ proposals, applies pure registry operations,
  resolves every @reference token, and writes a receipt plus a ledger row per job.

  Generation jobs are validated and marked READY - this script never calls an image or video
  engine itself. The agent executes READY jobs from the plan file it writes.

  Blocks may carry a "project: <CODE>" line. A block whose code is not this project's code
  is rejected, so a job never lands in the wrong project.

.PARAMETER Project
  The slug of the project to ingest into (its top-level folder name). Optional when
  only one project exists or $env:SHM_ROOT points at a project root.

.PARAMETER Path
  A job file, or a directory of them. Defaults to the project's 00_PROJECT/sync/inbox.

.PARAMETER Text
  Raw job text, for pasting straight in instead of dropping a file.

.PARAMETER WhatIf
  Parse and validate only. Writes nothing, moves nothing.
#>
[CmdletBinding()]
param(
    [string]$Project,
    [string]$Path,
    [string]$Text,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Shm-Common.ps1')

$Proj = Resolve-ShmProject -Project $Project
$P    = Get-ShmPaths -Project $Proj
$Root = $P.Root
$Code = $P.Code

$VALID_TYPES = @('generate.image','generate.video','register.entity','update.entity','retire.entity','define.shot')
$FOLDER_FOR  = $ShmFolderFor

$entities = @(Import-Csv -LiteralPath $P.Entities)
$manifest = @(Import-Csv -LiteralPath $P.Manifest)
$hashNow  = Get-ShmStateHash -Entities $entities

$ledger = @()
if (Test-Path -LiteralPath $P.Ledger) { $ledger = @(Import-Csv -LiteralPath $P.Ledger) }

# ---------------------------------------------------------------- gather sources

$sources = @()   # @{ Name; Text; File }

if ($Text) {
    $sources += @{ Name = 'pasted'; Text = $Text; File = $null }
}
if (-not $Text) {
    if (-not $Path) {
        $Path = $P.Inbox
        if (-not (Test-Path -LiteralPath $Path)) {
            Write-Output "Nothing to ingest. Inbox does not exist yet: $($P.Inbox)"
            exit 0
        }
    }
    if (-not (Test-Path -LiteralPath $Path)) { throw "Not found: $Path" }
    $item = Get-Item -LiteralPath $Path
    $files = if ($item.PSIsContainer) {
        @(Get-ChildItem -LiteralPath $Path -File | Where-Object { $_.Extension -match '^\.(txt|md|job)$' })
    } else { @($item) }

    foreach ($f in $files) {
        $sources += @{ Name = $f.Name; Text = (Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8); File = $f }
    }
}

if ($sources.Count -eq 0) {
    Write-Output "Nothing to ingest. Inbox is empty: $($P.Inbox)"
    exit 0
}

# ---------------------------------------------------------------- parse

function Parse-JobBlocks {
    param([string]$Body, [string]$SourceName)

    $rx = [regex]'(?ms)^===[ \t]*SHM-JOB[ \t]*===[ \t]*\r?\n(.*?)^===[ \t]*END[ \t]+SHM-JOB[ \t]*===[ \t]*$'
    $out = @()
    foreach ($m in $rx.Matches($Body)) {
        $inner  = $m.Groups[1].Value
        $raw    = $m.Value

        $prompt = $null
        $rxP = [regex]'(?ms)^---[ \t]*prompt[ \t]*---[ \t]*\r?\n(.*?)^---[ \t]*end[ \t]+prompt[ \t]*---[ \t]*$'
        $pm = $rxP.Match($inner)
        if ($pm.Success) {
            $prompt = $pm.Groups[1].Value.Trim()
            $inner  = $inner.Remove($pm.Index, $pm.Length)
        }

        $h = @{}
        foreach ($line in ($inner -split "`r?`n")) {
            if ($line.Trim() -eq '') { continue }
            $i = $line.IndexOf(':')
            if ($i -lt 1) { continue }
            $k = $line.Substring(0, $i).Trim().ToLower()
            $v = $line.Substring($i + 1).Trim()
            $h[$k] = $v
        }

        $norm = ($raw -replace "`r`n", "`n").Trim()
        $out += [pscustomobject]@{
            Headers = $h
            Prompt  = $prompt
            Raw     = $raw
            Hash    = (Get-ShmSha8 -Text $norm)
            Source  = $SourceName
        }
    }
    return $out
}

$jobs = @()
foreach ($s in $sources) {
    $parsed = @(Parse-JobBlocks -Body $s.Text -SourceName $s.Name)
    if ($parsed.Count -eq 0) {
        Write-Output "[WARN] no SHM-JOB blocks found in '$($s.Name)'"
    }
    foreach ($j in $parsed) { $jobs += ,@{ Job = $j; Source = $s } }
}

if ($jobs.Count -eq 0) { Write-Output "No jobs parsed."; exit 1 }

# ---------------------------------------------------------------- process

$results   = @()
$newRows   = @()
$ledgerAdd = @()
$plan      = @()
$stale     = $false

# job_ids seen within this run, to catch in-batch duplicates
$batchIds = @{}

foreach ($entry in $jobs) {
    $j = $entry.Job
    $h = $j.Headers

    function Fail ([string]$why) {
        $script:results += [pscustomobject]@{
            JobId = $(if ($h['job_id']) { $h['job_id'] } else { '(no job_id)' })
            State = 'REJECTED'; Detail = $why
        }
    }

    $jobId = $h['job_id']
    if (-not $jobId)                        { Fail "missing job_id";                       continue }
    if ($jobId -notmatch '^J-\d{8}-\d{3}$') { Fail "job_id '$jobId' is not J-YYYYMMDD-NNN"; continue }

    # A block addressed to another project is never ingested here.
    if ($h.ContainsKey('project') -and $h['project'] -cne $Code) {
        $other = @(Get-ShmProjects | Where-Object { $_.Code -ceq $h['project'] } | Select-Object -First 1)
        $hint  = if ($other.Count -gt 0) { " - ingest it with -Project $($other[0].Slug)" } else { '' }
        Fail "block is for project '$($h['project'])' but this is $($P.Name) ($Code)$hint"
        continue
    }

    if ($batchIds.ContainsKey($jobId)) { Fail "job_id '$jobId' appears twice in this batch"; continue }
    $batchIds[$jobId] = $true

    $prior = $ledger | Where-Object { $_.job_id -ceq $jobId } | Select-Object -First 1
    if ($prior) {
        if ($prior.content_hash -ceq $j.Hash) {
            $results += [pscustomobject]@{ JobId=$jobId; State='DUPLICATE'; Detail="already ingested $($prior.ingested), unchanged" }
            continue
        } else {
            Fail "job_id '$jobId' was already used with DIFFERENT content (was $($prior.content_hash), now $($j.Hash)). Give the revision a new job_id."
            continue
        }
    }

    $type = $h['type']
    if (-not $type)                      { Fail "missing type";                    continue }
    if ($VALID_TYPES -notcontains $type) { Fail "unknown type '$type'";            continue }
    if (-not $h['target'])               { Fail "missing target";                  continue }

    if ($h['state_hash'] -and $h['state_hash'] -cne $hashNow) {
        $stale = $true
        $results += [pscustomobject]@{ JobId=$jobId; State='NOTE'; Detail="written against state_hash $($h['state_hash']), current is $hashNow" }
    }

    # ---- resolve target -------------------------------------------------
    $target       = $h['target'].Trim()
    $resolvedId   = $null
    $assignedNew  = $false

    if ($target -cmatch '^NEW/([A-Z]{2,3})/([A-Z0-9][A-Z0-9-]*)$') {
        $kind = $Matches[1]; $slug = $Matches[2]
        if (-not $FOLDER_FOR.Contains($kind)) { Fail "NEW proposal uses unknown kind '$kind'"; continue }

        $clash = $entities | Where-Object { $_.slug -ceq $slug } | Select-Object -First 1
        if ($clash) { Fail "NEW slug '$slug' already exists as $($clash.id)"; continue }
        $clash2 = $newRows | Where-Object { $_.slug -ceq $slug } | Select-Object -First 1
        if ($clash2) { Fail "NEW slug '$slug' already claimed earlier in this batch as $($clash2.id)"; continue }

        $used = @(@($entities + $newRows) | Where-Object { $_.kind -ceq $kind } | ForEach-Object { [int]$_.number })
        $num  = if ($used.Count -eq 0) { 1 } else { [int](($used | Measure-Object -Maximum).Maximum) + 1 }
        $nnn  = '{0:D3}' -f $num

        $resolvedId = "$Code-$kind-$nnn-$slug"
        $family = ($slug -split '-')[0]
        $newRows += [pscustomobject][ordered]@{
            id                = $resolvedId
            short_id          = "$kind-$nnn"
            kind              = $kind
            number            = $nnn
            slug              = $slug
            name              = ($slug -replace '-', ' ')
            family            = $family
            status            = 'RESERVED'
            canonical_variant = ''
            variant_count     = '0'
            folder            = $FOLDER_FOR[$kind]
            related           = ''
            flags             = 'NO-ASSET'
            description       = $(if ($h['notes']) { $h['notes'] } else { "Reserved by $jobId. Description pending." })
        }
        $assignedNew = $true
    }
    else {
        $ent = Resolve-ShmEntity -Ref $target -Entities @($entities + $newRows) -Code $Code
        if (-not $ent) { Fail "unknown target '$target' (never auto-created - register it explicitly)"; continue }
        $resolvedId = $ent.id
    }

    # ---- resolve refs ---------------------------------------------------
    $refPaths = @()
    $refBad   = $null
    foreach ($tok in (Split-ShmList $h['refs'])) {
        $r = Resolve-ShmRef -Token $tok -Entities $entities -Manifest $manifest -Root $Root -Code $Code
        if (-not $r.Ok) { $refBad = "unresolved ref '$tok': $($r.Reason)"; break }
        $refPaths += $r.Path
    }
    if ($refBad) { Fail $refBad; continue }

    # ---- prompt required for generate.* ---------------------------------
    if ($type -like 'generate.*' -and [string]::IsNullOrWhiteSpace($j.Prompt)) {
        Fail "type '$type' needs a --- prompt --- body"; continue
    }

    # ---- record ---------------------------------------------------------
    $state  = if ($assignedNew) { 'ASSIGNED' } else { 'READY' }
    $detail = if ($assignedNew) { "$target -> $resolvedId (RESERVED)" } else { $resolvedId }
    if ($h['variant']) { $detail = "$detail $($h['variant'])" }

    $results += [pscustomobject]@{ JobId=$jobId; State=$state; Detail=$detail }

    $plan += [pscustomobject]@{
        job_id   = $jobId
        project  = $Code
        type     = $type
        entity   = $resolvedId
        variant  = $h['variant']
        engine   = $h['engine']
        refs     = ($refPaths -join ' | ')
        params   = $h['params']
        notes    = $h['notes']
        prompt   = $j.Prompt
    }

    $ledgerAdd += [pscustomobject][ordered]@{
        job_id          = $jobId
        content_hash    = $j.Hash
        author          = $h['author']
        type            = $type
        target          = $target
        resolved_target = $resolvedId
        variant         = $h['variant']
        engine          = $h['engine']
        state           = $state
        ingested        = (Get-Date -Format 'yyyy-MM-dd HH:mm')
        source_file     = $j.Source
    }
}

# ---------------------------------------------------------------- write

$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$planPath  = Join-Path $P.Sync "PLAN-$stamp.json"
$rcptPath  = Join-Path $P.Receipts "RECEIPT-$stamp.txt"

$receipt = New-Object System.Text.StringBuilder
[void]$receipt.AppendLine('=== SHM-RECEIPT ===')
[void]$receipt.AppendLine("project: $Code")
[void]$receipt.AppendLine("state_hash: $hashNow")
foreach ($r in $results) {
    [void]$receipt.AppendLine(("{0,-16} {1,-10} {2}" -f $r.JobId, $r.State, $r.Detail))
}
[void]$receipt.AppendLine('=== END SHM-RECEIPT ===')
$receiptText = $receipt.ToString()

if ($WhatIf) {
    Write-Output "-- WhatIf: nothing written --"
    Write-Output $receiptText
    exit 0
}

# The worker rewrites ENTITIES.csv and JOB_LEDGER.csv whole too; writing them while it
# runs would lose one side's changes. Stop it first (Queue page: Stop all workers).
if (Test-ShmLiveLock -LockPath (Join-Path $P.Queue 'worker.lock')) {
    Write-Output "REFUSED: this project's worker is running, and it rewrites the same registries."
    Write-Output "Stop it first (Queue page -> Stop all workers), then run this again. Nothing was written."
    exit 1
}

foreach ($dir in @($P.Sync, $P.Receipts, $P.Processed)) {
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

if ($newRows.Count -gt 0) {
    Write-ShmCsv -Rows @($entities + $newRows) -Path $P.Entities
    $entities = @(Import-Csv -LiteralPath $P.Entities)
}
if ($ledgerAdd.Count -gt 0) {
    Write-ShmCsv -Rows @($ledger + $ledgerAdd) -Path $P.Ledger
}
if ($plan.Count -gt 0) {
    # BOM-less: Node refuses a BOM, and PS 5.1 Set-Content -Encoding UTF8 writes one.
    $planJson = ConvertTo-Json -InputObject @($plan) -Depth 4
    [System.IO.File]::WriteAllText($planPath, $planJson, (New-Object System.Text.UTF8Encoding($false)))
}

[System.IO.File]::WriteAllText($rcptPath, $receiptText, (New-Object System.Text.UTF8Encoding($false)))

# archive consumed inbox files, but only if nothing from them was rejected
$rejected = @($results | Where-Object { $_.State -ceq 'REJECTED' })
foreach ($s in $sources) {
    if (-not $s.File) { continue }
    if ($rejected.Count -eq 0) {
        Move-Item -LiteralPath $s.File.FullName -Destination (Join-Path $P.Processed "$stamp-$($s.File.Name)") -Force
    }
}

# ---------------------------------------------------------------- report

Write-Output $receiptText
if ($plan.Count -gt 0)     { Write-Output "Plan     : $planPath" }
Write-Output "Receipt  : $rcptPath"
if ($newRows.Count -gt 0)  { Write-Output "Reserved : $($newRows.Count) new entity id(s) - fill in their descriptions" }
if ($stale)                { Write-Output "NOTE     : at least one job was written against a stale context pack. Re-run /sync-out." }
if ($rejected.Count -gt 0) {
    Write-Output "REJECTED : $($rejected.Count) job(s). Source files left in the inbox for correction."
    exit 1
}
exit 0
