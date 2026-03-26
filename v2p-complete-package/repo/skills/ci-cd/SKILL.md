---
name: ci-cd
description: Generate CI/CD pipeline that runs VibeCheck as a PR gate — 3 clicks to production hardening
---

# CI/CD Integration

You are setting up VibeCheck as a CI/CD gate. The goal: every PR gets scanned, and merges are blocked if the readiness score drops below threshold.

## Step 1: Detect Platform

Check the project for CI/CD configuration:
- `.github/workflows/` → GitHub Actions
- `.gitlab-ci.yml` → GitLab CI
- `.circleci/config.yml` → CircleCI
- `Jenkinsfile` → Jenkins
- None → Default to GitHub Actions

## Step 2: Configure Threshold

Ask the user for their readiness score threshold. Default recommendations:
- **Conservative**: 80% (blocks on P0 + most P1 defects)
- **Standard**: 70% (allows some P1 defects through)
- **Permissive**: 60% (only blocks on critical issues)

## Step 3: Generate Pipeline

### GitHub Actions (default)
Create `.github/workflows/vibecheck.yml`:

```yaml
name: VibeCheck Production Readiness
on:
  pull_request:
    branches: [main, master]

jobs:
  vibecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run VibeCheck Scan
        run: npx vibecheck scan:e2e --path . --report
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Check Readiness Score
        run: |
          SCORE=$(npx vibecheck score --json | jq -r '.overall_readiness')
          THRESHOLD=0.70
          echo "Readiness: ${SCORE} (threshold: ${THRESHOLD})"
          if (( $(echo "$SCORE < $THRESHOLD" | bc -l) )); then
            echo "::error::Readiness score ${SCORE} is below threshold ${THRESHOLD}"
            exit 1
          fi

      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: vibecheck-report
          path: reports/
```

## Step 4: Generate Badge

Call `vc_badge` to generate a README badge showing current readiness score.

Add to README:
```markdown
![VibeCheck](reports/readiness-badge.svg)
```

## Step 5: Configure Secrets

Remind the user to add `ANTHROPIC_API_KEY` as a repository secret if they want LLM-powered scanning in CI.

Without it, the scan runs in static-only mode (L1 gates + pattern scanners).

## Step 6: Verify

- Check that the workflow YAML is valid
- Confirm the readiness score threshold is set
- Verify the badge is generated and linked in README
