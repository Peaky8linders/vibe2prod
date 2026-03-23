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

interface InjectionPattern {
  name: string;
  regex: RegExp;
  severity: 'P0' | 'P1';
  category: string;
  control_id: string;
  description: string;
  remediation: string;
  standard_refs: string[];
  auto_fixable: boolean;
  /** Optional: multi-line context check — look at surrounding lines */
  contextCheck?: (lines: string[], lineIndex: number) => boolean;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // --- SQL Injection ---
  {
    name: 'SQL injection via template literal',
    regex: /(?:query|execute|exec|run|raw)\s*\(\s*`[^`]*\$\{[^}]*\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|WHERE|FROM|SET|VALUES)/i,
    severity: 'P0',
    category: 'sql-injection',
    control_id: 'INJ-001',
    description: 'SQL query built with template literal interpolation — user input may not be sanitized',
    remediation: 'Use parameterized queries or prepared statements. Never interpolate user input into SQL strings.',
    standard_refs: ['CWE-89', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'SQL injection via template literal (reverse order)',
    regex: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s+.*\$\{/i,
    severity: 'P0',
    category: 'sql-injection',
    control_id: 'INJ-001',
    description: 'SQL statement contains template literal interpolation',
    remediation: 'Use parameterized queries. Replace ${variable} with ? or $1 placeholders.',
    standard_refs: ['CWE-89', 'OWASP-A03:2021'],
    auto_fixable: true,
    contextCheck: (lines, idx) => {
      // Check if inside a template literal (backtick context)
      const line = lines[idx];
      return line.includes('`') || (idx > 0 && lines[idx - 1].includes('`'));
    },
  },
  {
    name: 'SQL injection via string concatenation',
    regex: /(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\s+.*['"]\s*\+\s*(?:req\.|request\.|params\.|query\.|body\.|args\.|input)/i,
    severity: 'P0',
    category: 'sql-injection',
    control_id: 'INJ-001',
    description: 'SQL query built with string concatenation from request input',
    remediation: 'Use parameterized queries. Never concatenate user input into SQL strings.',
    standard_refs: ['CWE-89', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'SQL injection via Python f-string',
    regex: /(?:cursor\.execute|\.execute)\s*\(\s*f['"]/i,
    severity: 'P0',
    category: 'sql-injection',
    control_id: 'INJ-001',
    description: 'SQL query uses Python f-string formatting — vulnerable to injection',
    remediation: 'Use parameterized queries with %s or ? placeholders instead of f-strings.',
    standard_refs: ['CWE-89', 'OWASP-A03:2021'],
    auto_fixable: true,
  },
  {
    name: 'SQL injection via .format()',
    regex: /(?:cursor\.execute|\.execute|\.query|\.raw)\s*\(\s*['"].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*['"]\.format\s*\(/i,
    severity: 'P0',
    category: 'sql-injection',
    control_id: 'INJ-001',
    description: 'SQL query uses .format() string interpolation — vulnerable to injection',
    remediation: 'Use parameterized queries instead of string formatting for SQL.',
    standard_refs: ['CWE-89', 'OWASP-A03:2021'],
    auto_fixable: true,
  },

  // --- Prompt Injection ---
  {
    name: 'Prompt injection — unsanitized user input in LLM prompt',
    regex: /(?:prompt|message|system[_-]?prompt|chat[_-]?message)\s*[:=]\s*(?:`[^`]*\$\{(?:req\.|request\.|body\.|params\.|query\.|input\.|user[_-]?input|message)|['"]\s*\+\s*(?:req\.|request\.|body\.|params\.|query\.|input\.|user[_-]?input|message))/i,
    severity: 'P0',
    category: 'prompt-injection',
    control_id: 'INJ-004',
    description: 'User input directly interpolated into LLM prompt without sanitization',
    remediation: 'Sanitize user input before including in prompts. Use structured prompt templates with clear system/user boundaries.',
    standard_refs: ['CWE-77', 'OWASP-LLM01'],
    auto_fixable: false,
  },
  {
    name: 'Prompt injection — user content in system message',
    regex: /(?:role|system)\s*[:=]\s*['"`]system['"`].*(?:content)\s*[:=]\s*(?:`[^`]*\$\{|['"]\s*\+\s*)(?:req\.|request\.|body\.|user|input)/i,
    severity: 'P0',
    category: 'prompt-injection',
    control_id: 'INJ-004',
    description: 'User-controlled input placed in system-role message for LLM',
    remediation: 'Never place user input in system messages. Use the user role for user-provided content.',
    standard_refs: ['CWE-77', 'OWASP-LLM01'],
    auto_fixable: false,
  },
  {
    name: 'Prompt injection — raw user input to LLM API',
    regex: /(?:openai|anthropic|ai|llm|chat|completion)\s*\.\s*(?:create|complete|chat|generate|invoke)\s*\([^)]*(?:req\.body|request\.body|params\.|query\.)/i,
    severity: 'P1',
    category: 'prompt-injection',
    control_id: 'INJ-004',
    description: 'Request body passed directly to LLM API call without sanitization',
    remediation: 'Validate and sanitize user input. Apply input length limits and content filtering before LLM calls.',
    standard_refs: ['CWE-77', 'OWASP-LLM01'],
    auto_fixable: false,
  },

  // --- Command Injection ---
  {
    name: 'Command injection via exec',
    regex: /(?:exec|execSync|child_process\.exec)\s*\(\s*(?:`[^`]*\$\{|['"]\s*\+\s*)(?:req\.|request\.|body\.|params\.|query\.|input|user)/i,
    severity: 'P0',
    category: 'command-injection',
    control_id: 'INJ-002',
    description: 'User input passed to shell exec — command injection vulnerability',
    remediation: 'Use execFile() or spawn() with argument arrays instead of exec(). Never pass user input to shell commands.',
    standard_refs: ['CWE-78', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'Command injection via spawn/execFile with shell',
    regex: /(?:spawn|execFile)\s*\([^)]*(?:shell\s*:\s*true)/i,
    severity: 'P1',
    category: 'command-injection',
    control_id: 'INJ-002',
    description: 'spawn/execFile called with shell:true — reduces injection protection',
    remediation: 'Remove shell:true option. Pass command arguments as array elements.',
    standard_refs: ['CWE-78', 'OWASP-A03:2021'],
    auto_fixable: true,
  },
  {
    name: 'Command injection via os.system / subprocess',
    regex: /(?:os\.system|os\.popen|subprocess\.call|subprocess\.run|subprocess\.Popen)\s*\(\s*(?:f['""]|['"].*['"]\s*(?:\+|\.format)|.*\%)/i,
    severity: 'P0',
    category: 'command-injection',
    control_id: 'INJ-002',
    description: 'User input may reach OS command execution via string formatting',
    remediation: 'Use subprocess with shell=False and pass arguments as a list. Validate and sanitize all input.',
    standard_refs: ['CWE-78', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'Command injection via eval',
    regex: /\beval\s*\(\s*(?:req\.|request\.|body\.|params\.|query\.|input|user)/i,
    severity: 'P0',
    category: 'command-injection',
    control_id: 'INJ-002',
    description: 'User input passed to eval() — code injection vulnerability',
    remediation: 'Never use eval() with user input. Use JSON.parse() for data or a sandboxed interpreter.',
    standard_refs: ['CWE-95', 'OWASP-A03:2021'],
    auto_fixable: false,
  },

  // --- XSS ---
  {
    name: 'XSS — unsanitized output in HTML',
    regex: /(?:innerHTML|outerHTML|document\.write|\.html\()\s*(?:=\s*|)\s*(?:req\.|request\.|body\.|params\.|query\.|input|user)/i,
    severity: 'P0',
    category: 'xss',
    control_id: 'INJ-003',
    description: 'User input written directly to HTML without sanitization — XSS vulnerability',
    remediation: 'Use textContent instead of innerHTML. Sanitize HTML with DOMPurify or similar library.',
    standard_refs: ['CWE-79', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'XSS — template literal in HTML response',
    regex: /(?:res\.send|res\.write)\s*\(\s*`[^`]*<[^>]*\$\{(?:req\.|request\.|body\.|params\.|query\.)/i,
    severity: 'P0',
    category: 'xss',
    control_id: 'INJ-003',
    description: 'User input interpolated into HTML response without encoding',
    remediation: 'Use a template engine with auto-escaping (EJS, Handlebars). Encode HTML entities.',
    standard_refs: ['CWE-79', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'XSS — dangerouslySetInnerHTML with user input',
    regex: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?:props\.|state\.|data\.|user|input|req)/i,
    severity: 'P0',
    category: 'xss',
    control_id: 'INJ-003',
    description: 'React dangerouslySetInnerHTML used with potentially unsanitized user input',
    remediation: 'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML. Prefer safe rendering methods.',
    standard_refs: ['CWE-79', 'OWASP-A03:2021'],
    auto_fixable: false,
  },
  {
    name: 'XSS — unescaped output in template',
    regex: /\{\{\{?\s*(?:user|input|query|body|params|request|data)\b.*\}?\}\}/i,
    severity: 'P1',
    category: 'xss',
    control_id: 'INJ-003',
    description: 'Unescaped variable in template — potential XSS if user-controlled',
    remediation: 'Use escaped output syntax ({{ }} not {{{ }}}). Sanitize user input before rendering.',
    standard_refs: ['CWE-79', 'OWASP-A03:2021'],
    auto_fixable: true,
  },

  // --- Path Traversal ---
  {
    name: 'Path traversal via user input',
    regex: /(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync|access|accessSync|stat|statSync|open|openSync)\s*\(\s*(?:req\.|request\.|body\.|params\.|query\.|`[^`]*\$\{(?:req\.|request\.|params\.|query\.))/i,
    severity: 'P0',
    category: 'path-traversal',
    control_id: 'INJ-005',
    description: 'User input used directly in filesystem operation — path traversal risk',
    remediation: 'Validate and sanitize file paths. Use path.resolve() and verify the result is within the allowed directory.',
    standard_refs: ['CWE-22', 'OWASP-A01:2021'],
    auto_fixable: false,
  },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  'vendor', '.terraform', '.gradle',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.rs', '.php',
  '.cs', '.kt', '.scala', '.swift',
  '.ejs', '.hbs', '.pug', '.jade', '.html',
]);

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
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          files.push(path.join(currentDir, entry.name));
        }
      }
    }
  }

  walk(dir);
  return files;
}

function extractEvidence(line: string): string {
  const maxLen = 150;
  let evidence = line.trim();
  if (evidence.length > maxLen) {
    evidence = evidence.substring(0, maxLen) + '...';
  }
  return evidence;
}

function extractContextEvidence(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  const context = lines.slice(start, end).map((l) => l.trim()).join(' | ');
  const maxLen = 200;
  return context.length > maxLen ? context.substring(0, maxLen) + '...' : context;
}

let findingCounter = 0;

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

    const relativeFile = path.relative(targetDir, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) {
        continue;
      }

      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.regex.test(line)) {
          // Apply context check if defined
          if (pattern.contextCheck && !pattern.contextCheck(lines, i)) {
            continue;
          }

          findingCounter++;
          findings.push({
            id: `INJ-${String(findingCounter).padStart(3, '0')}`,
            domain: 7,
            control_id: pattern.control_id,
            severity: pattern.severity,
            category: pattern.category,
            title: pattern.name,
            description: pattern.description,
            file: relativeFile,
            line: i + 1,
            evidence: pattern.contextCheck
              ? extractContextEvidence(lines, i)
              : extractEvidence(line),
            remediation: pattern.remediation,
            standard_refs: pattern.standard_refs,
            auto_fixable: pattern.auto_fixable,
          });
          break;
        }
      }
    }
  }

  return findings;
}
