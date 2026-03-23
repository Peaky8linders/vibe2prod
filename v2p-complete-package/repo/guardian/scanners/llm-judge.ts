import * as fs from 'fs';
import * as path from 'path';

export interface Finding {
  id: string;
  domain: number;
  control_id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
  title: string;
  description: string;
  file: string;
  line: number;
  evidence: string;
  remediation: string;
  standard_refs: string[];
  auto_fixable: boolean;
}

export interface JudgeVerdict {
  verdict: 'true_positive' | 'false_positive' | 'needs_human_review';
  confidence: number;
  reasoning: string;
}

export interface JudgeOptions {
  /** Confidence threshold for auto-classification. Default: 0.85 */
  confidenceThreshold?: number;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: claude-sonnet-4-20250514 */
  model?: string;
  /** Path to memories file. Default: ~/.guardian/memories.json */
  memoriesPath?: string;
}

interface OrgMemories {
  /** Known false positive patterns for this org */
  falsePositivePatterns?: FalsePositivePattern[];
  /** Known acceptable risks */
  acceptedRisks?: AcceptedRisk[];
  /** Org-specific context */
  context?: Record<string, string>;
}

interface FalsePositivePattern {
  category: string;
  pattern: string;
  reason: string;
}

interface AcceptedRisk {
  finding_id_pattern: string;
  reason: string;
  accepted_by: string;
  accepted_at: string;
}

function loadMemories(memoriesPath: string): OrgMemories {
  try {
    if (fs.existsSync(memoriesPath)) {
      return JSON.parse(fs.readFileSync(memoriesPath, 'utf-8'));
    }
  } catch {
    // Fall through to default
  }
  return {};
}

function getCodeContext(finding: Finding, targetDir: string, contextLines: number = 10): string {
  const filePath = path.resolve(targetDir, finding.file);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, finding.line - contextLines - 1);
    const end = Math.min(lines.length, finding.line + contextLines);
    const contextBlock = lines
      .slice(start, end)
      .map((line, idx) => {
        const lineNum = start + idx + 1;
        const marker = lineNum === finding.line ? ' >>>' : '    ';
        return `${marker} ${lineNum}: ${line}`;
      })
      .join('\n');
    return contextBlock;
  } catch {
    return finding.evidence;
  }
}

function buildPrompt(finding: Finding, codeContext: string, memories: OrgMemories): string {
  let memoriesSection = '';
  if (memories.context) {
    memoriesSection += '\n## Org Context\n';
    for (const [key, value] of Object.entries(memories.context)) {
      memoriesSection += `- ${key}: ${value}\n`;
    }
  }
  if (memories.falsePositivePatterns?.length) {
    memoriesSection += '\n## Known False Positive Patterns\n';
    for (const fp of memories.falsePositivePatterns) {
      memoriesSection += `- Category: ${fp.category}, Pattern: ${fp.pattern}, Reason: ${fp.reason}\n`;
    }
  }
  if (memories.acceptedRisks?.length) {
    memoriesSection += '\n## Accepted Risks\n';
    for (const risk of memories.acceptedRisks) {
      memoriesSection += `- Pattern: ${risk.finding_id_pattern}, Reason: ${risk.reason}\n`;
    }
  }

  return `You are a security finding triage expert. Analyze this security scanner finding and determine if it is a true positive (real vulnerability) or false positive (benign code flagged incorrectly).

## Finding
- ID: ${finding.id}
- Category: ${finding.category}
- Severity: ${finding.severity}
- Title: ${finding.title}
- Description: ${finding.description}
- File: ${finding.file}
- Line: ${finding.line}
- Evidence: ${finding.evidence}

## Code Context
\`\`\`
${codeContext}
\`\`\`
${memoriesSection}
## Instructions
1. Analyze the code context carefully
2. Consider whether the flagged pattern represents a real security risk in this context
3. Consider if there are mitigating controls visible in the surrounding code
4. Factor in the org context and known false positive patterns if provided

Respond with EXACTLY this JSON format (no other text):
{
  "verdict": "true_positive" | "false_positive",
  "confidence": <number between 0 and 1>,
  "reasoning": "<brief explanation>"
}`;
}

async function callClaudeAPI(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<JudgeVerdict> {
  // Dynamic import for fetch (Node 18+) or use global
  const fetchFn = globalThis.fetch;
  if (!fetchFn) {
    throw new Error('fetch not available — requires Node 18+ or polyfill');
  }

  const response = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const text = data.content?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse JSON from Claude response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}

// --- Heuristic fallback ---

function heuristicJudge(finding: Finding, codeContext: string, memories: OrgMemories): JudgeVerdict {
  let confidence = 0.5;
  let leansToFP = false;
  const reasons: string[] = [];

  // Check known false positive patterns from memories
  if (memories.falsePositivePatterns) {
    for (const fp of memories.falsePositivePatterns) {
      if (finding.category === fp.category) {
        const regex = new RegExp(fp.pattern, 'i');
        if (regex.test(codeContext) || regex.test(finding.evidence)) {
          leansToFP = true;
          confidence = 0.75;
          reasons.push(`Matches known FP pattern: ${fp.reason}`);
        }
      }
    }
  }

  // Check accepted risks
  if (memories.acceptedRisks) {
    for (const risk of memories.acceptedRisks) {
      const regex = new RegExp(risk.finding_id_pattern, 'i');
      if (regex.test(finding.id) || regex.test(finding.category)) {
        leansToFP = true;
        confidence = 0.7;
        reasons.push(`Matches accepted risk: ${risk.reason}`);
      }
    }
  }

  // Pattern-based heuristics

  // Secret scanner: check if value comes from env var
  if (finding.category === 'secret-exposure') {
    if (/process\.env\.|os\.environ|getenv|ENV\[/i.test(codeContext)) {
      leansToFP = true;
      confidence = 0.7;
      reasons.push('Value appears to be loaded from environment variable');
    }
    if (/example|placeholder|changeme|your[-_]?key|xxx/i.test(finding.evidence)) {
      leansToFP = true;
      confidence = 0.8;
      reasons.push('Value appears to be a placeholder/example');
    }
  }

  // Injection: check for parameterized queries nearby
  if (finding.category === 'sql-injection') {
    if (/\?\s*,|\$\d|\%s|:(\w+)|\bparams\b|\bbind\b/i.test(codeContext)) {
      leansToFP = true;
      confidence = 0.65;
      reasons.push('Parameterized query patterns found in context');
    }
  }

  // Auth: check if file is a public-facing route file
  if (finding.category === 'missing-auth') {
    if (/public|health|status|docs|swagger|webhook/i.test(finding.evidence)) {
      leansToFP = true;
      confidence = 0.75;
      reasons.push('Route appears to be intentionally public');
    }
  }

  // CORS: check if it's a development/local config
  if (finding.category === 'cors-misconfiguration') {
    if (/development|dev|local|localhost|127\.0\.0\.1/i.test(codeContext)) {
      leansToFP = true;
      confidence = 0.6;
      reasons.push('CORS config appears to be development-only');
    }
  }

  // PII logging: check if there's a sanitizer/redactor in context
  if (finding.category.startsWith('pii-')) {
    if (/mask|redact|sanitize|anonymize|scrub|filter/i.test(codeContext)) {
      leansToFP = true;
      confidence = 0.7;
      reasons.push('Sanitization/redaction function found in context');
    }
  }

  // Test files get lower confidence as true positives
  if (/test|spec|mock|fixture/i.test(finding.file)) {
    if (!leansToFP) {
      leansToFP = true;
      confidence = 0.6;
      reasons.push('Finding is in a test/mock file');
    }
  }

  if (reasons.length === 0) {
    reasons.push('No strong heuristic signals — defaulting to true positive assumption');
  }

  const verdict = leansToFP ? 'false_positive' : 'true_positive';

  return {
    verdict,
    confidence,
    reasoning: `Heuristic analysis: ${reasons.join('; ')}`,
  };
}

/**
 * Judge a single finding using LLM or heuristic fallback.
 */
export async function judge(
  finding: Finding,
  targetDir: string,
  options: JudgeOptions = {},
): Promise<JudgeVerdict> {
  const {
    confidenceThreshold = 0.85,
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = 'claude-sonnet-4-20250514',
    memoriesPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.guardian',
      'memories.json',
    ),
  } = options;

  const memories = loadMemories(memoriesPath);
  const codeContext = getCodeContext(finding, targetDir);

  let verdict: JudgeVerdict;

  if (apiKey) {
    try {
      const prompt = buildPrompt(finding, codeContext, memories);
      verdict = await callClaudeAPI(prompt, apiKey, model);
    } catch (error) {
      // Fall back to heuristic if API call fails
      console.warn(`LLM judge API call failed, using heuristic fallback: ${error}`);
      verdict = heuristicJudge(finding, codeContext, memories);
    }
  } else {
    // No API key — use heuristic
    verdict = heuristicJudge(finding, codeContext, memories);
  }

  // Apply confidence gate
  if (verdict.confidence < confidenceThreshold) {
    return {
      verdict: 'needs_human_review',
      confidence: verdict.confidence,
      reasoning: `${verdict.reasoning} [Below confidence threshold ${confidenceThreshold}: original verdict was ${verdict.verdict}]`,
    };
  }

  return verdict;
}

/**
 * Judge multiple findings in batch.
 */
export async function judgeBatch(
  findings: Finding[],
  targetDir: string,
  options: JudgeOptions = {},
): Promise<Map<string, JudgeVerdict>> {
  const results = new Map<string, JudgeVerdict>();

  // Process sequentially to respect API rate limits
  for (const finding of findings) {
    const verdict = await judge(finding, targetDir, options);
    results.set(finding.id, verdict);
  }

  return results;
}

/**
 * Filter findings by removing false positives (above confidence threshold).
 * Returns only true positives and needs_human_review items.
 */
export async function filterFindings(
  findings: Finding[],
  targetDir: string,
  options: JudgeOptions = {},
): Promise<{ confirmed: Finding[]; dismissed: Finding[]; needsReview: Finding[] }> {
  const confirmed: Finding[] = [];
  const dismissed: Finding[] = [];
  const needsReview: Finding[] = [];

  for (const finding of findings) {
    const verdict = await judge(finding, targetDir, options);

    if (verdict.verdict === 'true_positive') {
      confirmed.push(finding);
    } else if (verdict.verdict === 'false_positive') {
      dismissed.push(finding);
    } else {
      needsReview.push(finding);
    }
  }

  return { confirmed, dismissed, needsReview };
}
