<#
  Shared helpers for the Shahnameh tools. Dot-source this, do not run it.
      . (Join-Path $PSScriptRoot 'Shm-Common.ps1')
#>

$script:ShmKinds    = @('CHR','GRP','LOC','PRP','CRT','COS','VEH','FX','REF')
$script:ShmStatuses = @('RESERVED','CONCEPT','APPROVED','LOCKED','RETIRED')

function Get-ShmRoot {
    param([string]$ToolsDir = $PSScriptRoot)
    return (Split-Path (Split-Path $ToolsDir))
}

function Get-ShmPaths {
    param([Parameter(Mandatory)][string]$Root)
    return [pscustomobject]@{
        Root      = $Root
        Registry  = Join-Path $Root '00_PROJECT\registry'
        Entities  = Join-Path $Root '00_PROJECT\registry\ENTITIES.csv'
        Manifest  = Join-Path $Root '00_PROJECT\registry\ASSET_MANIFEST.csv'
        Episodes  = Join-Path $Root '00_PROJECT\registry\EPISODES.csv'
        Sync      = Join-Path $Root '00_PROJECT\sync'
        Inbox     = Join-Path $Root '00_PROJECT\sync\inbox'
        Processed = Join-Path $Root '00_PROJECT\sync\processed'
        Receipts  = Join-Path $Root '00_PROJECT\sync\receipts'
        Ledger    = Join-Path $Root '00_PROJECT\sync\JOB_LEDGER.csv'
        Pack      = Join-Path $Root '00_PROJECT\sync\CONTEXT_PACK.md'
        Questions = Join-Path $Root '00_PROJECT\OPEN_QUESTIONS.md'
        Log       = Join-Path $Root '00_PROJECT\PROJECT_LOG.md'
    }
}

function Split-ShmList {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    return @($Value -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

function Get-ShmSha8 {
    param([Parameter(Mandatory)][string]$Text)
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
    param([Parameter(Mandatory)][object[]]$Entities)
    $src = ($Entities | Sort-Object id | ForEach-Object {
        "$($_.id)|$($_.status)|$($_.canonical_variant)|$($_.variant_count)"
    }) -join "`n"
    return (Get-ShmSha8 -Text $src)
}

function Get-ShmNextNumbers {
    param([Parameter(Mandatory)][object[]]$Entities)
    $out = [ordered]@{}
    foreach ($k in $script:ShmKinds) {
        $used = @($Entities | Where-Object { $_.kind -ceq $k } | ForEach-Object { [int]$_.number })
        if ($used.Count -eq 0) { $out[$k] = '001' }
        else { $out[$k] = ('{0:D3}' -f ([int](($used | Measure-Object -Maximum).Maximum) + 1)) }
    }
    return $out
}

# Accepts 'CHR-001' or 'SHM-CHR-001-ZAHHAK'. Returns the entity row, or $null.
function Resolve-ShmEntity {
    param(
        [Parameter(Mandatory)][string]$Ref,
        [Parameter(Mandatory)][object[]]$Entities
    )
    $r = $Ref.Trim().TrimStart('@')
    if ($r -cmatch '^SHM-') { return ($Entities | Where-Object { $_.id -ceq $r } | Select-Object -First 1) }
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
        [Parameter(Mandatory)][object[]]$Entities,
        [Parameter(Mandatory)][object[]]$Manifest,
        [Parameter(Mandatory)][string]$Root
    )
    $fail = { param($why) [pscustomobject]@{ Ok=$false; Path=$null; Id=$null; Variant=$null; Take=$null; Reason=$why } }

    $t     = $Token.Trim().TrimStart('@')
    $parts = $t -split '/'
    $ent   = Resolve-ShmEntity -Ref $parts[0] -Entities $Entities
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

function Write-ShmCsv {
    param(
        [Parameter(Mandatory)][object[]]$Rows,
        [Parameter(Mandatory)][string]$Path
    )
    $Rows | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8
}
