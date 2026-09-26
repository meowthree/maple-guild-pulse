#Requires -Version 5.1
<#
  Weekly collector — runs the Playwright-based collector, commits, and pushes.
  Intended to be triggered by Windows Task Scheduler.

  Usage (manual):
    powershell -ExecutionPolicy Bypass -File scripts\run-weekly.ps1

  Exit codes:
    0  Success (snapshot collected and pushed, or no data change)
    1  Collector failed
    2  Git push failed
#>

$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir
$LogFile    = Join-Path $ScriptDir 'collector.log'

Set-Location $ProjectDir

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$ts  $msg" | Tee-Object -FilePath $LogFile -Append
}

Log "=== Weekly collector started ==="

# --- Pull latest ---
try {
    $pullOutput = git pull --ff-only 2>&1
    Log "git pull: $pullOutput"
} catch {
    Log "git pull failed (non-fatal): $_"
}

# --- Run the collector ---
Log "Running collector..."
try {
    $collectOutput = & node scripts/collector.mjs 2>&1
    $collectOutput | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: Collector exited with code $LASTEXITCODE"
        exit 1
    }
} catch {
    Log "ERROR: Collector threw exception: $_"
    exit 1
}

# --- Check for changes ---
$diff = git diff --quiet data/history.json 2>&1
if ($LASTEXITCODE -eq 0) {
    Log "No data change, skipping commit."
    exit 0
}

# --- Commit and push ---
Log "Committing snapshot..."
git add data/history.json
$dateStamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
git commit -m "weekly guild snapshot $dateStamp"

Log "Pushing to GitHub..."
try {
    git push 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: git push failed with code $LASTEXITCODE"
        exit 2
    }
} catch {
    Log "ERROR: git push threw exception: $_"
    exit 2
}

Log "Done — pushed to GitHub."
