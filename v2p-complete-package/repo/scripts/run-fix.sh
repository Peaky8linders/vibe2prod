#!/bin/bash
set -euo pipefail

# =============================================================================
# run-fix.sh — Single fix attempt
#
# The agent applies a fix to target/, then this script runs the full eval
# pipeline and either commits or reverts.
#
# Usage: bash scripts/run-fix.sh [--defect-id EH-003]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Parse args
DEFECT_ID="${1:---auto}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[fix]${NC} Starting fix attempt..."

# 1. Snapshot current state
BASELINE=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
BASELINE_SCORE=$(npx tsx scripts/readiness-score.ts 2>/dev/null || echo "0")

echo -e "${YELLOW}[fix]${NC} Baseline: commit=$BASELINE score=$BASELINE_SCORE"

# 2. Verify eval harness integrity
if [ -f ".eval-integrity" ]; then
  EXPECTED=$(cat .eval-integrity)
  ACTUAL=$(find evals/ -type f \( -name '*.ts' -o -name '*.json' \) | sort | xargs sha256sum | sha256sum)
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo -e "${RED}[fix] INTEGRITY VIOLATION — eval files have been modified.${NC}"
    echo "  Expected: $EXPECTED"
    echo "  Actual:   $ACTUAL"
    exit 1
  fi
fi

# 3. Run full eval harness
echo -e "${YELLOW}[fix]${NC} Running eval harness..."
EVAL=$(npx tsx evals/harness.ts 2>/dev/null) || {
  echo -e "${RED}[fix]${NC} Eval harness crashed"
  git checkout -- target/ 2>/dev/null || true
  echo "{\"status\":\"crash\",\"reason\":\"eval_harness_error\",\"timestamp\":\"$(date -u +%FT%TZ)\"}" >> logs/fixes.jsonl
  exit 1
}

# 4. Parse gate results
L1_PASS=$(echo "$EVAL" | jq -r '.l1.passed')
L2_PASS=$(echo "$EVAL" | jq -r '.l2.passed')
BEHAVIOR_PRESERVED=$(echo "$EVAL" | jq -r '.behavioral.preserved')
SECURITY_PASS=$(echo "$EVAL" | jq -r '.security.passed')
NEW_SCORE=$(echo "$EVAL" | jq -r '.readiness_score')

echo -e "${YELLOW}[fix]${NC} Results: L1=$L1_PASS L2=$L2_PASS behavior=$BEHAVIOR_PRESERVED security=$SECURITY_PASS score=$NEW_SCORE"

# 5. Composite gate: ALL must pass + score must not regress
if [ "$L1_PASS" = "true" ] && \
   [ "$L2_PASS" = "true" ] && \
   [ "$BEHAVIOR_PRESERVED" = "true" ] && \
   [ "$SECURITY_PASS" = "true" ] && \
   [ "$(echo "$NEW_SCORE >= $BASELINE_SCORE" | bc -l 2>/dev/null || echo 1)" = "1" ]; then

  # Commit the fix
  git add target/
  git commit -m "fix: readiness $BASELINE_SCORE → $NEW_SCORE" --no-verify

  # Update baseline
  echo "$NEW_SCORE" > .baseline-score

  # Log success
  DIFF=$(git diff HEAD~1 --stat target/ 2>/dev/null | tail -1 || echo "unknown")
  echo "{\"status\":\"committed\",\"defect_id\":\"$DEFECT_ID\",\"baseline\":$BASELINE_SCORE,\"new_score\":$NEW_SCORE,\"delta\":$(echo "$NEW_SCORE - $BASELINE_SCORE" | bc -l 2>/dev/null || echo 0),\"diff_stat\":\"$DIFF\",\"timestamp\":\"$(date -u +%FT%TZ)\"}" >> logs/fixes.jsonl

  echo -e "${GREEN}[fix] COMMITTED${NC} — readiness $BASELINE_SCORE → $NEW_SCORE"
else
  # Revert
  git checkout -- target/ 2>/dev/null || true

  # Log failure with full eval output
  echo "$EVAL" | jq -c "{status:\"reverted\",defect_id:\"$DEFECT_ID\",reason:{l1:(.l1.passed),l2:(.l2.passed),behavior:(.behavioral.preserved),security:(.security.passed),score:(.readiness_score)},timestamp:\"$(date -u +%FT%TZ)\"}" >> logs/fixes.jsonl

  echo -e "${RED}[fix] REVERTED${NC} — gates failed"

  # Print failure details
  if [ "$L1_PASS" != "true" ]; then
    echo -e "  ${RED}L1 failures:${NC}"
    echo "$EVAL" | jq -r '.l1.failures[]' 2>/dev/null | head -5 | sed 's/^/    /'
  fi
  if [ "$SECURITY_PASS" != "true" ]; then
    echo -e "  ${RED}Security findings:${NC}"
    echo "$EVAL" | jq -r '.security.findings[]' 2>/dev/null | head -5 | sed 's/^/    /'
  fi
  if [ "$BEHAVIOR_PRESERVED" != "true" ]; then
    echo -e "  ${RED}Behavioral regressions:${NC}"
    echo "$EVAL" | jq -r '.behavioral.regressions[]' 2>/dev/null | head -5 | sed 's/^/    /'
  fi

  exit 1
fi
