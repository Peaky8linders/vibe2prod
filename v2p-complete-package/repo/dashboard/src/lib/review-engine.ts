/**
 * lib/review-engine.ts — Transforms ScanResult into structured ReviewReport
 *
 * Groups defects into engineering/design/QA review passes with
 * numbered issues, recommended fixes, alternatives, and effort estimates.
 */

// Use a loose input type to accept both server ScanResult and client ScanData
interface ScanInput {
  project: string;
  scanned_at: string;
  files_scanned: number;
  total_defects: number;
  overall_readiness: number;
  by_priority: { P0: number; P1: number; P2: number; P3: number };
  by_dimension: Record<string, number>;
  files: Array<{ path: string; defects: number; readiness: number; maturity: string; risk: string }>;
}

interface DefectLike {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  line: number | null;
  description: string;
  fix_hint: string;
  file: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixOption {
  label: string;
  description: string;
  effort: { human: string; cc: string };
  completeness: number; // 0-10
}

export interface ReviewIssue {
  number: number;
  severity: "P0" | "P1" | "P2" | "P3";
  dimension: string;
  file: string;
  line: number | null;
  description: string;
  codeSnippet?: string;
  recommendation: FixOption;
  alternatives: FixOption[];
}

export interface ReviewSection {
  name: string;
  score: number; // 0-10
  issues: ReviewIssue[];
}

export interface ReviewReport {
  project: string;
  scannedAt: string;
  filesScanned: number;
  totalDefects: number;
  readiness: number;
  engineering: ReviewSection;
  design: ReviewSection;
  qa: ReviewSection;
  topActions: ReviewIssue[];
}

// ---------------------------------------------------------------------------
// Dimension → Review Section Mapping
// ---------------------------------------------------------------------------

const ENGINEERING_DIMS = new Set([
  "security", "error-handling", "input-validation", "performance",
  "access-control", "secrets-management",
]);

const DESIGN_DIMS = new Set([
  "observability", "api-contract", "code-quality", "documentation",
  "ai-safety", "transparency",
]);

const QA_DIMS = new Set([
  "monitoring", "fairness", "compliance", "governance",
  "testing", "deployment-readiness",
]);

// ---------------------------------------------------------------------------
// Fix Option Generator
// ---------------------------------------------------------------------------

function generateFixOptions(defect: DefectLike): { recommendation: FixOption; alternatives: FixOption[] } {
  const hint = defect.fix_hint || "Apply recommended fix.";
  const isP0 = defect.priority === "P0";
  const isP1 = defect.priority === "P1";

  const recommendation: FixOption = {
    label: hint.split(".")[0] || "Apply fix",
    description: hint,
    effort: {
      human: isP0 ? "~30min" : isP1 ? "~15min" : "~5min",
      cc: isP0 ? "~5min" : isP1 ? "~2min" : "~1min",
    },
    completeness: isP0 ? 10 : isP1 ? 9 : 7,
  };

  const alternatives: FixOption[] = [];

  if (isP0 || isP1) {
    alternatives.push({
      label: "Suppress with documented justification",
      description: `Add inline suppression comment with risk acceptance rationale for: ${defect.description}`,
      effort: { human: "~5min", cc: "~1min" },
      completeness: isP0 ? 2 : 4,
    });
  }

  if (defect.dimension === "security" || defect.dimension === "performance") {
    alternatives.push({
      label: "Refactor entire module",
      description: `Rewrite the affected module to eliminate the root cause rather than patching the symptom.`,
      effort: { human: "~2h", cc: "~20min" },
      completeness: 10,
    });
  }

  if (defect.dimension === "observability" || defect.dimension === "code-quality") {
    alternatives.push({
      label: "Defer to next sprint",
      description: `Track as tech debt. Low blast radius, safe to defer.`,
      effort: { human: "~2min", cc: "~1min" },
      completeness: 1,
    });
  }

  if (alternatives.length === 0) {
    alternatives.push({
      label: "Manual review required",
      description: "This issue may need context-specific analysis before fixing.",
      effort: { human: "~15min", cc: "~5min" },
      completeness: 5,
    });
  }

  return { recommendation, alternatives };
}

// ---------------------------------------------------------------------------
// Score Calculator
// ---------------------------------------------------------------------------

function computeSectionScore(issues: ReviewIssue[]): number {
  if (issues.length === 0) return 10;
  const penalties = issues.reduce((sum, i) => {
    const w = i.severity === "P0" ? 3 : i.severity === "P1" ? 2 : i.severity === "P2" ? 1 : 0.5;
    return sum + w;
  }, 0);
  return Math.max(0, Math.round((1 - Math.min(penalties / 15, 1)) * 10));
}

// ---------------------------------------------------------------------------
// Main Transform
// ---------------------------------------------------------------------------

export function buildReviewReport(scanResult: ScanInput): ReviewReport {
  // We need the raw defects with file info — reconstruct from files + by_dimension
  // Since ScanResult.files only has counts, we'll use the defect dimensions to build issues
  const engIssues: ReviewIssue[] = [];
  const designIssues: ReviewIssue[] = [];
  const qaIssues: ReviewIssue[] = [];
  let issueCounter = 0;

  // Build synthetic defects from file results and dimension counts
  for (const file of scanResult.files) {
    if (file.defects === 0) continue;

    // Distribute defects across dimensions proportionally
    const totalDimDefects = Object.values(scanResult.by_dimension).reduce((a, b) => a + b, 0);
    if (totalDimDefects === 0) continue;

    for (const [dim, count] of Object.entries(scanResult.by_dimension)) {
      const fileShare = Math.round((count / totalDimDefects) * file.defects);
      if (fileShare === 0) continue;

      // Determine priority based on maturity
      const priority: "P0" | "P1" | "P2" | "P3" =
        file.maturity === "critical" ? "P0" :
        file.maturity === "needs-work" ? "P1" : "P2";

      const defect = {
        id: `REV-${++issueCounter}`,
        dimension: dim,
        priority,
        line: null,
        description: `${dim.replace(/-/g, " ")} issue in ${file.path.split("/").pop()}`,
        fix_hint: getFixHintForDimension(dim),
        file: file.path,
      };

      const { recommendation, alternatives } = generateFixOptions(defect);

      const issue: ReviewIssue = {
        number: issueCounter,
        severity: priority,
        dimension: dim,
        file: file.path,
        line: null,
        description: defect.description,
        recommendation,
        alternatives,
      };

      if (ENGINEERING_DIMS.has(dim)) engIssues.push(issue);
      else if (DESIGN_DIMS.has(dim)) designIssues.push(issue);
      else qaIssues.push(issue);
    }
  }

  // Sort by severity within each section
  const sortBySeverity = (a: ReviewIssue, b: ReviewIssue) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return order[a.severity] - order[b.severity];
  };

  engIssues.sort(sortBySeverity);
  designIssues.sort(sortBySeverity);
  qaIssues.sort(sortBySeverity);

  // Re-number sequentially
  let num = 0;
  for (const issue of [...engIssues, ...designIssues, ...qaIssues]) {
    issue.number = ++num;
  }

  const topActions = [...engIssues, ...designIssues, ...qaIssues]
    .sort(sortBySeverity)
    .slice(0, 5);

  return {
    project: scanResult.project,
    scannedAt: scanResult.scanned_at,
    filesScanned: scanResult.files_scanned,
    totalDefects: scanResult.total_defects,
    readiness: scanResult.overall_readiness,
    engineering: {
      name: "Engineering Review",
      score: computeSectionScore(engIssues),
      issues: engIssues.slice(0, 20),
    },
    design: {
      name: "Design Review",
      score: computeSectionScore(designIssues),
      issues: designIssues.slice(0, 20),
    },
    qa: {
      name: "QA Review",
      score: computeSectionScore(qaIssues),
      issues: qaIssues.slice(0, 20),
    },
    topActions,
  };
}

function getFixHintForDimension(dim: string): string {
  const hints: Record<string, string> = {
    "security": "Apply security hardening. Use parameterized queries, validate inputs, and add authentication middleware.",
    "error-handling": "Add try/catch with structured logging. Never swallow errors silently.",
    "input-validation": "Add Zod schema validation for all mutation endpoints.",
    "performance": "Batch database queries. Add pagination for list endpoints. Remove N+1 patterns.",
    "observability": "Add structured logging with request IDs. Implement health check endpoints.",
    "api-contract": "Add API versioning, consistent error formats, and schema validation.",
    "code-quality": "Reduce function complexity. Extract helpers for deeply nested logic.",
    "monitoring": "Add metrics collection, alerting thresholds, and dashboard integration.",
    "compliance": "Add audit logging, human oversight checkpoints, and transparency documentation.",
    "governance": "Implement RBAC, rotate secrets, and add incident response procedures.",
    "access-control": "Add authentication middleware and role-based permissions.",
    "documentation": "Add API documentation, inline comments for complex logic, and README updates.",
    "fairness": "Add bias detection, fairness metrics, and demographic testing.",
    "ai-safety": "Add human oversight, output validation, and safety guardrails.",
    "transparency": "Document model capabilities, limitations, and decision-making processes.",
    "secrets-management": "Move secrets to environment variables. Use a secrets manager.",
  };
  return hints[dim] || "Review and apply recommended fix.";
}
