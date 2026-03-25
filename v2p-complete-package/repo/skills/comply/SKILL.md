---
name: comply
description: Run compliance readiness assessment — security + AI governance + evidence chain integrity
---

# Compliance Readiness Assessment

You are running VibeCheck's compliance assessment to determine if a project is ready for production deployment from both a security and regulatory perspective.

## What This Checks

### Security (0-40 points)
The existing VibeCheck hardening dimensions:
- SQL injection, XSS, hardcoded secrets
- Missing error handling, timeouts
- Input validation gaps
- Logging and observability
- Data integrity (transactions, constraints)

### AI Governance Compliance (0-30 points)
EU AI Act and NIST AI RMF alignment:
- Unsafe model loading (pickle, eval) — Art. 15
- Missing human oversight on AI decisions — Art. 14
- AI content not disclosed to users — Art. 50
- PII in logs without redaction — Art. 10 / GDPR
- No audit logging for AI decisions — Art. 12
- Missing model documentation — Art. 11
- No fairness/bias testing — Art. 10(2)(f)

### Evidence Trail (0-30 points)
Tamper-proof audit trail completeness:
- Evidence chain exists and has history
- Chain integrity verified (SHA-256 hash linkage)
- Scan-to-fix progression documented

## How to Run

```bash
vibecheck comply --path ../my-app --report
```

## Grading
- A (90+): Production ready
- B (75-89): Ready with minor items
- C (60-74): Conditional — fix P1 defects
- D (40-59): Not ready — significant work needed
- F (<40): Critical gaps

## After Assessment
1. Fix all P0 defects (blockers)
2. Address P1 compliance gaps
3. Re-run `vibecheck comply` to verify improvement
4. Use `vibecheck evidence:verify` to confirm audit trail integrity
