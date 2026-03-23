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

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface InjectionPattern {
  id: string;
  owaspId: string;
  category: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  regex: RegExp;
  remediation: string;
  standard_refs: string[];
  auto_fixable: boolean;
  /** Optional second-pass regex the same line must also match (AND logic). */
  contextRegex?: RegExp;
}

// LLM01 — Prompt Injection
const LLM01_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM01',
    owaspId: 'OWASP-LLM01',
    category: 'prompt-injection',
    severity: 'P0',
    title: 'User input interpolated into prompt template',
    description:
      'Template literal with user-controlled variable interpolated directly into a prompt string. An attacker can inject instructions that override the system prompt.',
    regex: /(?:prompt|message|system|content|instruction|context)\s*(?:[:=]|[+=])\s*`[^`]*\$\{(?!(?:Date|Math|JSON|Number|String|Boolean|process\.env)\b)[^}]+\}/,
    remediation:
      'Separate system instructions from user content using the messages array. Pass user input as a distinct "user" role message:\n' +
      '  messages: [\n' +
      '    { role: "system", content: SYSTEM_PROMPT },\n' +
      '    { role: "user", content: sanitize(userInput) }\n' +
      '  ]',
    standard_refs: ['OWASP-LLM01', 'CWE-77', 'CWE-94'],
    auto_fixable: true,
  },
  {
    id: 'LLM01',
    owaspId: 'OWASP-LLM01',
    category: 'prompt-injection',
    severity: 'P0',
    title: 'String concatenation in prompt construction',
    description:
      'User input concatenated into a prompt string via the + operator. This allows prompt injection attacks.',
    regex: /(?:prompt|message|system|content|instruction)\s*(?:[:=]|[+=])\s*['"][^'"]*['"]\s*\+\s*(?!['"])\w/,
    remediation:
      'Never concatenate user input into prompt strings. Use parameterized prompt templates with explicit input boundaries:\n' +
      '  const prompt = promptTemplate.format({ user_query: sanitize(input) });',
    standard_refs: ['OWASP-LLM01', 'CWE-77'],
    auto_fixable: true,
  },
  {
    id: 'LLM01',
    owaspId: 'OWASP-LLM01',
    category: 'prompt-injection',
    severity: 'P0',
    title: 'Python f-string used in prompt construction',
    description:
      'Python f-string with variable interpolation used to build a prompt. User-controlled values may override LLM instructions.',
    regex: /(?:prompt|message|system|content|instruction)\s*=\s*f['"][^'"]*\{(?!(?:len|str|int|float|repr|os\.environ)\b)[^}]+\}/,
    remediation:
      'Use the messages API with separate roles instead of string formatting:\n' +
      '  messages=[\n' +
      '    {"role": "system", "content": SYSTEM_PROMPT},\n' +
      '    {"role": "user", "content": sanitize(user_input)}\n' +
      '  ]',
    standard_refs: ['OWASP-LLM01', 'CWE-77', 'CWE-94'],
    auto_fixable: true,
  },
  {
    id: 'LLM01',
    owaspId: 'OWASP-LLM01',
    category: 'prompt-injection',
    severity: 'P0',
    title: 'Python .format() used in prompt construction',
    description:
      'Python .format() with user-controlled variables used to build a prompt string.',
    regex: /(?:prompt|message|system|content|instruction)\s*=\s*['"][^'"]*\{[^}]*\}[^'"]*['"]\.format\(/,
    remediation:
      'Use parameterized prompt templates with input validation and the messages API rather than string formatting.',
    standard_refs: ['OWASP-LLM01', 'CWE-77'],
    auto_fixable: true,
  },
  {
    id: 'LLM01',
    owaspId: 'OWASP-LLM01',
    category: 'prompt-injection',
    severity: 'P0',
    title: 'Missing input validation before LLM API call',
    description:
      'User input passed directly to an LLM API call (openai, anthropic, etc.) without visible sanitization or validation on the same line or in adjacent context.',
    regex: /(?:openai|anthropic|ai|llm|chat|completion|generate)\.\w*(?:create|complete|generate|send|chat|message)\s*\(/,
    contextRegex: /(?:user_?input|user_?message|req\.body|request\.body|params\.|query\.|input\b)/,
    remediation:
      'Validate and sanitize all user input before passing to LLM APIs:\n' +
      '  const sanitized = validateInput(userInput, { maxLength: 4096, allowedChars: /^[\\w\\s.,!?]+$/ });\n' +
      '  await llm.chat({ messages: [{ role: "user", content: sanitized }] });',
    standard_refs: ['OWASP-LLM01', 'CWE-20'],
    auto_fixable: true,
  },
];

// LLM02 — Insecure Output Handling
const LLM02_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'eval() called on LLM response',
    description:
      'LLM output passed to eval(), allowing arbitrary code execution. An attacker can use prompt injection to produce malicious code.',
    regex: /\beval\s*\(\s*(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Never eval() LLM output. Use a sandboxed parser (e.g., JSON.parse for structured data, a safe expression evaluator for math):\n' +
      '  const parsed = JSON.parse(llmOutput); // for JSON\n' +
      '  const result = safeEval(llmOutput, { timeout: 1000 }); // for expressions',
    standard_refs: ['OWASP-LLM02', 'CWE-95', 'CWE-94'],
    auto_fixable: false,
  },
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'Function() constructor called on LLM response',
    description:
      'LLM output passed to new Function(), enabling arbitrary code execution.',
    regex: /new\s+Function\s*\(\s*(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Never use Function() with LLM output. Parse structured data with JSON.parse or use a sandboxed interpreter.',
    standard_refs: ['OWASP-LLM02', 'CWE-95', 'CWE-94'],
    auto_fixable: false,
  },
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'exec/execSync with LLM output',
    description:
      'LLM response passed to exec() or execSync(), enabling shell command injection.',
    regex: /(?:exec|execSync|spawn|spawnSync|execFile)\s*\(\s*(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Never pass LLM output to shell execution. If command execution is required, use a strict allow-list of commands and validate arguments:\n' +
      '  const allowed = ["ls", "cat"];\n' +
      '  if (!allowed.includes(parsedCommand)) throw new Error("Disallowed command");',
    standard_refs: ['OWASP-LLM02', 'CWE-78', 'CWE-77'],
    auto_fixable: false,
  },
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'Python exec()/os.system() with LLM output',
    description:
      'LLM response passed to Python exec(), os.system(), or subprocess without sanitization.',
    regex: /(?:exec|os\.system|subprocess\.(?:call|run|Popen|check_output))\s*\(\s*(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Never pass LLM output to exec() or subprocess. Use structured output parsing and an allow-list approach for any required actions.',
    standard_refs: ['OWASP-LLM02', 'CWE-78', 'CWE-94'],
    auto_fixable: false,
  },
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'innerHTML/dangerouslySetInnerHTML with LLM response',
    description:
      'LLM output rendered as raw HTML, enabling XSS attacks via prompt injection.',
    regex: /(?:innerHTML|dangerouslySetInnerHTML)\s*=\s*(?:\{\s*__html\s*:\s*)?(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Always sanitize LLM output before rendering as HTML:\n' +
      '  import DOMPurify from "dompurify";\n' +
      '  element.innerHTML = DOMPurify.sanitize(llmOutput);',
    standard_refs: ['OWASP-LLM02', 'CWE-79'],
    auto_fixable: true,
  },
  {
    id: 'LLM02',
    owaspId: 'OWASP-LLM02',
    category: 'insecure-output-handling',
    severity: 'P0',
    title: 'LLM output used in SQL query',
    description:
      'LLM response interpolated into an SQL query string, enabling SQL injection.',
    regex: /(?:query|sql|execute|raw)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)\s*(?:response|result|output|completion|answer|generated|reply|content|text|message|data)\b/,
    remediation:
      'Never interpolate LLM output into SQL. Use parameterized queries:\n' +
      '  db.query("SELECT * FROM items WHERE category = $1", [sanitize(llmOutput)]);',
    standard_refs: ['OWASP-LLM02', 'CWE-89'],
    auto_fixable: false,
  },
];

// LLM03 — Training Data Poisoning
const LLM03_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM03',
    owaspId: 'OWASP-LLM03',
    category: 'training-data-poisoning',
    severity: 'P2',
    title: 'Training data loaded from untrusted URL without validation',
    description:
      'Data for fine-tuning or training loaded from a URL without integrity verification (hash/checksum).',
    regex: /(?:fine[_-]?tun|train|dataset|data[_-]?load|fetch[_-]?data)\w*\s*(?:\(|=)\s*(?:fetch|axios|requests?\.get|urllib|http\.get|download)\s*\(/,
    remediation:
      'Verify integrity of training data with checksums:\n' +
      '  const hash = crypto.createHash("sha256").update(data).digest("hex");\n' +
      '  if (hash !== EXPECTED_HASH) throw new Error("Training data integrity check failed");',
    standard_refs: ['OWASP-LLM03', 'CWE-494', 'CWE-345'],
    auto_fixable: false,
  },
  {
    id: 'LLM03',
    owaspId: 'OWASP-LLM03',
    category: 'training-data-poisoning',
    severity: 'P2',
    title: 'User-uploaded data used directly for fine-tuning',
    description:
      'User-uploaded files or data fed directly into model fine-tuning without validation or sanitization.',
    regex: /(?:fine[_-]?tun|train|upload)\w*.*(?:req\.file|req\.body|upload|multipart|formData)/,
    contextRegex: /(?:fine[_-]?tun|train|model|dataset)/,
    remediation:
      'Validate and sanitize all user-uploaded training data. Implement content filtering, format validation, and human review:\n' +
      '  const validated = await validateTrainingData(uploadedFile, { maxSize, allowedFormats, contentFilter: true });',
    standard_refs: ['OWASP-LLM03', 'CWE-20', 'CWE-434'],
    auto_fixable: false,
  },
];

// LLM06 — Sensitive Information Disclosure
const LLM06_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM06',
    owaspId: 'OWASP-LLM06',
    category: 'sensitive-info-disclosure',
    severity: 'P1',
    title: 'API key or secret embedded in system prompt',
    description:
      'System prompt or LLM context contains references to API keys, secrets, passwords, or tokens. These may be extractable via prompt injection.',
    regex: /(?:system|role\s*:\s*['"]system['"])[^;]*(?:key|secret|password|token|credential|api[_-]?key|auth)\s*(?:[:=]|is\b)/i,
    remediation:
      'Never include secrets in system prompts. Use server-side tool execution with secrets injected at runtime:\n' +
      '  // BAD: system prompt with "Use API key: sk-abc123"\n' +
      '  // GOOD: tool function that reads key from env at execution time\n' +
      '  function callApi() { const key = process.env.API_KEY; ... }',
    standard_refs: ['OWASP-LLM06', 'CWE-200', 'CWE-522'],
    auto_fixable: false,
  },
  {
    id: 'LLM06',
    owaspId: 'OWASP-LLM06',
    category: 'sensitive-info-disclosure',
    severity: 'P1',
    title: 'Database credentials in prompt context',
    description:
      'Database connection strings or credentials included in LLM prompt context.',
    regex: /(?:prompt|system|message|content|context)\s*(?:[:=`]|[+=]).*(?:mongodb|postgres|mysql|redis|jdbc|connection[_-]?string)\s*[:=]/i,
    remediation:
      'Remove all database credentials from LLM context. Use server-side database access through tools that read credentials from environment variables.',
    standard_refs: ['OWASP-LLM06', 'CWE-200', 'CWE-798'],
    auto_fixable: false,
  },
  {
    id: 'LLM06',
    owaspId: 'OWASP-LLM06',
    category: 'sensitive-info-disclosure',
    severity: 'P1',
    title: 'Internal URL or endpoint in system prompt',
    description:
      'Internal infrastructure URLs or private endpoints exposed in LLM system prompts, extractable via prompt injection.',
    regex: /(?:system|role\s*:\s*['"]system['"])[^;]*(?:https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|internal|private|staging|admin))/i,
    remediation:
      'Never expose internal URLs in system prompts. Use abstracted tool names that resolve to endpoints server-side:\n' +
      '  // BAD: "You can access the user DB at http://internal-db:5432"\n' +
      '  // GOOD: Define a "lookup_user" tool that handles routing internally',
    standard_refs: ['OWASP-LLM06', 'CWE-200', 'CWE-918'],
    auto_fixable: false,
  },
];

// LLM07 — Insecure Plugin Design
const LLM07_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM07',
    owaspId: 'OWASP-LLM07',
    category: 'insecure-plugin-design',
    severity: 'P1',
    title: 'Tool/function with dangerous capability defined',
    description:
      'An LLM tool or function definition grants dangerous capabilities such as SQL execution, shell commands, file deletion, or file writing without apparent safeguards.',
    regex: /(?:function[_-]?(?:call|def)|tool|plugin|action)\s*(?:[:={\[]|\.define|\.register).*(?:execute[_-]?sql|run[_-]?(?:command|shell|query)|delete[_-]?file|write[_-]?file|rm[_-]?rf|drop[_-]?table|exec[_-]?command)/i,
    remediation:
      'Apply least-privilege to LLM tools. Add input validation, allow-lists, and confirmation steps:\n' +
      '  tools: [{\n' +
      '    name: "query_db",\n' +
      '    execute: async (params) => {\n' +
      '      validateParams(params, allowedSchema);\n' +
      '      return db.query(ALLOWED_QUERIES[params.queryName], params.values);\n' +
      '    }\n' +
      '  }]',
    standard_refs: ['OWASP-LLM07', 'CWE-250', 'CWE-732'],
    auto_fixable: false,
  },
  {
    id: 'LLM07',
    owaspId: 'OWASP-LLM07',
    category: 'insecure-plugin-design',
    severity: 'P1',
    title: 'Tool with broad filesystem or network access',
    description:
      'LLM tool defined with unrestricted filesystem read/write or network access without path/URL constraints.',
    regex: /(?:function[_-]?(?:call|def)|tool|plugin|action)\s*(?:[:={\[]|\.define|\.register).*(?:read[_-]?file|write[_-]?file|fetch[_-]?url|http[_-]?request|file[_-]?system|fs\.|net\.|network)/i,
    remediation:
      'Restrict tool access to specific directories and domains:\n' +
      '  const ALLOWED_PATHS = ["/data/public/"];\n' +
      '  const ALLOWED_DOMAINS = ["api.example.com"];\n' +
      '  function validatePath(p) { if (!ALLOWED_PATHS.some(a => p.startsWith(a))) throw new Error("Access denied"); }',
    standard_refs: ['OWASP-LLM07', 'CWE-732', 'CWE-22'],
    auto_fixable: false,
  },
];

// LLM08 — Excessive Agency
const LLM08_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM08',
    owaspId: 'OWASP-LLM08',
    category: 'excessive-agency',
    severity: 'P1',
    title: 'Auto-execution of LLM-generated code',
    description:
      'LLM output is automatically executed as code without human confirmation or sandboxing.',
    regex: /(?:eval|exec|Function|vm\.run|runInContext|compile)\s*\(\s*(?:(?:await\s+)?(?:\w+\.)*(?:generate|complete|create|chat|send|ask|prompt)\s*\(|response|result|output|completion|answer|generated)\b/,
    remediation:
      'Never auto-execute LLM-generated code. Use a sandboxed environment with human-in-the-loop confirmation:\n' +
      '  const code = await llm.generate(prompt);\n' +
      '  const approved = await requireHumanApproval(code);\n' +
      '  if (approved) sandbox.run(code, { timeout: 5000, permissions: [] });',
    standard_refs: ['OWASP-LLM08', 'CWE-94', 'CWE-250'],
    auto_fixable: false,
  },
  {
    id: 'LLM08',
    owaspId: 'OWASP-LLM08',
    category: 'excessive-agency',
    severity: 'P1',
    title: 'LLM with database write access without confirmation',
    description:
      'LLM tool has INSERT, UPDATE, or DELETE database access without a human confirmation gate.',
    regex: /(?:tool|function|plugin).*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\s/i,
    contextRegex: /(?:tool|function[_-]?call|plugin|action|agent)/i,
    remediation:
      'Require human confirmation for all database write operations triggered by LLM:\n' +
      '  async function dbWriteTool(params) {\n' +
      '    const confirmed = await requireConfirmation(`Write ${params.operation} to ${params.table}?`);\n' +
      '    if (!confirmed) return { error: "User denied operation" };\n' +
      '    return db.execute(params);\n' +
      '  }',
    standard_refs: ['OWASP-LLM08', 'CWE-250', 'CWE-862'],
    auto_fixable: false,
  },
];

// LLM09 — Overreliance
const LLM09_PATTERNS: InjectionPattern[] = [
  {
    id: 'LLM09',
    owaspId: 'OWASP-LLM09',
    category: 'overreliance',
    severity: 'P2',
    title: 'LLM output used for security-critical decision without human review',
    description:
      'LLM classification or analysis result used directly for security-critical actions (auth, access control, moderation) without human oversight.',
    regex: /(?:if|switch|case)\s*\(?\s*(?:(?:await\s+)?(?:\w+\.)*(?:classify|analyze|detect|moderate|verify|authenticate|authorize)\s*\(|(?:response|result|output|completion|answer)\.(?:classification|label|decision|verdict|action|category))/,
    contextRegex: /(?:admin|delete|block|ban|approve|allow|deny|grant|revoke|suspend|auth|security|permission|access)/i,
    remediation:
      'Add human-in-the-loop for security-critical LLM decisions:\n' +
      '  const llmVerdict = await llm.classify(content);\n' +
      '  if (llmVerdict.confidence < THRESHOLD) {\n' +
      '    await flagForHumanReview(content, llmVerdict);\n' +
      '    return; // Do not auto-act\n' +
      '  }',
    standard_refs: ['OWASP-LLM09', 'CWE-807'],
    auto_fixable: false,
  },
  {
    id: 'LLM09',
    owaspId: 'OWASP-LLM09',
    category: 'overreliance',
    severity: 'P2',
    title: 'Automated action triggered solely by LLM classification',
    description:
      'Automated workflow (email, notification, account action) triggered based solely on LLM output without verification.',
    regex: /(?:(?:await\s+)?(?:send|trigger|execute|dispatch|notify|email|slack|webhook)\s*\().*(?:response|result|output|completion|answer|generated|classification|label|decision)\b/,
    contextRegex: /(?:auto|automated|automatic|trigger|workflow|pipeline|cron|schedule)/i,
    remediation:
      'Never trigger automated actions based solely on LLM classification. Add confidence thresholds and human review:\n' +
      '  if (llmResult.action === "send_email" && llmResult.confidence > 0.95) {\n' +
      '    await queueForReview(llmResult); // human reviews before sending\n' +
      '  }',
    standard_refs: ['OWASP-LLM09', 'CWE-807', 'CWE-862'],
    auto_fixable: false,
  },
];

// ---------------------------------------------------------------------------
// All patterns combined
// ---------------------------------------------------------------------------

const ALL_PATTERNS: InjectionPattern[] = [
  ...LLM01_PATTERNS,
  ...LLM02_PATTERNS,
  ...LLM03_PATTERNS,
  ...LLM06_PATTERNS,
  ...LLM07_PATTERNS,
  ...LLM08_PATTERNS,
  ...LLM09_PATTERNS,
];

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  'vendor', '.terraform', '.gradle',
]);

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
]);

function shouldScanFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SCAN_EXTENSIONS.has(ext);
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        files.push(path.join(currentDir, entry.name));
      }
    }
  }

  walk(dir);
  return files;
}

// ---------------------------------------------------------------------------
// False positive filtering
// ---------------------------------------------------------------------------

function isLikelyFalsePositive(line: string, filePath: string): boolean {
  const trimmed = line.trim();

  // Skip comments that are documentation or examples
  if (/^\s*(\/\/|#|\/\*|\*)\s*(example|e\.g\.|TODO|FIXME|NOTE|test|@|see )/i.test(trimmed)) {
    return true;
  }

  // Skip test files with mock/fixture content
  if (/test|spec|mock|fixture|fake|dummy|__test__|__spec__/i.test(filePath)) {
    if (/(?:mock|fake|stub|fixture|sample|example|placeholder)/i.test(line)) {
      return true;
    }
  }

  // Skip type definitions and interfaces (no runtime behavior)
  if (/^\s*(?:type|interface|export\s+(?:type|interface))\s/.test(trimmed)) {
    return true;
  }

  // Skip import/require statements
  if (/^\s*(?:import\s|const\s+\w+\s*=\s*require\(|from\s)/.test(trimmed)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

function extractEvidence(line: string): string {
  const maxLen = 150;
  let evidence = line.trim();
  if (evidence.length > maxLen) {
    evidence = evidence.substring(0, maxLen) + '...';
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

let findingCounter = 0;

function createFinding(
  pattern: InjectionPattern,
  filePath: string,
  lineNumber: number,
  line: string,
  targetDir: string,
): Finding {
  findingCounter++;
  const relativeFile = path.relative(targetDir, filePath);
  return {
    id: `PINJ-${String(findingCounter).padStart(3, '0')}`,
    domain: 5,
    control_id: `MODEL-${pattern.id}`,
    severity: pattern.severity,
    category: pattern.category,
    title: pattern.title,
    description: pattern.description,
    file: relativeFile,
    line: lineNumber,
    evidence: extractEvidence(line),
    remediation: pattern.remediation,
    standard_refs: pattern.standard_refs,
    auto_fixable: pattern.auto_fixable,
  };
}

export async function scan(targetDir: string): Promise<Finding[]> {
  findingCounter = 0;
  const findings: Finding[] = [];
  const files = collectFiles(targetDir);

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isLikelyFalsePositive(line, filePath)) continue;

      // Build a small context window (current line + 2 lines before/after)
      // for contextRegex checks
      const contextStart = Math.max(0, i - 2);
      const contextEnd = Math.min(lines.length - 1, i + 2);
      const contextBlock = lines.slice(contextStart, contextEnd + 1).join('\n');

      for (const pattern of ALL_PATTERNS) {
        if (pattern.regex.test(line)) {
          // If the pattern has a contextRegex, the context window must also match
          if (pattern.contextRegex && !pattern.contextRegex.test(contextBlock)) {
            continue;
          }
          findings.push(createFinding(pattern, filePath, i + 1, line, targetDir));
          break; // One finding per line to avoid duplicates
        }
      }
    }
  }

  return findings;
}
