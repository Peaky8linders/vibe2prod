#!/usr/bin/env bash
# =============================================================================
# SessionStart hook — Load compliance context
#
# Fires at the start of each Claude Code session.
# Injects a 1-line compliance status summary.
# =============================================================================

GUARDIAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FINDINGS_FILE="$GUARDIAN_DIR/findings/findings.jsonl"
SCORE_FILE="$GUARDIAN_DIR/findings/compliance-score.json"

# Count open findings by severity
P0=0; P1=0; P2=0; P3=0
if [ -f "$FINDINGS_FILE" ]; then
  P0=$(grep -c '"severity":"P0".*"status":"open"' "$FINDINGS_FILE" 2>/dev/null || echo 0)
  P1=$(grep -c '"severity":"P1".*"status":"open"' "$FINDINGS_FILE" 2>/dev/null || echo 0)
  P2=$(grep -c '"severity":"P2".*"status":"open"' "$FINDINGS_FILE" 2>/dev/null || echo 0)
  P3=$(grep -c '"severity":"P3".*"status":"open"' "$FINDINGS_FILE" 2>/dev/null || echo 0)
fi

TOTAL=$((P0 + P1 + P2 + P3))

# Get compliance score
SCORE="--"
if [ -f "$SCORE_FILE" ]; then
  SCORE=$(grep -o '"composite":[0-9.]*' "$SCORE_FILE" | cut -d: -f2 || echo "--")
fi

# Get last scan time
LAST_SCAN="never"
if [ -f "$FINDINGS_FILE" ]; then
  LAST_SCAN=$(tail -1 "$FINDINGS_FILE" 2>/dev/null | grep -o '"ts":"[^"]*"' | cut -d'"' -f4 || echo "never")
fi

if [ "$TOTAL" -gt 0 ]; then
  echo "🛡️ Guardian: ${TOTAL} open findings (${P0} P0, ${P1} P1, ${P2} P2, ${P3} P3) | Score: ${SCORE}% | Last scan: ${LAST_SCAN}"
else
  echo "🛡️ Guardian: No open findings | Score: ${SCORE}% | Last scan: ${LAST_SCAN}"
fi
