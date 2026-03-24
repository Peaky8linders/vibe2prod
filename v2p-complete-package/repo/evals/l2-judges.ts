/**
 * evals/l2-judges.ts — LLM binary judges per defect category
 *
 * READ-ONLY TO AGENT.
 *
 * Each judge evaluates a specific defect category with a binary pass/fail.
 * Judge prompts are loaded from l2_judge_prompts/ directory.
 * Pass rate threshold is configurable per dimension (default: 0.85).
 *
 * Judges are validated against human labels in evals/gold-labels.json.
 * Track precision + recall separately — raw agreement is misleading.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeResult {
  defect_id: string;
  judge: string;
  passed: boolean;
  reasoning: string;
}

export interface L2Result {
  passed: boolean;
  pass_rate: number;
  results: JudgeResult[];
  threshold: number;
}

interface JudgeExample {
  input: string;
  critique: string;
  outcome: "pass" | "fail";
}

interface JudgePrompt {
  id: string;
  dimension: string;
  question: string;
  pass_criteria: string;
  file_glob: string;
  examples?: JudgeExample[];
}

interface JudgeCallResult {
  passed: boolean;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Judge Prompt Loading
// ---------------------------------------------------------------------------

function loadJudgePrompts(): JudgePrompt[] {
  const promptDir = join(__dirname, "l2_judge_prompts");
  if (!existsSync(promptDir)) {
    console.warn("[l2-judges] No judge prompts found in l2_judge_prompts/");
    return [];
  }

  const files = readdirSync(promptDir).filter((f) => f.endsWith(".json"));
  const prompts: JudgePrompt[] = [];

  for (const file of files) {
    const content = JSON.parse(readFileSync(join(promptDir, file), "utf-8")) as JudgePrompt;
    prompts.push(content);
  }

  return prompts;
}

// ---------------------------------------------------------------------------
// LLM Judge Invocation
// ---------------------------------------------------------------------------

async function callJudge(
  prompt: JudgePrompt,
  fileContent: string,
  filePath: string
): Promise<JudgeCallResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    // Fallback: pattern-based heuristic judge (no LLM)
    return heuristicJudge(prompt, fileContent, filePath);
  }

  // Critique-before-verdict: judge writes reasoning BEFORE declaring pass/fail
  // This reduces anchoring bias (Hamel Husain's methodology)
  const systemPrompt = `You are a production readiness judge. You evaluate code against a specific criterion and return a binary pass/fail judgment.

IMPORTANT: Write your critique FIRST, then declare the outcome. This prevents anchoring bias.

You MUST respond with ONLY a JSON object in this exact format:
{"critique": "detailed reasoning about what you observed", "outcome": "pass" or "fail"}

No other text. No markdown. No preamble.`;

  // Build few-shot examples section if available
  let examplesSection = "";
  if (prompt.examples && prompt.examples.length > 0) {
    examplesSection = "\n## Example Evaluations\n";
    for (const ex of prompt.examples) {
      examplesSection += `\n<example>\n<input>\n${ex.input}\n</input>\n<evaluation>\n{"critique": "${ex.critique.replace(/"/g, '\\"')}", "outcome": "${ex.outcome}"}\n</evaluation>\n</example>\n`;
    }
  }

  const userPrompt = `## Criterion
${prompt.question}

## Pass Criteria
${prompt.pass_criteria}
${examplesSection}
## File: ${filePath}
\`\`\`
${fileContent.slice(0, 8000)}
\`\`\`

Write your critique of this file against the criterion, then declare pass or fail. Return ONLY the JSON.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      critique?: string;
      outcome?: string;
      passed?: boolean;
      reasoning?: string;
    };

    // Support both new (critique/outcome) and legacy (passed/reasoning) formats
    const passed = parsed.outcome !== undefined
      ? parsed.outcome === "pass"
      : Boolean(parsed.passed);
    const reasoning = parsed.critique ?? parsed.reasoning ?? "no reasoning";

    return { passed, reasoning: String(reasoning) };
  } catch (err) {
    console.warn(`[l2-judges] LLM call failed for ${prompt.id}, falling back to heuristic:`, err);
    return heuristicJudge(prompt, fileContent, filePath);
  }
}

// ---------------------------------------------------------------------------
// Heuristic Fallback (no API key)
// ---------------------------------------------------------------------------

function heuristicJudge(
  prompt: JudgePrompt,
  fileContent: string,
  _filePath: string
): JudgeCallResult {
  const dimension = prompt.dimension.toLowerCase();

  if (dimension.includes("error")) {
    const hasTryCatch = /try\s*\{/.test(fileContent);
    const hasCatchClause = /catch\s*\(/.test(fileContent);
    const hasGenericCatch = /catch\s*\(\s*\w+\s*\)\s*\{[\s\n]*\}/.test(fileContent);

    if (!hasTryCatch || !hasCatchClause) {
      return { passed: false, reasoning: "No try/catch blocks found in file" };
    }
    if (hasGenericCatch) {
      return { passed: false, reasoning: "Empty catch blocks detected — errors are swallowed" };
    }
    return { passed: true, reasoning: "Error handling patterns detected" };
  }

  if (dimension.includes("validation") || dimension.includes("input")) {
    const hasZod = /z\.(string|number|object|array|boolean)/.test(fileContent);
    const hasPydantic = /BaseModel|Field\(/.test(fileContent);
    const hasManualValidation = /typeof\s+\w+\s*[!=]==/.test(fileContent);

    if (hasZod || hasPydantic || hasManualValidation) {
      return { passed: true, reasoning: "Input validation patterns detected" };
    }
    return { passed: false, reasoning: "No input validation found" };
  }

  if (dimension.includes("observ") || dimension.includes("log")) {
    const hasStructuredLog = /logger\.\w+|log\.\w+|winston|pino|bunyan/.test(fileContent);
    if (hasStructuredLog) {
      return { passed: true, reasoning: "Structured logging detected" };
    }
    return { passed: false, reasoning: "No structured logging found" };
  }

  if (dimension.includes("security") || dimension.includes("auth")) {
    const hasAuth = /auth|authenticate|authorize|middleware|jwt|bearer/i.test(fileContent);
    if (hasAuth) {
      return { passed: true, reasoning: "Auth patterns detected" };
    }
    return { passed: false, reasoning: "No authentication patterns found" };
  }

  // Default: pass with warning
  return { passed: true, reasoning: `Heuristic judge: no specific check for dimension "${dimension}"` };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runL2Judges(threshold = 0.85): Promise<L2Result> {
  const prompts = loadJudgePrompts();

  if (prompts.length === 0) {
    console.warn("[l2-judges] No judge prompts configured. L2 passes by default.");
    return { passed: true, pass_rate: 1.0, results: [], threshold };
  }

  const results: JudgeResult[] = [];

  for (const prompt of prompts) {
    const files = await glob(prompt.file_glob, {
      ignore: ["**/node_modules/**", "**/dist/**"],
    });

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const judgment = await callJudge(prompt, content, file);

      results.push({
        defect_id: prompt.id,
        judge: prompt.dimension,
        passed: judgment.passed,
        reasoning: judgment.reasoning,
      });
    }
  }

  const passCount = results.filter((r) => r.passed).length;
  const pass_rate = results.length > 0 ? passCount / results.length : 1.0;

  return {
    passed: pass_rate >= threshold,
    pass_rate: Math.round(pass_rate * 1000) / 1000,
    results,
    threshold,
  };
}
