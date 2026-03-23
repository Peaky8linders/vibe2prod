#!/usr/bin/env bash
# =============================================================================
# PreToolUse hook — Guard audit trail integrity
#
# Fires before Bash tool execution. Warns before commands that could:
# - Delete audit logs or compliance evidence
# - Disable security logging
# - Modify guardian configuration
# =============================================================================

COMMAND="${1:-}"
[ -z "$COMMAND" ] && exit 0

# Patterns that threaten audit trail
DANGEROUS_PATTERNS=(
  "rm.*findings"
  "rm.*ledger"
  "rm.*evidence"
  "rm.*progress"
  "rm.*\.guardian"
  "rm.*audit"
  "> findings"
  "> ledger"
  "truncate.*findings"
  "echo.*>.*findings"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "⚠️  GUARDIAN: This command may compromise the audit trail."
    echo "   Pattern matched: $pattern"
    echo "   Command: $COMMAND"
    echo ""
    echo "   The compliance audit trail (findings, ledger, evidence) must remain intact."
    echo "   If you need to reset, use: guardian reset --confirm"
    exit 1
  fi
done

exit 0
