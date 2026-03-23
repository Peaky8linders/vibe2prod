#!/bin/bash
set -euo pipefail

# =============================================================================
# scripts/seal-evals.sh — Generate integrity hash for eval harness
#
# Run this after any intentional modification to evals/ files.
# The harness checks this hash on every run to detect agent tampering.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

HASH=$(find evals/ -type f \( -name '*.ts' -o -name '*.json' \) | sort | xargs sha256sum | sha256sum)

echo "$HASH" > .eval-integrity

echo "Eval integrity sealed: $HASH"
echo "Written to .eval-integrity"
