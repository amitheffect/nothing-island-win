# Creates the labels, milestones and issues in .github/issue-drafts on GitHub.
# Needs the GitHub CLI, signed in with an account that can write to the repo:
#   winget install GitHub.cli ; gh auth login
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\create-issues.ps1
# Safe to run again: issues whose title already exists are skipped.
param(
  [string]$Repo = 'amitheffect/nothing-island-win',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) not found. Install it: winget install GitHub.cli' }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Not signed in. Run: gh auth login' }

$drafts = Join-Path $PSScriptRoot '..\.github\issue-drafts'
function Run([string[]]$a) {
  if ($DryRun) { Write-Host "gh $($a -join ' ')"; return '' }
  $out = & gh @a 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh $($a[0..1] -join ' ') failed: $out" }
  return $out
}

# ---- labels
$labels = @{
  'bug' = 'd73a4a'; 'enhancement' = 'a2eeef'; 'security' = 'b60205'; 'documentation' = '0075ca'
  'question' = 'd876e3'; 'good first issue' = '7057ff'; 'priority: high' = 'e11d21'
  'area: engine' = '1d1d1f'; 'area: ui' = 'f2f2f2'; 'area: packaging' = 'c5def5'
  'platform: macos' = 'bfd4f2'; 'platform: linux' = 'fef2c0'
}
foreach ($l in $labels.Keys) { if (-not $DryRun) { gh label create $l --color $labels[$l] --force -R $Repo | Out-Null } }

# ---- milestones
$existingMs = @()
if (-not $DryRun) { $existingMs = (gh api "repos/$Repo/milestones?state=all&per_page=100" | ConvertFrom-Json).title }
foreach ($m in @('v1.0', 'v1.1', 'v1.2', 'Backlog')) {
  if ($existingMs -notcontains $m) { Run @('api', "repos/$Repo/milestones", '-f', "title=$m") | Out-Null }
}

# ---- existing titles (so re-runs don't duplicate)
$existing = @{}
if (-not $DryRun) {
  foreach ($i in (gh issue list -R $Repo --state all --limit 500 --json number,title | ConvertFrom-Json)) { $existing[$i.title] = $i.number }
}

# ---- parse drafts
$items = foreach ($f in Get-ChildItem $drafts -Filter '*.md' | Sort-Object Name) {
  $raw = Get-Content $f.FullName -Raw -Encoding UTF8
  $split = $raw -split "(?m)^---\r?\n", 2
  $meta = @{}
  foreach ($line in ($split[0] -split "\r?\n")) { if ($line -match '^(\w+):\s*(.*)$') { $meta[$Matches[1]] = $Matches[2].Trim() } }
  [pscustomobject]@{ Key = $f.Name.Substring(0, 2); Title = $meta.title; Labels = $meta.labels; Milestone = $meta.milestone
                     State = $meta.state; Fixed = $meta.fixed; Body = $split[1]; Number = $null; New = $false }
}

# ---- pass 1: create
foreach ($it in $items) {
  if ($existing.ContainsKey($it.Title)) { $it.Number = $existing[$it.Title]; Write-Host "exists  #$($it.Number)  $($it.Title)"; continue }
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, $it.Body, (New-Object Text.UTF8Encoding $false))
  $ghArgs = @('issue', 'create', '-R', $Repo, '--title', $it.Title, '--body-file', $tmp.FullName, '--milestone', $it.Milestone)
  foreach ($l in ($it.Labels -split ',')) { if ($l.Trim()) { $ghArgs += @('--label', $l.Trim()) } }
  $url = (Run $ghArgs) -join "`n"
  Remove-Item $tmp
  if ($url -match '/issues/(\d+)') { $it.Number = [int]$Matches[1] }
  $it.New = $true
  Write-Host "created #$($it.Number)  $($it.Title)"
}

# ---- pass 2: real issue numbers in cross-references like #[07]
foreach ($it in $items | Where-Object { $_.New -and $_.Body -match '#\[\d\d\]' }) {
  $body = [regex]::Replace($it.Body, '#\[(\d\d)\]', { param($m)
    $t = $items | Where-Object { $_.Key -eq $m.Groups[1].Value } | Select-Object -First 1
    if ($t -and $t.Number) { "#$($t.Number)" } else { $m.Value } })
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, $body, (New-Object Text.UTF8Encoding $false))
  Run @('issue', 'edit', "$($it.Number)", '-R', $Repo, '--body-file', $tmp.FullName) | Out-Null
  Remove-Item $tmp
}

# ---- pass 3: close the ones that are already fixed
foreach ($it in $items | Where-Object { $_.New -and $_.State -eq 'closed' }) {
  Run @('issue', 'close', "$($it.Number)", '-R', $Repo, '--reason', 'completed', '--comment', "Fixed in $($it.Fixed).") | Out-Null
  Write-Host "closed  #$($it.Number)  (fixed in $($it.Fixed))"
}
Write-Host "Done. https://github.com/$Repo/issues"
