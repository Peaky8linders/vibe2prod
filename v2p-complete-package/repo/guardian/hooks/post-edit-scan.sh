#!/usr/bin/env bash
# =============================================================================
# PostToolUse hook — Silent background scanning after file edits
#
# Fires after Read/Edit/Write tool use. Scans the modified file for
# security, privacy, and quality issues. Appends to findings queue.
# Non-blocking: runs in background and never fails the parent tool.
# =============================================================================

GUARDIAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_FILE="${HOME}/.guardian/findings-queue.jsonl"
mkdir -p "$(dirname "$QUEUE_FILE")"

# Get the file that was edited (passed as argument or from env)
FILE="${1:-${TOOL_FILE:-}}"
[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

# Quick pattern-based scan (no LLM, must be fast)
scan_file() {
  local file="$1"
  local findings=""

  # Secret patterns
  if grep -nE "(api[_-]?key|secret|password|token|credential)\s*[:=]\s*['\"][^'\"]{8,}" "$file" 2>/dev/null; then
    findings="${findings}{\"type\":\"secret\",\"file\":\"$file\",\"severity\":\"P0\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}\n"
  fi

  # SQL injection patterns
  if grep -nE "(\\\$\{.*\}.*WHERE|f['\"].*SELECT|string interpolation.*query)" "$file" 2>/dev/null; then
    findings="${findings}{\"type\":\"sql-injection\",\"file\":\"$file\",\"severity\":\"P0\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}\n"
  fi

  # PII in logs
  if grep -nE "(console\.(log|info|warn).*email|log.*password|console.*user)" "$file" 2>/dev/null; then
    findings="${findings}{\"type\":\"pii-leak\",\"file\":\"$file\",\"severity\":\"P1\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}\n"
  fi

  # Stack trace leakage
  if grep -nE "(err\.stack|error\.stack|\.stack.*res\.|res.*stack)" "$file" 2>/dev/null; then
    findings="${findings}{\"type\":\"stack-leak\",\"file\":\"$file\",\"severity\":\"P1\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}\n"
  fi

  [ -n "$findings" ] && echo -e "$findings" >> "$QUEUE_FILE"
}

# Run in background, never block the parent tool
scan_file "$FILE" &
exit 0
