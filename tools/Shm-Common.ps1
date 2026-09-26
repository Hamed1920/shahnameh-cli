<#
  Shared helpers for the Film Making for Dummies tools. Dot-source this, do not run it.
      . (Join-Path $PSScriptRoot 'Shm-Common.ps1')

  The repo holds any number of projects as TOP-LEVEL folders, <repo>/<slug>/. A top-level
  folder is a project when it holds a project.json; the system folders and files beside
  them (10_PANEL, tools, docs, templates, dot-entries) are not. Every project has the same
  layout; only its ID prefix ("code" in project.json, e.g. SHM) differs. Kinds, folders,
  statuses, roles and the EP/SQ/SC/SH shape are system-wide.

  Pick a project with Resolve-ShmProject:
      -Project <slug>   explicit
      $env:SHM_ROOT     a project root directory (sandboxes), when -Project is not given
      otherwise         the only project in the repo, or an error listing the slugs
#>

# Captured at dot-source time: the directory this file lives in (tools/).
$script:ShmToolsDir = $PSScriptRoot

$script:ShmKinds    = @('CHR','GRP','LOC','PRP','CRT','COS','VEH','FX','REF')
$script:ShmStatuses = @('RESERVED','CONCEPT','APPROVED','LOCKED','RETIRED')

# THE kind -> folder map. 10_PANEL/worker/lib/ids.mjs mirrors this; keep them in step.
$script:ShmFolderFor = [ordered]@{
    'CHR' = '01_CHARACTERS'
    'GRP' = '02_GROUPS'
    'LOC' = '03_LOCATIONS'
    'PRP' = '04_PROPS'
    'CRT' = '05_CREATURES'
    'COS' = '06_COSTUMES'
    'VEH' = '04_PROPS'
    'FX'  = '08_REFERENCE'
    'REF' = '08_REFERENCE'
}

# Top-level entries that belong to the system, never to a project. Anything else at the
# top level is a project when it holds a project.json.
$script:ShmSystemDirs  = @('10_PANEL','tools','docs','templates','node_modules')
$script:ShmSystemFiles = @('CLAUDE.md','README.md','startup.md','skills-lock.json','HANDOFF.md')

# Project slug and code grammar, and the words a code may never be.
$script:ShmSlugPattern  = '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
$script:ShmCodePattern  = '^[A-Z]{2,4}$'
$script:ShmReservedCodes = @($script:ShmKinds + @('EP','SC','SH','SQ','NEW','NEXT','JOB'))

function Get-ShmRepoRoot {
    param([string]$ToolsDir = $script:ShmToolsDir)
    return (Split-Path $ToolsDir)
}

# Projects sit directly in the repo root, so this is the repo root itself.
function Get-ShmProjectsDir {
    return (Get-ShmRepoRoot)
}

# True for a top-level entry that is part of the system rather than a project.
function Test-ShmSystemEntry {
    param([Parameter(Mandatory)][string]$Name)
    if ($Name.StartsWith('.')) { return $true }
    if ($script:ShmSystemDirs  -contains $Name) { return $true }
    if ($script:ShmSystemFiles -contains $Name) { return $true }
    return $false
}

# Reads a project.json. Throws with the path in the message if it cannot be parsed.
function Read-ShmProjectJson {
    param([Parameter(Mandatory)][string]$Path)
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        throw "Cannot read $Path : $($_.Exception.Message)"
    }
}

# -Slug overrides the slug in project.json with the folder name, which is what a caller
# addresses the project by. Only SHM_ROOT sandboxes, whose folder can be named anything,
# fall back to the declared slug.
function New-ShmProjectObject {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][object]$Json, [string]$Slug)
    $slug = $Slug
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = [string]$Json.slug }
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = Split-Path $Root -Leaf }
    return [pscustomobject]@{
        Slug        = $slug
        Name        = [string]$Json.name
        Code        = [string]$Json.code
        Description = [string]$Json.description
        Root        = $Root
        JsonPath    = (Join-Path $Root 'project.json')
    }
}

# Every top-level folder that contains a readable project.json. System folders and
# dot-entries (the panel's .new-<slug>-<random> staging folders, .generate.lock) are skipped.
function Get-ShmProjects {
    $dir = Get-ShmProjectsDir
    $out = @()
    if (-not (Test-Path -LiteralPath $dir)) { return $out }
    foreach ($d in (Get-ChildItem -LiteralPath $dir -Directory -Force | Sort-Object Name)) {
        if (Test-ShmSystemEntry -Name $d.Name) { continue }
        $json = Join-Path $d.FullName 'project.json'
        if (-not (Test-Path -LiteralPath $json)) { continue }
        try { $j = Read-ShmProjectJson -Path $json } catch { continue }
        $out += (New-ShmProjectObject -Root $d.FullName -Json $j -Slug $d.Name)
    }
    return $out
}

function Assert-ShmProjectCode {
    param([Parameter(Mandatory)][object]$Proj)
    if ($Proj.Code -cnotmatch $script:ShmCodePattern) {
        throw "Project '$($Proj.Slug)' has code '$($Proj.Code)' in $($Proj.JsonPath) - it must be 2-4 uppercase letters."
    }
    if ($script:ShmReservedCodes -ccontains $Proj.Code) {
        throw "Project '$($Proj.Slug)' uses reserved word '$($Proj.Code)' as its code."
    }
}

<#
  Picks the project a tool works on. Returns {Slug, Name, Code, Description, Root, JsonPath}.
#>
function Resolve-ShmProject {
    param([string]$Project)

    if (-not [string]::IsNullOrWhiteSpace($Project)) {
        $slug = $Project.Trim()
        if ($slug -cnotmatch $script:ShmSlugPattern) {
            throw "Invalid project slug '$slug' - use lowercase letters, digits and hyphens (e.g. shahnameh)."
        }
        $root = Join-Path (Get-ShmProjectsDir) $slug
        $json = Join-Path $root 'project.json'
        if (-not (Test-Path -LiteralPath $json)) {
            $known = @(Get-ShmProjects | ForEach-Object { $_.Slug })
            $list  = if ($known.Count -gt 0) { $known -join ', ' } else { '(none)' }
            throw "No project '$slug': $json does not exist. Known projects: $list"
        }
        $j = Read-ShmProjectJson -Path $json
        if ([string]$j.slug -cne $slug) {
            throw "Project folder '$slug' holds a project.json whose slug is '$($j.slug)' - they must match."
        }
        $proj = New-ShmProjectObject -Root $root -Json $j -Slug $slug
        Assert-ShmProjectCode -Proj $proj
        return $proj
    }

    if (-not [string]::IsNullOrWhiteSpace($env:SHM_ROOT)) {
        $root = [System.IO.Path]::GetFullPath($env:SHM_ROOT)
        $json = Join-Path $root 'project.json'
        if (-not (Test-Path -LiteralPath $json)) {
            throw "SHM_ROOT is set to '$root' but it has no project.json. SHM_ROOT must point at a project root (a folder like <repo>/<slug>)."
        }
        $proj = New-ShmProjectObject -Root $root -Json (Read-ShmProjectJson -Path $json)
        Assert-ShmProjectCode -Proj $proj
        return $proj
    }

    $all = @(Get-ShmProjects)
    if ($all.Count -eq 0) {
        throw "No projects found in $(Get-ShmRepoRoot). Each project is a top-level folder with a project.json."
    }
    if ($all.Count -gt 1) {
        $list = ($all | ForEach-Object { "$($_.Slug) ($($_.Code))" }) -join ', '
        throw "More than one project exists: $list. Pass -Project <slug> to choose one."
    }
    Assert-ShmProjectCode -Proj $all[0]
    return $all[0]
}

# Root directory of a project. -Project is a slug (or empty, see Resolve-ShmProject).
function Get-ShmRoot {
    param([string]$Project)
    return (Resolve-ShmProject -Project $Project).Root
}

<#
  Every path a tool needs, under the project root. Pass the object from Resolve-ShmProject
  as -Project. -Root alone still works (reads project.json there for the code).
#>
function Get-ShmPaths {
    param([object]$Project, [string]$Root)

    if ($Project -is [string]) { $Project = Resolve-ShmProject -Project $Project }
    if (-not $Project) {
        if ($Root) {
            $json = Join-Path $Root 'project.json'
            if (-not (Test-Path -LiteralPath $json)) { throw "No project.json in $Root" }
            $Project = New-ShmProjectObject -Root $Root -Json (Read-ShmProjectJson -Path $json)
        } else {
            $Project = Resolve-ShmProject
        }
    }
    $Root = $Project.Root

    return [pscustomobject]@{
        RepoRoot    = Get-ShmRepoRoot
        Root        = $Root
        Slug        = $Project.Slug
        Name        = $Project.Name
        Code        = $Project.Code
        ProjectJson = Join-Path $Root 'project.json'
        Registry    = Join-Path $Root '00_PROJECT\registry'
        Entities    = Join-Path $Root '00_PROJECT\registry\ENTITIES.csv'
        Manifest    = Join-Path $Root '00_PROJECT\registry\ASSET_MANIFEST.csv'
        Episodes    = Join-Path $Root '00_PROJECT\registry\EPISODES.csv'
        Sync        = Join-Path $Root '00_PROJECT\sync'
        Inbox       = Join-Path $Root '00_PROJECT\sync\inbox'
        Processed   = Join-Path $Root '00_PROJECT\sync\processed'
        Receipts    = Join-Path $Root '00_PROJECT\sync\receipts'
        Ledger      = Join-Path $Root '00_PROJECT\sync\JOB_LEDGER.csv'
        Pack        = Join-Path $Root '00_PROJECT\sync\CONTEXT_PACK.md'
        Questions   = Join-Path $Root '00_PROJECT\OPEN_QUESTIONS.md'
        Log         = Join-Path $Root '00_PROJECT\PROJECT_LOG.md'
        Review      = Join-Path $Root '00_PROJECT\review'
        Learnings   = Join-Path $Root '00_PROJECT\review\LEARNINGS.jsonl'
        Queue       = Join-Path $Root '00_PROJECT\queue'
        Unfiled     = Join-Path $Root '99_INBOX'
    }
}

function Split-ShmList {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    return @($Value -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

function Get-ShmSha8 {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
        return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 8)
    } finally { $sha.Dispose() }
}

<#
  THE state hash. Both the validator and the context pack builder call this, so the hash
  a job echoes back can always be compared against the hash the pack advertised.
  Changing this formula invalidates every state_hash in flight - do it deliberately.
#>
function Get-ShmStateHash {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entities)
    $src = [string](@($Entities | Sort-Object id | ForEach-Object {
        "$($_.id)|$($_.status)|$($_.canonical_variant)|$($_.variant_count)"
    }) -join "`n")
    return (Get-ShmSha8 -Text $src)
}

function Get-ShmNextNumbers {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entities)
    $out = [ordered]@{}
    foreach ($k in $script:ShmKinds) {
        $used = @($Entities | Where-Object { $_.kind -ceq $k } | ForEach-Object { [int]$_.number })
        if ($used.Count -eq 0) { $out[$k] = '001' }
        else { $out[$k] = ('{0:D3}' -f ([int](($used | Measure-Object -Maximum).Maximum) + 1)) }
    }
    return $out
}

# Accepts 'CHR-001' or '<CODE>-CHR-001-ZAHHAK'. Returns the entity row, or $null.
# -Code is the project code; without it any 2-4 letter prefix is accepted as a full id.
function Resolve-ShmEntity {
    param(
        [Parameter(Mandatory)][string]$Ref,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entities,
        [string]$Code
    )
    $r = $Ref.Trim().TrimStart('@')
    if ($Code) { $rxFull = '^' + [regex]::Escape($Code) + '-' }
    else       { $rxFull = '^[A-Z]{2,4}-(' + ($script:ShmKinds -join '|') + ')-\d{3}-' }
    if ($r -cmatch $rxFull) { return ($Entities | Where-Object { $_.id -ceq $r } | Select-Object -First 1) }
    return ($Entities | Where-Object { $_.short_id -ceq $r } | Select-Object -First 1)
}

<#
  Resolves a reference token to a file path.
      @CHR-001            -> the canonical variant
      @CHR-001/V02        -> that variant
      @CHR-001/V02/T03    -> that take
  Returns a pscustomobject with Ok, Path, Id, Variant, Take and Reason.
#>
function Resolve-ShmRef {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entities,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Manifest,
        [Parameter(Mandatory)][string]$Root,
        [string]$Code
    )
    $fail = { param($why) [pscustomobject]@{ Ok=$false; Path=$null; Id=$null; Variant=$null; Take=$null; Reason=$why } }

    $t     = $Token.Trim().TrimStart('@')
    $parts = $t -split '/'
    $ent   = Resolve-ShmEntity -Ref $parts[0] -Entities $Entities -Code $Code
    if (-not $ent) { return (& $fail "unknown entity '$($parts[0])'") }

    $variant = $null
    if ($parts.Count -ge 2 -and $parts[1] -ne '') { $variant = $parts[1].ToUpper() }
    else {
        $variant = $ent.canonical_variant
        if ([string]::IsNullOrWhiteSpace($variant)) {
            return (& $fail "$($ent.id) has no canonical_variant and none was specified")
        }
    }

    $take = $null
    if ($parts.Count -ge 3 -and $parts[2] -ne '') { $take = $parts[2].ToUpper() }

    $rows = @($Manifest | Where-Object { $_.entity_id -ceq $ent.id -and $_.variant -ceq $variant })
    if ($take) { $rows = @($rows | Where-Object { $_.take -ceq $take }) }
    if ($rows.Count -eq 0) { return (& $fail "$($ent.id) has no asset for $variant$(if($take){"/$take"})") }

    $row  = $rows | Sort-Object take -Descending | Select-Object -First 1
    $path = Join-Path (Join-Path $Root $row.folder) $row.filename
    if (-not (Test-Path -LiteralPath $path)) { return (& $fail "manifest row exists but file is missing: $($row.filename)") }

    return [pscustomobject]@{ Ok=$true; Path=$path; Id=$ent.id; Variant=$variant; Take=$row.take; Reason=$null }
}

# Rewrites a registry CSV. An empty row set is ignored so a header-only CSV is never
# truncated to zero bytes (Export-Csv writes no header without rows).
# Is a lock file (queue\worker.lock, .generate.lock) held by a running process?
# Mirrors lockIsStale in 10_PANEL/worker/lib/locks.mjs: the first word is the pid; a
# lock whose second line says heartbeat=<s> is also stale once nobody has touched it
# for 3 minutes, because after a crash and a reboot Windows can give that pid to
# another process.
function Test-ShmLiveLock {
    param([Parameter(Mandatory)][string]$LockPath)
    if (-not (Test-Path -LiteralPath $LockPath)) { return $false }
    $raw = ''
    try { $raw = [string](Get-Content -LiteralPath $LockPath -Raw) } catch { $raw = '' }
    $tok = @(($raw.Trim()) -split '\s+')[0]
    $procId = 0
    if (-not [int]::TryParse($tok, [ref]$procId) -or $procId -le 0) { return $false }
    if ($null -eq (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { return $false }
    if ($raw -match 'heartbeat=\d+') {
        $age = (Get-Date) - (Get-Item -LiteralPath $LockPath).LastWriteTime
        if ($age.TotalMinutes -gt 3) { return $false }
    }
    return $true
}

function Write-ShmCsv {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rows,
        [Parameter(Mandatory)][string]$Path
    )
    if ($Rows.Count -eq 0) { return }
    $Rows | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8
}
