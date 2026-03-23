#!/bin/bash
set -euo pipefail

# =============================================================================
# run-overnight.sh — Autonomous overnight hardening loop
#
# Runs the agent in a loop for a fixed time budget, attempting to fix
# defects one at a time from the taxonomy.
#
# Usage:
#   bash scripts/run-overnight.sh --dimension error-handling --hours 8
#   bash scripts/run-overnight.sh --dimension all --hours 4
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Defaults
DIMENSION="all"
HOURS=8
MAX_ATTEMPTS_PER_DEFECT=3
AGENT_CMD="claude"  # Adjust to your Claude Code binary

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --dimension) DIMENSION="$2"; shift 2 ;;
    --hours) HOURS="$2"; shift 2 ;;
    --agent) AGENT_CMD="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Calculate deadline
DEADLINE=$(($(date +%s) + HOURS * 3600))

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN} Vibe-to-Prod: Autonomous Hardening Loop${NC}"
echo -e "${CYAN} Dimension: $DIMENSION${NC}"
echo -e "${CYAN} Budget: $HOURS hours${NC}"
echo -e "${CYAN} Deadline: $(date -d @$DEADLINE 2>/dev/null || date -r $DEADLINE)${NC}"
echo -e "${CYAN}================================================================${NC}"

# Counters
TOTAL_ATTEMPTS=0
TOTAL_COMMITS=0
TOTAL_REVERTS=0
TOTAL_SKIPS=0
START_SCORE=$(npx tsx scripts/readiness-score.ts 2>/dev/null || echo "0")

echo -e "${YELLOW}[overnight]${NC} Starting readiness score: $START_SCORE"
echo ""

# Seal eval integrity before starting
if command -v sha256sum &>/dev/null; then
  find evals/ -type f \( -name '*.ts' -o -name '*.json' \) | sort | xargs sha256sum | sha256sum > .eval-integrity
  echo -e "${YELLOW}[overnight]${NC} Eval integrity sealed"
fi

# Main loop
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  REMAINING=$(( (DEADLINE - $(date +%s)) / 60 ))
  echo -e "${YELLOW}[overnight]${NC} --- Attempt $((TOTAL_ATTEMPTS + 1)) (${REMAINING}m remaining) ---"

  # Select the active program.md
  if [ "$DIMENSION" = "all" ]; then
    # Pick the dimension with the lowest readiness sub-score
    # For now, cycle through dimensions
    PROGRAMS=(programs/*.md)
    if [ ${#PROGRAMS[@]} -eq 0 ]; then
      echo -e "${RED}[overnight]${NC} No program.md files found in programs/"
      exit 1
    fi
    PROGRAM="${PROGRAMS[$((TOTAL_ATTEMPTS % ${#PROGRAMS[@]}))]}"
  else
    PROGRAM="programs/${DIMENSION}.md"
    if [ ! -f "$PROGRAM" ]; then
      echo -e "${RED}[overnight]${NC} Program not found: $PROGRAM"
      exit 1
    fi
  fi

  echo -e "${YELLOW}[overnight]${NC} Active program: $PROGRAM"

  # Run the agent with the program.md as prompt
  # The agent modifies target/ files, then we run the gate
  AGENT_PROMPT="Read $PROGRAM and fix the next unfixed defect from evals/defect-taxonomy.json. Apply the minimal fix to the target files specified in the program. Do NOT modify any files in evals/ or scripts/."

  # Invoke agent (headless mode)
  timeout 120 $AGENT_CMD -p "$AGENT_PROMPT" --no-interactive 2>/dev/null || {
    echo -e "${YELLOW}[overnight]${NC} Agent timed out or errored, reverting..."
    git checkout -- target/ 2>/dev/null || true
    TOTAL_REVERTS=$((TOTAL_REVERTS + 1))
    TOTAL_ATTEMPTS=$((TOTAL_ATTEMPTS + 1))
    continue
  }

  # Run the fix gate
  if bash scripts/run-fix.sh 2>/dev/null; then
    TOTAL_COMMITS=$((TOTAL_COMMITS + 1))
    echo -e "${GREEN}[overnight]${NC} Fix committed (#$TOTAL_COMMITS)"
  else
    TOTAL_REVERTS=$((TOTAL_REVERTS + 1))
    echo -e "${RED}[overnight]${NC} Fix reverted (#$TOTAL_REVERTS)"
  fi

  TOTAL_ATTEMPTS=$((TOTAL_ATTEMPTS + 1))

  # Brief pause to avoid hammering
  sleep 2
done

# Summary
END_SCORE=$(npx tsx scripts/readiness-score.ts 2>/dev/null || echo "0")

echo ""
echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN} Overnight Run Complete${NC}"
echo -e "${CYAN}================================================================${NC}"
echo -e "  Attempts:     $TOTAL_ATTEMPTS"
echo -e "  Commits:      ${GREEN}$TOTAL_COMMITS${NC}"
echo -e "  Reverts:      ${RED}$TOTAL_REVERTS${NC}"
echo -e "  Commit rate:  $(echo "scale=1; $TOTAL_COMMITS * 100 / ($TOTAL_ATTEMPTS + 1)" | bc)%"
echo -e "  Score:        $START_SCORE → $END_SCORE"
echo -e "${CYAN}================================================================${NC}"

# Log overnight summary
echo "{\"type\":\"overnight_summary\",\"attempts\":$TOTAL_ATTEMPTS,\"commits\":$TOTAL_COMMITS,\"reverts\":$TOTAL_REVERTS,\"start_score\":$START_SCORE,\"end_score\":$END_SCORE,\"hours\":$HOURS,\"dimension\":\"$DIMENSION\",\"timestamp\":\"$(date -u +%FT%TZ)\"}" >> logs/fixes.jsonl
