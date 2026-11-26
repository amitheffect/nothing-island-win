# Creates the labels, milestones and issues in .github/issue-drafts on GitHub.
# Needs the GitHub CLI, signed in with an account that can write to the repo:
#   winget install GitHub.cli ; gh auth login
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\create-issues.ps1
# Safe to run again: issues whose title already exists are skipped.
#
# Titles and bodies are sent to GitHub as JSON files (gh api --input), never as command-line
# arguments, so quotes and special characters can't break anything in any PowerShell version.
param(
  [string]$Repo = 'amitheffect/nothing-island-win',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) not found. Install it: winget install GitHub.cli' }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Not signed in. Run: gh auth login' }

$drafts = Join-Path $PSScriptRoot '..\.github\issue-drafts'
$utf8 = New-Object Text.UTF8Encoding $false

# POST/PATCH a JSON payload to the GitHub API and return the parsed response
function Api([string]$method, [string]$path, $payload) {
  $json = $payload | ConvertTo-Json -Depth 5
  if ($DryRun) { Write-Host "$method $path"; Write-Host $json; return $null }
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $json, $utf8)
    $ErrorActionPreference = 'Continue'   # gh prints progress to stderr; 5.1 would treat that as a failure
    $out = & gh api -X $method "repos/$Repo/$path" --input $tmp 2>&1
    if ($LASTEXITCODE -ne 0) { throw "gh api $method $path failed: $out" }
    return ($out -join "`n") | ConvertFrom-Json
  } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}
function ApiGet([string]$path) {
  $ErrorActionPreference = 'Continue'
  $out = & gh api "repos/$Repo/$path" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh api GET $path failed: $out" }
  return ($out -join "`n") | ConvertFrom-Json
}

# ---- labels (create or update)
$labels = [ordered]@{
  'bug' = 'd73a4a'; 'enhancement' = 'a2eeef'; 'security' = 'b60205'; 'documentation' = '0075ca'
  'question' = 'd876e3'; 'good first issue' = '7057ff'; 'priority: high' = 'e11d21'
  'area: engine' = '1d1d1f'; 'area: ui' = 'f2f2f2'; 'area: packaging' = 'c5def5'
  'platform: macos' = 'bfd4f2'; 'platform: linux' = 'fef2c0'
}
$haveLabels = @()
if (-not $DryRun) { $haveLabels = @(ApiGet 'labels?per_page=100' | ForEach-Object { $_.name }) }
foreach ($l in $labels.Keys) {
  if ($haveLabels -notcontains $l) { Api 'POST' 'labels' @{ name = $l; color = $labels[$l] } | Out-Null }
}

# ---- milestones
$ms = @{}
if (-not $DryRun) { foreach ($m in (ApiGet 'milestones?state=all&per_page=100')) { $ms[$m.title] = $m.number } }
foreach ($m in @('v1.0', 'v1.1', 'v1.2', 'Backlog')) {
  if (-not $ms.ContainsKey($m)) { $r = Api 'POST' 'milestones' @{ title = $m }; if ($r) { $ms[$m] = $r.number } }
}

# ---- existing issues (so re-runs don't duplicate)
$existing = @{}
if (-not $DryRun) {
  foreach ($i in (ApiGet 'issues?state=all&per_page=100')) { if (-not $i.pull_request) { $existing[$i.title] = $i.number } }
}

# ---- parse drafts
$items = foreach ($f in Get-ChildItem $drafts -Filter '*.md' | Sort-Object Name) {
  $raw = [IO.File]::ReadAllText($f.FullName, $utf8)
  $split = $raw -split "(?m)^---\r?\n", 2
  $meta = @{}
  foreach ($line in ($split[0] -split "\r?\n")) { if ($line -match '^(\w+):\s*(.*)$') { $meta[$Matches[1]] = $Matches[2].Trim() } }
  [pscustomobject]@{
    Key = $f.Name.Substring(0, 2); Title = $meta.title; Milestone = $meta.milestone; State = $meta.state; Fixed = $meta.fixed
    Labels = @($meta.labels -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    Body = $split[1]; Number = $null; New = $false
  }
}

# ---- pass 1: create
foreach ($it in $items) {
  if ($existing.ContainsKey($it.Title)) { $it.Number = $existing[$it.Title]; Write-Host "exists  #$($it.Number)  $($it.Title)"; continue }
  $payload = @{ title = $it.Title; body = $it.Body; labels = $it.Labels }
  if ($ms.ContainsKey($it.Milestone)) { $payload.milestone = $ms[$it.Milestone] }
  $r = Api 'POST' 'issues' $payload
  if ($r) { $it.Number = $r.number }
  $it.New = $true
  Write-Host "created #$($it.Number)  $($it.Title)"
}

# ---- pass 2: real issue numbers in cross-references like #[07]
foreach ($it in $items | Where-Object { $_.New -and $_.Number -and $_.Body -match '#\[\d\d\]' }) {
  $body = [regex]::Replace($it.Body, '#\[(\d\d)\]', {
    param($m)
    $t = $items | Where-Object { $_.Key -eq $m.Groups[1].Value } | Select-Object -First 1
    if ($t -and $t.Number) { "#$($t.Number)" } else { $m.Value }
  })
  Api 'PATCH' "issues/$($it.Number)" @{ body = $body } | Out-Null
}

# ---- pass 3: close the ones that are already fixed
foreach ($it in $items | Where-Object { $_.New -and $_.Number -and $_.State -eq 'closed' }) {
  Api 'POST' "issues/$($it.Number)/comments" @{ body = "Fixed in $($it.Fixed)." } | Out-Null
  Api 'PATCH' "issues/$($it.Number)" @{ state = 'closed'; state_reason = 'completed' } | Out-Null
  Write-Host "closed  #$($it.Number)  (fixed in $($it.Fixed))"
}
Write-Host "Done. https://github.com/$Repo/issues"
