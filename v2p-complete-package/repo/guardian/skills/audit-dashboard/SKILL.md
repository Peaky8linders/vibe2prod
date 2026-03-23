---
name: audit-dashboard
version: 1.0.0
description: |
  Dashboard launcher skill that starts the Express-based compliance dashboard
  server and opens the browser to the findings UI. Displays compliance score,
  finding counts by severity and domain, and a filterable findings table.
  Use when: "open dashboard", "show findings", "launch UI", "compliance dashboard",
  "view audit results".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# audit-dashboard — Dashboard Launcher

Start the Guardian compliance dashboard and open it in the browser.

## Phase 1 — Pre-flight Checks

1. Verify the Guardian package is installed: check that `package.json` exists in the guardian directory.
2. Check that `node_modules` exists. If not, run `npm install` in the guardian directory.
3. Check that `findings.jsonl` exists. If not, warn the user that no findings data is available:
   ```
   No findings.jsonl found. Run audit-full first to generate findings data.
   The dashboard will launch but will show empty results.
   ```

## Phase 2 — Start Dashboard Server

1. Run the dashboard server command:
   ```bash
   cd <guardian-dir> && npm run dashboard
   ```
   This starts the Express server (typically on port 3000).
2. Wait for the server startup message (e.g., "Dashboard listening on port 3000").
3. If the port is already in use, detect and report it:
   - Check if an existing guardian dashboard is running.
   - If so, skip starting a new one and reuse the existing server.

## Phase 3 — Open Browser

1. Open the dashboard URL in the default browser:
   ```bash
   open http://localhost:3000  # macOS
   xdg-open http://localhost:3000  # Linux
   start http://localhost:3000  # Windows
   ```
2. Confirm the browser opened successfully.

## Phase 4 — Dashboard Overview

Use **AskUserQuestion** to present the dashboard status:

```
=== COMPLIANCE DASHBOARD ===

Dashboard running at: http://localhost:3000
Findings loaded: <n> total

Quick stats:
  Compliance score: <score>/100
  P0 (Critical): <n>
  P1 (High):     <n>
  P2 (Medium):   <n>
  P3 (Low):      <n>

The dashboard shows:
  - Compliance score gauge
  - Findings by severity (bar chart)
  - Findings by domain (radar chart)
  - Filterable findings table with evidence and remediation
  - Fix history from ledger.tsv

Press Ctrl+C in the terminal to stop the dashboard server.

Would you like to:
  (a) Keep the dashboard running in the background
  (b) Stop the dashboard
```

## Phase 5 — Background or Shutdown

Based on user response:
- **(a)** Leave the server running. Report the PID for later cleanup.
- **(b)** Kill the server process and confirm shutdown.

## Completion Protocol

- **DONE** — Dashboard launched, browser opened, findings displayed.
- **DONE_WITH_CONCERNS** — Dashboard launched but no findings data available.
- **BLOCKED** — npm install failed, port unavailable, or guardian package not found.

Report final status and the dashboard URL.
