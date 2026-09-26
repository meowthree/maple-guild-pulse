#!/bin/bash
# Weekly collector script — run via cron/launchd or manually.
# Collects scores, commits, and pushes so cPanel auto-deploys.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$PROJECT_DIR/scripts/collector.log"

cd "$PROJECT_DIR"

echo "=== $(date) ===" >> "$LOG"

# Pull latest first
git pull --ff-only >> "$LOG" 2>&1 || true

# Run the collector
echo "Running collector..." >> "$LOG"
node scripts/collector.mjs >> "$LOG" 2>&1

# Check if history.json actually changed
if git diff --quiet data/history.json; then
  echo "No data change, skipping commit." >> "$LOG"
  exit 0
fi

# Commit and push
git add data/history.json
git commit -m "weekly guild snapshot $(date -u +%F)" >> "$LOG" 2>&1
git push >> "$LOG" 2>&1

echo "Done — pushed to GitHub." >> "$LOG"
