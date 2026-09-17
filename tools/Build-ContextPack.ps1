<#
.SYNOPSIS
  Builds a project's 00_PROJECT/sync/CONTEXT_PACK.md - the paste-into-Claude-Chat/Cowork briefing.

.DESCRIPTION
  Everything an authoring surface needs to write correct prompts and correct JOB blocks,
  and nothing it does not: the rules, the entity index, the next free numbers, the open
  questions, and a state hash so stale jobs can be detected on the way back in.

.PARAMETER Project
  The slug of the project (its top-level folder name). Optional when only one
  project exists or $env:SHM_ROOT points at a project root.

.PARAMETER OutFile
  Write the pack here instead of the project's 00_PROJECT/sync/CONTEXT_PACK.md.
#>
[CmdletBinding()]
param(
    [string]$Project,
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Shm-Common.ps1')

$Proj  = Resolve-ShmProject -Project $Project
$P     = Get-ShmPaths -Project $Proj
$Root  = $P.Root
$Code  = $P.Code
$Name  = $P.Name
if (-not $OutFile) { $OutFile = $P.Pack }

$entities  = @(Import-Csv -LiteralPath $P.Entities)
$manifest  = @(Import-Csv -LiteralPath $P.Manifest)
$stateHash = Get-ShmStateHash   -Entities $entities
$nextFree  = Get-ShmNextNumbers -Entities $entities
$stamp     = (Get-Date -Format 'yyyy-MM-dd HH:mm')

# Example IDs come from the project itself when it has entities, so the examples are real.
$kindOrder = @{}
for ($i = 0; $i -lt $ShmKinds.Count; $i++) { $kindOrder[$ShmKinds[$i]] = $i }
$sorted    = @($entities | Sort-Object @{ Expression = { $kindOrder[$_.kind] } }, @{ Expression = { [int]$_.number } })
$exTarget  = @($sorted | Where-Object { $_.kind -ceq 'PRP' } | Select-Object -First 1)
if ($exTarget.Count -eq 0) { $exTarget = @($sorted | Select-Object -First 1) }
if ($exTarget.Count -gt 0) { $exId = $exTarget[0].id; $exShort = $exTarget[0].short_id }
else                       { $exId = "$Code-PRP-001-EXAMPLE"; $exShort = 'PRP-001' }
$exChar    = @($sorted | Where-Object { $_.kind -ceq 'CHR' } | Select-Object -First 1)
$exCharShort = if ($exChar.Count -gt 0) { $exChar[0].short_id } else { 'CHR-001' }

$sb = New-Object System.Text.StringBuilder
function W ([string]$s = '') { [void]$sb.AppendLine($s) }

W "# $Name - Context Pack"
W ""
W "Generated $stamp - ``state_hash: $stateHash``"
W ""
W "Paste or attach this at the start of a Claude Chat conversation, or add it to the files of a"
W "Claude Cowork project. It is the complete current state of the **$Name** asset index"
W "(project code ``$Code`` - every ID in this project starts with ``$Code-``)."
W "Regenerate it (``/sync-out``) whenever the CLI has added or changed entities."
W ""
W "---"
W ""
W "## Your role"
W ""
W "You are the **authoring** side. You write creative direction and prompts. You do **not** name"
W "files, invent ID numbers, or guess at paths - the CLI owns all of that."
W ""
W "Three rules:"
W ""
W "1. **Refer to everything by ID.** Never ``the walking stick`` - there may be several. Say ``$exShort``."
W "2. **Never assign a number.** To propose something new, write ``NEW/KIND/SLUG-YOU-WANT`` and the"
W "   CLI will allocate the real number and tell you what it was."
W "3. **Emit work as JOB blocks** in exactly the format below. Anything else has to be retyped by"
W "   hand at the other end. Every block carries ``project: $Code``."
W ""
W "## Reference tokens"
W ""
W "Cite an existing asset inside a prompt or in ``refs`` with an ``@`` token. The CLI resolves each"
W "one to a real image before it spends anything on generation."
W ""
W '```'
W "@$exCharShort            the canonical look of that entity"
W "@$exCharShort/V02        a specific variant"
W "@$exCharShort/V02/T03    a specific take"
W '```'
W ""
W "An unresolvable token means the whole job is rejected. If you are unsure a variant exists,"
W "use the bare ``@$exCharShort`` form and let the CLI pick the canonical."
W ""
W "## JOB block format"
W ""
W '```'
W "=== SHM-JOB ==="
W "project: $Code"
W "job_id: J-$(Get-Date -Format 'yyyyMMdd')-001"
W "author: claude-chat"
W "state_hash: $stateHash"
W "type: generate.image"
W "target: $exId"
W "variant: V02"
W "engine: higgsfield"
W "refs: @$exCharShort/V02; @$exShort"
W "params: ar=16:9; count=4"
W "notes: free text for the human"
W "--- prompt ---"
W "Your prompt here. Any length, any punctuation, any number of lines."
W "Nothing needs escaping."
W "--- end prompt ---"
W "=== END SHM-JOB ==="
W '```'
W ""
W "``type`` is one of: ``generate.image``, ``generate.video``, ``register.entity``,"
W "``update.entity``, ``retire.entity``, ``define.shot``."
W ""
W "``target`` is an existing ID (short or full), or ``NEW/KIND/SLUG``. ``job_id`` must be unique;"
W "re-sending the same one with the same content is a safe no-op."
W ""
W "Always include ``project: $Code`` in every block. A block for a different project code is"
W "rejected, so work never lands in the wrong project. ``SHM-JOB`` itself is the fixed block"
W "keyword for every project - do not change it to the project code."
W ""
W "Always echo ``state_hash: $stateHash`` so the CLI can tell you if you were working from a stale"
W "copy of this pack."
W ""
W "## Naming rules you need to know"
W ""
W "- ID shape: ``$Code-KIND-NNN-SLUG``. Short form ``KIND-NNN`` is always acceptable."
W "- Kinds: ``CHR`` character, ``GRP`` group/caste, ``LOC`` location, ``PRP`` prop, ``CRT`` creature,"
W "  ``COS`` costume, ``VEH`` vehicle, ``FX`` effect, ``REF`` reference board."
W "- **Different physical object -> different number. Same object, different look -> same number,"
W "  new variant ``V``. Same look, re-rolled -> same variant, new take ``T``.**"
W "- Slugs are ``UPPER-KEBAB`` and lead with a family word (``STAFF-``, ``GATE-``, ``THRONE-``)."
W "  Two things in a family must be tellable apart from the slug alone."
W "- Shots: ``$Code-EP001-SC014-SH0030``. Shots count in tens so they can be inserted between."
W ""
W "## Next free number per kind"
W ""
W "Use these only to understand the shape of the space. **Do not allocate from them** - propose"
W "``NEW/KIND/SLUG`` instead and let the CLI assign."
W ""
$line = ($nextFree.Keys | ForEach-Object { "$_ $($nextFree[$_])" }) -join '   '
W "``$line``"
W ""
W "---"
W ""
W "## The index"
W ""
if ($entities.Count -eq 0) {
    W "_No entities yet. Propose new ones with ``NEW/KIND/SLUG``._"
    W ""
}

$kindTitles = [ordered]@{
    'CHR' = 'Characters'
    'GRP' = 'Groups and castes'
    'LOC' = 'Locations'
    'PRP' = 'Props'
    'CRT' = 'Creatures'
    'COS' = 'Costumes'
    'VEH' = 'Vehicles'
    'FX'  = 'Effects'
    'REF' = 'Reference boards'
}

foreach ($k in $kindTitles.Keys) {
    $rows = @($entities | Where-Object { $_.kind -ceq $k } | Sort-Object number)
    if ($rows.Count -eq 0) { continue }

    W "### $($kindTitles[$k]) ($k)"
    W ""
    foreach ($e in $rows) {
        $variants = @($manifest | Where-Object { $_.entity_id -ceq $e.id } |
                      Select-Object -ExpandProperty variant -Unique | Sort-Object)

        $bits = @("**$($e.short_id)** ``$($e.id)``")
        W ($bits -join ' ')

        $meta = @("status $($e.status)")
        if ($variants.Count -gt 0) {
            $vtxt = ($variants | ForEach-Object {
                if ($_ -ceq $e.canonical_variant) { "$_ (canonical)" } else { $_ }
            }) -join ', '
            $meta += "variants $vtxt"
        } else {
            $meta += "no assets yet"
        }
        if ($e.family)  { $meta += "family $($e.family)" }
        if ($e.related) { $meta += "related $($e.related)" }
        if ($e.flags)   { $meta += "FLAGS $($e.flags)" }
        W ("  - " + ($meta -join ' | '))
        W ("  - $($e.description)")
        W ""
    }
}

W "---"
W ""
W "## What we've learned"
W ""

# Approved learnings only. Proposed rules are not shipped anywhere - Hamed
# approves them in the review panel first. See .claude/skills/learn/SKILL.md.
$learnPath = $P.Learnings
$approved = @()
if (Test-Path -LiteralPath $learnPath) {
    $byId = [ordered]@{}
    # -Encoding UTF8: the JSONL is BOM-less UTF-8 and PS 5.1 would otherwise read it
    # as ANSI, mangling any Farsi in a rule or its evidence.
    foreach ($line in (Get-Content -LiteralPath $learnPath -Encoding UTF8)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $obj = $line | ConvertFrom-Json } catch { continue }
        $byId[$obj.id] = $obj    # last write wins
    }
    $approved = @($byId.Values | Where-Object { $_.status -eq 'approved' })
}

if ($approved.Count -eq 0) {
    W "_Nothing approved yet. Rules appear here once Hamed approves them in the review panel._"
} else {
    W "Rules earned from reviewed generations. **Apply the ones that match what you are writing.**"
    W ""
    foreach ($l in $approved) {
        $scope = if ($l.scope.entity) { $l.scope.entity }
                 elseif ($l.scope.family) { "family $($l.scope.family)" }
                 elseif ($l.scope.kind) { "all $($l.scope.kind)" }
                 else { 'all prompts' }
        W ("- **[{0}]** {1}" -f $scope, $l.rule)
    }
}
W ""
W "---"
W ""
W "## Open questions"
W ""
if (Test-Path -LiteralPath $P.Questions) {
    $q = Get-Content -LiteralPath $P.Questions -Raw -Encoding UTF8
    # strip the file's own title and preamble, keep from the first question heading on
    $idx = $q.IndexOf('### Q')
    if ($idx -ge 0) { W ($q.Substring($idx).TrimEnd()) } else { W $q.TrimEnd() }
} else {
    W "_None recorded._"
}

W ""
W "---"
W ""
W "_End of context pack. ``state_hash: $stateHash``_"

$outDir = Split-Path $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutFile, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Output "Wrote $OutFile"
Write-Output "  project    : $Name ($Code)"
Write-Output "  entities   : $($entities.Count)"
Write-Output "  assets     : $($manifest.Count)"
Write-Output "  state_hash : $stateHash"
