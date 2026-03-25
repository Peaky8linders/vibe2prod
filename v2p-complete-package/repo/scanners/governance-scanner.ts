/**
 * scanners/governance-scanner.ts — RBAC, Access Control, Secrets Management
 *
 * Checks adapted from AI Compliance Product's security_audit.py (10-domain audit).
 * Focuses on governance gaps that regulatory frameworks require.
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface.js";

interface GovernanceRule {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  description: string;
  fix_hint: string;
  regulation: string;
  pattern: RegExp;
  /** Only trigger in specific file contexts */
  filePattern?: RegExp;
  languages?: string[];
}

const GOVERNANCE_RULES: GovernanceRule[] = [
  // Access Control
  {
    id: "GOV-001",
    dimension: "access-control",
    priority: "P1",
    description: "Admin route without role-based access check",
    fix_hint: "Add RBAC middleware: check user role before granting admin access",
    regulation: "NIST AI RMF GOVERN 1.2 / ISO 27001 A.9",
    pattern: /(?:\/admin|\/internal|\/management|\/dashboard\/api)\b/,
    filePattern: /(?:route|router|controller|api|server)\./i,
  },
  {
    id: "GOV-002",
    dimension: "access-control",
    priority: "P1",
    description: "Wildcard CORS origin in production code",
    fix_hint: "Restrict CORS to specific allowed origins instead of '*'",
    regulation: "OWASP A01:2021 / NIST SP 800-53 AC-4",
    pattern: /(?:cors\s*\(\s*\{[^}]*origin\s*:\s*['"][*]['"]|Access-Control-Allow-Origin['"]\s*,\s*['"][*]['"])/,
  },
  {
    id: "GOV-003",
    dimension: "access-control",
    priority: "P1",
    description: "No rate limiting on authentication endpoint",
    fix_hint: "Add rate limiting middleware (express-rate-limit, slowDown) to auth routes",
    regulation: "OWASP A07:2021 / NIST SP 800-53 SC-5",
    pattern: /(?:\/login|\/auth|\/signin|\/register|\/signup|\/token)\b/,
    filePattern: /(?:route|router|controller|api|auth)\./i,
  },

  // Secrets Management
  {
    id: "GOV-010",
    dimension: "secrets-management",
    priority: "P0",
    description: "Default or hardcoded admin credentials in source",
    fix_hint: "Move credentials to environment variables; never commit defaults",
    regulation: "OWASP A07:2021 / CWE-798",
    pattern: /(?:admin_password|default_password|root_password|master_key)\s*[:=]\s*['"][^'"]+['"]/i,
  },
  {
    id: "GOV-011",
    dimension: "secrets-management",
    priority: "P1",
    description: "JWT secret hardcoded in source code",
    fix_hint: "Move JWT secret to environment variable: process.env.JWT_SECRET",
    regulation: "OWASP A02:2021 / CWE-321",
    pattern: /(?:jwt_?secret|signing_?key|token_?secret)\s*[:=]\s*['"][a-zA-Z0-9_-]{8,}['"]/i,
  },

  // Incident Management
  {
    id: "GOV-020",
    dimension: "incident-response",
    priority: "P2",
    description: "No error reporting or alerting integration",
    fix_hint: "Add error reporting service (Sentry, Datadog, PagerDuty) for production incidents",
    regulation: "EU AI Act Art. 62 (Serious Incident Reporting) / ISO 27001 A.16",
    pattern: /(?:process\.on\s*\(\s*['"]uncaughtException|unhandledRejection)/,
    filePattern: /(?:server|app|index|main)\./i,
  },
  {
    id: "GOV-021",
    dimension: "incident-response",
    priority: "P2",
    description: "Error responses expose internal stack traces",
    fix_hint: "Sanitize error responses in production: return generic message, log details internally",
    regulation: "OWASP A05:2021 / CWE-209",
    pattern: /(?:res\.(?:json|send)\s*\([^)]*(?:err\.stack|error\.stack|\.stack))/,
  },

  // Business Continuity
  {
    id: "GOV-030",
    dimension: "business-continuity",
    priority: "P2",
    description: "Database operations without transaction boundaries",
    fix_hint: "Wrap multi-step DB operations in transactions for atomicity",
    regulation: "ISO 27001 A.17 / NIST SP 800-53 CP-10",
    pattern: /(?:\.query\s*\([^)]*(?:INSERT|UPDATE|DELETE).*\.query\s*\([^)]*(?:INSERT|UPDATE|DELETE))/is,
  },

  // Data Classification
  {
    id: "GOV-040",
    dimension: "data-classification",
    priority: "P2",
    description: "Sensitive data fields without classification markers",
    fix_hint: "Add data classification comments (// @classification: PII, SENSITIVE, PUBLIC) to data models",
    regulation: "EU AI Act Art. 10 / ISO 27001 A.8.2",
    pattern: /(?:email|phone|address|birth_?date|salary|medical|health|ethnicity|religion|sexual_orientation)\s*[:?]?\s*(?:string|str|varchar|text)/i,
    filePattern: /(?:model|schema|entity|type|interface)\./i,
  },
];

// ---------------------------------------------------------------------------
// Scanner Implementation
// ---------------------------------------------------------------------------

function findLineNumber(content: string, match: RegExpMatchArray): number | null {
  if (match.index === undefined) return null;
  return content.substring(0, match.index).split("\n").length;
}

export const governanceScanner: ScannerPlugin = {
  name: "governance",
  dimensions: ["access-control", "secrets-management", "incident-response",
    "business-continuity", "data-classification"],

  scan(filePath: string, content: string, _language: string): FileDefect[] {
    const defects: FileDefect[] = [];
    const seenIds = new Set<string>();

    for (const rule of GOVERNANCE_RULES) {
      // Check file pattern filter
      if (rule.filePattern && !rule.filePattern.test(filePath)) continue;

      // Check language filter
      if (rule.languages && !rule.languages.includes(_language)) continue;

      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags + (rule.pattern.flags.includes("g") ? "" : "g"));
      let match: RegExpExecArray | null;

      while ((match = globalPattern.exec(content)) !== null) {
        const line = findLineNumber(content, match);
        const key = `${rule.id}-${line}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);

        defects.push({
          id: rule.id,
          dimension: rule.dimension,
          priority: rule.priority,
          line,
          description: rule.description,
          fix_hint: rule.fix_hint,
          code_snippet: match[0].substring(0, 80),
          regulation: rule.regulation,
        });
      }
    }

    return defects;
  },
};

export default governanceScanner;
