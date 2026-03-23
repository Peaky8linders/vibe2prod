#!/usr/bin/env bash
# =============================================================================
# run-fix.sh — Single atomic fix cycle (Karpathy gate pattern)
#
# Usage: bash run-fix.sh <finding-id> <target-dir>
#
# Flow: snapshot → fix → re-scan → gate → commit/revert
# =============================================================================

set -euo pipefail

FINDING_ID="${1:?Usage: run-fix.sh <finding-id> <target-dir>}"
TARGET_DIR="${2:-.}"
GUARDIAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FINDINGS_FILE="$GUARDIAN_DIR/findings/findings.jsonl"
LEDGER_FILE="$GUARDIAN_DIR/findings/ledger.tsv"
PROGRESS_FILE="$GUARDIAN_DIR/loop/progress.txt"

echo "🔧 Fix attempt: $FINDING_ID"
echo "   Target: $TARGET_DIR"

# 1. Snapshot baseline
BASELINE_COMMIT=$(git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || echo "none")
BASELINE_SCORE=$(npx tsx "$GUARDIAN_DIR/cli.ts" score --target "$TARGET_DIR" --json 2>/dev/null | grep -o '"composite":[0-9.]*' | cut -d: -f2 || echo "0")
echo "   Baseline: commit=$BASELINE_COMMIT score=$BASELINE_SCORE"

# 2. Run the fix (this is where the LLM agent would generate the patch)
# For now, this is a placeholder that the autofix loop fills
echo "   Applying fix..."

# 3. Re-scan to verify the finding is resolved
echo "   Re-scanning..."
RESCAN=$(npx tsx "$GUARDIAN_DIR/cli.ts" scan --target "$TARGET_DIR" --json 2>/dev/null || echo "[]")
STILL_OPEN=$(echo "$RESCAN" | grep -c "$FINDING_ID" || true)

if [ "$STILL_OPEN" -gt 0 ]; then
  echo "   ❌ Finding still open after fix — reverting"
  git -C "$TARGET_DIR" checkout -- . 2>/dev/null || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)	$FINDING_ID	reverted	finding still open" >> "$LEDGER_FILE"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] REVERTED $FINDING_ID: finding still open after fix" >> "$PROGRESS_FILE"
  exit 1
fi

# 4. Gate checks
echo "   Running gates..."
GATE_PASS=true

# Gate: tests pass (if test command exists)
if [ -f "$TARGET_DIR/package.json" ] && grep -q '"test"' "$TARGET_DIR/package.json" 2>/dev/null; then
  if ! (cd "$TARGET_DIR" && npm test > /dev/null 2>&1); then
    echo "   ❌ Tests failed"
    GATE_PASS=false
  fi
fi

# Gate: TypeScript compiles (if tsconfig exists)
if [ -f "$TARGET_DIR/tsconfig.json" ]; then
  if ! (cd "$TARGET_DIR" && npx tsc --noEmit > /dev/null 2>&1); then
    echo "   ❌ TypeScript compilation failed"
    GATE_PASS=false
  fi
fi

# Gate: no new secrets
SECRET_COUNT=$(npx tsx "$GUARDIAN_DIR/cli.ts" scan --target "$TARGET_DIR" --scanner secrets --json 2>/dev/null | grep -c '"severity":"P0"' || true)
if [ "$SECRET_COUNT" -gt 0 ]; then
  echo "   ❌ New secrets detected"
  GATE_PASS=false
fi

# Gate: score didn't regress
NEW_SCORE=$(npx tsx "$GUARDIAN_DIR/cli.ts" score --target "$TARGET_DIR" --json 2>/dev/null | grep -o '"composite":[0-9.]*' | cut -d: -f2 || echo "0")
if [ "$(echo "$NEW_SCORE < $BASELINE_SCORE" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
  echo "   ❌ Score regressed: $BASELINE_SCORE → $NEW_SCORE"
  GATE_PASS=false
fi

# 5. Commit or revert
if [ "$GATE_PASS" = true ]; then
  echo "   ✅ All gates passed — committing"
  git -C "$TARGET_DIR" add -A 2>/dev/null || true
  git -C "$TARGET_DIR" commit -m "fix(guardian): $FINDING_ID — auto-remediated by Guardian loop" 2>/dev/null || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)	$FINDING_ID	committed	score=$NEW_SCORE" >> "$LEDGER_FILE"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] COMMITTED $FINDING_ID: score $BASELINE_SCORE → $NEW_SCORE" >> "$PROGRESS_FILE"
  exit 0
else
  echo "   ❌ Gates failed — reverting"
  git -C "$TARGET_DIR" checkout -- . 2>/dev/null || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)	$FINDING_ID	reverted	gates failed" >> "$LEDGER_FILE"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] REVERTED $FINDING_ID: gates failed" >> "$PROGRESS_FILE"
  exit 1
fi
