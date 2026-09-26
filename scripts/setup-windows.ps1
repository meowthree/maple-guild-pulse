#Requires -Version 5.1
<#
  One-time setup for the weekly collector on Windows 11.

  What this script does:
    1. Checks prerequisites (Node.js, Git, GitHub auth)
    2. Installs npm dependencies
    3. Installs Playwright Chromium
    4. Configures git user for automated commits
    5. Registers a Windows Task Scheduler job (Tuesday 21:00 SGT)

  Run as Administrator (needed for Task Scheduler):
    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
#>

$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "`n=== Maple Guild Pulse — Windows Setup ===" -ForegroundColor Cyan

# --- 1. Check Node.js ---
Write-Host "`n[1/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = (node --version 2>&1).ToString().Trim()
    $major = [int]($nodeVersion -replace '^v(\d+).*','$1')
    if ($major -lt 18) {
        Write-Host "  Node.js $nodeVersion found but v18+ is required." -ForegroundColor Red
        Write-Host "  Install from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# --- 2. Check Git ---
Write-Host "`n[2/5] Checking Git..." -ForegroundColor Yellow
try {
    $gitVersion = (git --version 2>&1).ToString().Trim()
    Write-Host "  OK: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "  Git not found. Install from https://git-scm.com/" -ForegroundColor Red
    exit 1
}

# Check GitHub auth
Write-Host "  Checking GitHub push access..." -ForegroundColor Yellow
$remoteUrl = (git -C $ProjectDir remote get-url origin 2>&1).ToString().Trim()
Write-Host "  Remote: $remoteUrl"

# Verify we can reach the remote
try {
    git -C $ProjectDir ls-remote --exit-code origin HEAD 2>&1 | Out-Null
    Write-Host "  OK: GitHub access confirmed" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Cannot reach GitHub remote." -ForegroundColor Red
    Write-Host "  Set up authentication:" -ForegroundColor Red
    Write-Host "    Option A: gh auth login" -ForegroundColor Red
    Write-Host "    Option B: git credential-manager configure" -ForegroundColor Red
    Write-Host "  Then re-run this setup." -ForegroundColor Red
    exit 1
}

# --- 3. Install dependencies ---
Write-Host "`n[3/5] Installing npm dependencies..." -ForegroundColor Yellow
Set-Location $ProjectDir
npm install 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "  Installing Playwright Chromium..." -ForegroundColor Yellow
npx playwright install chromium 2>&1 | ForEach-Object { Write-Host "  $_" }
Write-Host "  OK: Dependencies installed" -ForegroundColor Green

# --- 4. Configure git user for automated commits ---
Write-Host "`n[4/5] Configuring git user (repo-local)..." -ForegroundColor Yellow
$existingName = git -C $ProjectDir config --local user.name 2>&1
if ($LASTEXITCODE -ne 0) {
    git -C $ProjectDir config user.name 'maple-guild-bot'
    git -C $ProjectDir config user.email 'bot@maple-guild-pulse.local'
    Write-Host "  Set user.name=maple-guild-bot" -ForegroundColor Green
} else {
    Write-Host "  Already set: $existingName" -ForegroundColor Green
}

# --- 5. Register Task Scheduler job ---
Write-Host "`n[5/5] Registering scheduled task..." -ForegroundColor Yellow

$TaskName = 'MapleGuildPulse-Weekly'
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existing) {
    Write-Host "  Task '$TaskName' already exists. Replacing..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$pwshPath = (Get-Command powershell.exe).Source
$scriptPath = Join-Path $ProjectDir 'scripts\run-weekly.ps1'

$action = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`"" `
    -WorkingDirectory $ProjectDir

# Tuesday 21:00 local time (SGT if system timezone is Singapore)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday -At '21:00'

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'Collects weekly guild scores from mapleidle.gg and pushes to GitHub' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "  OK: Scheduled task '$TaskName' registered" -ForegroundColor Green
Write-Host "  Schedule: Every Tuesday at 21:00 (system local time)" -ForegroundColor Green

# --- Done ---
Write-Host "`n=== Setup complete ===" -ForegroundColor Cyan
Write-Host @"

Next steps:
  1. Verify your system timezone is Asia/Singapore (SGT):
       Get-TimeZone
     If not, either adjust the task time or set the timezone.

  2. Test the collector manually:
       node scripts/collector.mjs --dry-run

  3. Test the full pipeline (will commit + push if data changed):
       powershell -ExecutionPolicy Bypass -File scripts\run-weekly.ps1

  4. View the scheduled task:
       Get-ScheduledTask -TaskName 'MapleGuildPulse-Weekly' | Format-List

  5. Run the task immediately (to test):
       Start-ScheduledTask -TaskName 'MapleGuildPulse-Weekly'

  6. Check logs after a run:
       Get-Content scripts\collector.log -Tail 30
"@
