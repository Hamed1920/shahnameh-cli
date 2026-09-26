<#
.SYNOPSIS
  Read-only health check of the panel and its workers on this machine.

.DESCRIPTION
  Written for the "panel renders but nothing is clickable" report of 2026-09-26: the
  page's scripts never start, so Submit and "Add these" stay disabled. It collects
  what differs between machines, so the cause can be read from one file:

    Node and Higgsfield CLI versions, the CLI's workspace, the repo state, the
    panel's .env.local keys (never values of secrets: there are none there), the age
    of the .next build cache, the model catalogue, who is listening on ports
    3000-3005 and whether localhost:<Port> is this panel with scripts that load,
    each project's worker log, locks and stop flags, and the machine-wide locks.

  Changes nothing and spends nothing. Run it with the panel running the usual way.

.PARAMETER Port
  The port the panel is opened on. Default 3000.

.OUTPUTS
  Writes the report to %TEMP%\fmfd-panel-check.txt and prints that path.
#>
[CmdletBinding()]
param(
    [int]$Port = 3000
)

$Repo = Split-Path -Parent $PSScriptRoot
$Panel = Join-Path $Repo '10_PANEL'
$out = Join-Path $env:TEMP 'fmfd-panel-check.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Say($t) { $lines.Add([string]$t) }
function Section($t) { Say ''; Say ('=== ' + $t) }
function Try-Run($label, [scriptblock]$b) {
    try { $r = & $b 2>&1 | Out-String -Width 300; Say ($label + ':'); Say $r.TrimEnd() }
    catch { Say ($label + ': ERROR ' + $_.Exception.Message) }
}
function Get-Projects { Get-ChildItem $Repo -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'project.json') } }

Section 'machine'
Say ('date: ' + (Get-Date -Format o))
Try-Run 'node -v' { node -v }
Try-Run 'node path' { (Get-Command node).Source }
Try-Run 'higgsfield --version' { higgsfield --version }
Try-Run 'higgsfield workspace status' { higgsfield workspace status }

Section 'repo'
Say ('repo: ' + $Repo)
Try-Run 'git log -3' { git -C $Repo log -3 --format='%h %ad %an %s' --date=iso }
Try-Run 'git status' { git -C $Repo status --short }
Try-Run 'ahead/behind origin/main (ahead, behind)' { git -C $Repo fetch -q; git -C $Repo rev-list --left-right --count HEAD...origin/main }
Try-Run 'projects' { Get-Projects | ForEach-Object Name }
Try-Run '10_PANEL/.env.local keys' {
    $f = Join-Path $Panel '.env.local'
    if (Test-Path $f) { Get-Content $f | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object { ($_ -split '=')[0] } } else { 'none' }
}
Try-Run 'installed next' { (Get-Content (Join-Path $Panel 'node_modules\next\package.json') -Raw | ConvertFrom-Json).version }
Try-Run '.next build cache' {
    $n = Join-Path $Panel '.next'
    if (Test-Path $n) {
        $last = git -C $Repo log -1 --format=%cI
        'last written ' + (Get-Item $n).LastWriteTime.ToString('o') + '; last commit ' + $last
    } else { 'none' }
}

Section 'model catalogue'
Try-Run 'catalogue' {
    $c = Get-Content (Join-Path $Panel 'worker\MODEL_CATALOG.json') -Raw | ConvertFrom-Json
    'fetchedAt: ' + $c.fetchedAt
    $m = $c.models.PSObject.Properties | ForEach-Object Value
    'models: ' + @($m).Count + ', usable: ' + @($m | Where-Object usable).Count
    'entries without params: ' + ((@($m | Where-Object { $null -eq $_.params }) | ForEach-Object job_type) -join ' ')
    'params without a type: ' + ((@($m | Where-Object { @($_.params | Where-Object { -not $_.type }).Count -gt 0 }) | ForEach-Object job_type) -join ' ')
    foreach ($k in 'seedance_2_5', 'nano_banana_pro') { $e = $c.models.$k; "$k -> usable=$($e.usable) why=$($e.why)" }
}
Try-Run 'catalogue changed since the last commit' { git -C $Repo diff --stat -- 10_PANEL/worker/MODEL_CATALOG.json }

Section 'who is listening on 3000-3005'
Try-Run 'ports' {
    Get-NetTCPConnection -State Listen -LocalPort 3000, 3001, 3002, 3003, 3004, 3005 -ErrorAction SilentlyContinue | ForEach-Object {
        $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)
        '{0}  pid {1}  {2}' -f $_.LocalPort, $_.OwningProcess, $p.CommandLine
    }
}
Try-Run 'node processes' { Get-CimInstance Win32_Process -Filter "name='node.exe'" | ForEach-Object { '{0}  {1}' -f $_.ProcessId, $_.CommandLine } }

Section ('what http://localhost:' + $Port + ' serves')
Try-Run 'GET /' {
    $r = Invoke-WebRequest ('http://localhost:' + $Port + '/') -UseBasicParsing -TimeoutSec 60
    'status ' + $r.StatusCode + '  title: ' + ([regex]::Match($r.Content, '<title>(.*?)</title>').Groups[1].Value)
    'is this panel (project picker text): ' + ($r.Content -match 'Film Making for Dummies')
}
Try-Run 'prompts page and its scripts' {
    $slug = (Get-Projects | Select-Object -First 1).Name
    $r = Invoke-WebRequest ('http://localhost:' + $Port + '/' + $slug + '/prompts') -UseBasicParsing -TimeoutSec 120
    $scripts = [regex]::Matches($r.Content, 'src="(/_next/[^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    'page status ' + $r.StatusCode + ', scripts ' + @($scripts).Count
    foreach ($s in $scripts) {
        try { $x = Invoke-WebRequest ('http://localhost:' + $Port + $s) -UseBasicParsing -TimeoutSec 60; '  ' + $x.StatusCode + ' ' + $x.RawContentLength + ' ' + $s }
        catch { '  FAIL ' + $s + ' ' + $_.Exception.Message }
    }
}

Section 'workers'
Try-Run 'workers paused from the Queue page (.workers-paused)' { Test-Path (Join-Path $Repo '.workers-paused') }
Try-Run '.generate.lock' { $g = Join-Path $Repo '.generate.lock'; if (Test-Path $g) { Get-Content $g } else { 'none' } }
foreach ($pj in Get-Projects) {
    $q = Join-Path $pj.FullName '00_PROJECT\queue'
    Say ''
    Say ('--- ' + $pj.Name)
    foreach ($f in 'worker.lock', 'worker.stop') {
        $p = Join-Path $q $f
        if (Test-Path $p) { Say ($f + ': ' + ((Get-Content $p) -join ' | ')) } else { Say ($f + ': none') }
    }
    $log = Join-Path $q 'worker.stdout.log'
    if (Test-Path $log) { Get-Content $log -Tail 25 | ForEach-Object { Say ('  ' + $_) } } else { Say '  (no worker.stdout.log)' }
    $jr = Join-Path $pj.FullName '00_PROJECT\review\JOB_REQUESTS.jsonl'
    if (Test-Path $jr) { Say ('JOB_REQUESTS lines: ' + @(Get-Content $jr).Count) }
}

[System.IO.File]::WriteAllText($out, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('Wrote ' + $out)
