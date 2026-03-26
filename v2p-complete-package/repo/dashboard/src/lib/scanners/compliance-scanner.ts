/**
 * scanners/compliance-scanner.ts — AI Governance & Regulatory Compliance
 *
 * Checks for EU AI Act, NIST AI RMF, and general AI governance gaps.
 * Adapted from AI Compliance Product's 9 analyzers.
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

// ---------------------------------------------------------------------------
// Pattern Definitions
// ---------------------------------------------------------------------------

interface CompliancePattern {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  description: string;
  fix_hint: string;
  regulation: string;
  /** Regex to detect the problem */
  pattern: RegExp;
  /** If true, ABSENCE of this pattern in AI-using files is the problem */
  absence_check?: boolean;
  /** Only apply to files that use AI frameworks */
  ai_only?: boolean;
  /** File extensions this applies to */
  languages?: string[];
}

// Detect if a file uses AI/ML frameworks
const AI_FRAMEWORK_PATTERNS = [
  /import\s+(?:openai|anthropic|langchain|transformers)/,
  /from\s+(?:openai|anthropic|langchain|transformers|torch|tensorflow)/,
  /require\s*\(\s*['"](?:openai|@anthropic-ai\/sdk|langchain|@langchain)/,
  /new\s+(?:OpenAI|Anthropic|ChatOpenAI|ChatAnthropic)/,
  /\.chat\.completions\.create/,
  /\.messages\.create/,
  /pipeline\s*\(\s*['"](?:text-generation|sentiment|translation)/,
];

const COMPLIANCE_PATTERNS: CompliancePattern[] = [
  // P0 — Critical Safety
  {
    id: "COMPLY-001",
    dimension: "ai-safety",
    priority: "P0",
    description: "Unsafe model loading: pickle.load or torch.load can execute arbitrary code",
    fix_hint: "Use safetensors or torch.load(..., weights_only=True) instead of pickle/torch.load",
    regulation: "EU AI Act Art. 15 (Accuracy, Robustness, Cybersecurity)",
    pattern: /(?:pickle\.load|torch\.load\s*\([^)]*\)(?!.*weights_only)|joblib\.load|shelve\.open)/,
    languages: ["python"],
  },
  {
    id: "COMPLY-002",
    dimension: "ai-safety",
    priority: "P0",
    description: "eval()/exec() used with potentially untrusted input — code injection risk",
    fix_hint: "Replace eval/exec with safe alternatives (JSON.parse, structured parsers, sandboxed execution)",
    regulation: "EU AI Act Art. 15 / OWASP A03:2021",
    pattern: /(?:^|[^.])eval\s*\(|exec\s*\(/,
  },
  {
    id: "COMPLY-003",
    dimension: "data-privacy",
    priority: "P0",
    description: "PII fields logged or returned without redaction",
    fix_hint: "Redact PII fields (email, ssn, phone, address) before logging or returning in responses",
    regulation: "EU AI Act Art. 10 / GDPR Art. 5(1)(c)",
    pattern: /(?:console\.log|logger?\.\w+|res\.(?:json|send))\s*\([^)]*(?:ssn|social_security|passport|credit_card|bank_account)/i,
  },

  // P1 — Must Fix
  {
    id: "COMPLY-010",
    dimension: "human-oversight",
    priority: "P1",
    description: "AI-driven mutation (write/delete/update) with no human approval gate",
    fix_hint: "Add confirmation step or approval queue before AI-initiated destructive operations",
    regulation: "EU AI Act Art. 14 (Human Oversight)",
    pattern: /(?:\.(?:delete|remove|destroy|update|create|insert|put|patch))\s*\(/,
    ai_only: true,
  },
  {
    id: "COMPLY-011",
    dimension: "transparency",
    priority: "P1",
    description: "AI-generated content returned to user without disclosure",
    fix_hint: "Add AI disclosure: label AI-generated responses, include model attribution",
    regulation: "EU AI Act Art. 50 (Transparency for AI Systems)",
    pattern: /(?:res\.(?:json|send|render)|return\s+(?:new\s+Response|NextResponse))/,
    ai_only: true,
  },
  {
    id: "COMPLY-012",
    dimension: "audit-logging",
    priority: "P1",
    description: "AI decision made with no audit log entry",
    fix_hint: "Log every AI decision: input, output, model, timestamp, confidence score",
    regulation: "EU AI Act Art. 12 (Record-Keeping)",
    pattern: /\.(?:chat|completions|messages|generate|invoke)\s*\(/,
    ai_only: true,
  },
  {
    id: "COMPLY-013",
    dimension: "human-oversight",
    priority: "P1",
    description: "No confidence threshold or fallback for AI decisions",
    fix_hint: "Add confidence threshold check; escalate to human when AI confidence is below threshold",
    regulation: "EU AI Act Art. 14(4)(b) (Understand capabilities and limitations)",
    pattern: /\.(?:chat|completions|messages|generate)\s*\(/,
    ai_only: true,
  },

  // P2 — Should Fix
  {
    id: "COMPLY-020",
    dimension: "documentation",
    priority: "P2",
    description: "AI system lacks model card or technical documentation",
    fix_hint: "Create MODEL_CARD.md documenting: model name, version, intended use, limitations, training data summary",
    regulation: "EU AI Act Art. 11 / Annex IV (Technical Documentation)",
    pattern: /(?:openai|anthropic|langchain|transformers)/,
    ai_only: true,
  },
  {
    id: "COMPLY-021",
    dimension: "fairness",
    priority: "P2",
    description: "No bias or fairness testing found in AI pipeline",
    fix_hint: "Add fairness evaluation: test for demographic parity, equal opportunity across protected attributes",
    regulation: "EU AI Act Art. 10(2)(f) (Bias examination)",
    pattern: /(?:openai|anthropic|langchain)/,
    ai_only: true,
  },
  {
    id: "COMPLY-022",
    dimension: "supply-chain",
    priority: "P2",
    description: "AI dependency without version pinning — supply chain risk",
    fix_hint: "Pin AI framework versions exactly (e.g., openai@4.28.0 not openai@^4)",
    regulation: "EU AI Act Art. 15 / NIST AI RMF GOVERN 1.6",
    pattern: /["']\^?\d+\.\d+(?:\.\d+)?["']/,
    languages: ["json"],
  },
  {
    id: "COMPLY-023",
    dimension: "data-privacy",
    priority: "P2",
    description: "User data sent to external AI API without consent mechanism",
    fix_hint: "Add user consent check before sending data to AI APIs; document data processing in privacy policy",
    regulation: "EU AI Act Art. 13 / GDPR Art. 6",
    pattern: /\.(?:chat|completions|messages|generate|embed)\s*\(/,
    ai_only: true,
  },

  // P3 — Nice to Have
  {
    id: "COMPLY-030",
    dimension: "documentation",
    priority: "P3",
    description: "No SBOM (Software Bill of Materials) for AI dependencies",
    fix_hint: "Generate SBOM: npx @cyclonedx/cyclonedx-npm or pip install cyclonedx-bom",
    regulation: "NIST AI RMF GOVERN 1.6 (Supply chain risk)",
    pattern: /(?:package\.json|requirements\.txt|pyproject\.toml)/,
  },
  {
    id: "COMPLY-031",
    dimension: "monitoring",
    priority: "P3",
    description: "No drift detection or model performance monitoring",
    fix_hint: "Add inference monitoring: track prediction distributions, response times, error rates over time",
    regulation: "EU AI Act Art. 9(2)(b) (Post-market monitoring)",
    pattern: /(?:openai|anthropic|langchain)/,
    ai_only: true,
  },
];

// ---------------------------------------------------------------------------
// Scanner Implementation
// ---------------------------------------------------------------------------

function isAIFile(content: string): boolean {
  return AI_FRAMEWORK_PATTERNS.some((p) => p.test(content));
}

function findLineNumber(content: string, match: RegExpMatchArray): number | null {
  if (match.index === undefined) return null;
  const beforeMatch = content.substring(0, match.index);
  return beforeMatch.split("\n").length;
}

export const complianceScanner: ScannerPlugin = {
  name: "compliance",
  dimensions: ["ai-safety", "human-oversight", "transparency", "audit-logging",
    "data-privacy", "fairness", "documentation", "supply-chain", "monitoring"],

  scan(_filePath: string, content: string, language: string): FileDefect[] {
    const defects: FileDefect[] = [];
    const isAI = isAIFile(content);
    const seenIds = new Set<string>();

    for (const rule of COMPLIANCE_PATTERNS) {
      // Skip AI-only rules for non-AI files
      if (rule.ai_only && !isAI) continue;

      // Skip language-specific rules
      if (rule.languages && !rule.languages.includes(language)) continue;

      // Find all matches
      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags + (rule.pattern.flags.includes("g") ? "" : "g"));
      let match: RegExpExecArray | null;

      while ((match = globalPattern.exec(content)) !== null) {
        const defectKey = `${rule.id}-${findLineNumber(content, match)}`;
        if (seenIds.has(defectKey)) continue;
        seenIds.add(defectKey);

        defects.push({
          id: rule.id,
          dimension: rule.dimension,
          priority: rule.priority,
          line: findLineNumber(content, match),
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

export default complianceScanner;
