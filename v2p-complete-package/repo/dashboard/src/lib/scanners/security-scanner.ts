/**
 * scanners/security-scanner.ts — Deep security pattern scanner
 *
 * Detects OWASP Top 10 patterns, unsafe deserialization, path traversal,
 * SSRF, prototype pollution, and other security anti-patterns.
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

function createIdGen() {
  let counter = 0;
  return () => { counter++; return `SECSCAN-${String(counter).padStart(3, "0")}`; };
}

function scan(filePath: string, content: string, language: string): FileDefect[] {
  const nextId = createIdGen();
  const defects: FileDefect[] = [];
  const lines = content.split("\n");
  const isTest = /\.test\.|\.spec\.|__tests__|tests[/\\]|conftest/.test(filePath);
  if (isTest) return defects;

  const isTsJs = language === "typescript" || language === "javascript";
  const isPython = language === "python";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // --- Path Traversal ---
    if (isTsJs && /(?:readFile|createReadStream|readdir|access|stat|unlink|writeFile)\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 5, lines.length)).join("\n");
      if (/(?:req\.|request\.|params\.|query\.|body\.)/.test(context) && !/(?:path\.resolve|path\.join|sanitize|normalize|\.replace\(|allowlist|whitelist)/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P0", line: lineNum, description: "Potential path traversal — user input in filesystem operation", fix_hint: "Use path.resolve() with a root directory and validate against base path." });
      }
    }

    // --- SSRF ---
    if (isTsJs && /(?:fetch|axios|http\.get|https\.get|request)\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      if (/(?:req\.|request\.|params\.|query\.|body\.|url\s*[:=])/.test(context) && !/(?:allowlist|whitelist|ALLOWED_|validateUrl|isAllowed)/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "Potential SSRF — user-controlled URL in server-side request", fix_hint: "Validate URL against an allowlist of permitted hosts." });
      }
    }

    // --- Prototype pollution ---
    if (isTsJs && /Object\.assign\s*\(\s*\{/.test(line)) {
      const context = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      if (/(?:req\.body|req\.query|request\.body|\.\.\.body|\.\.\.query)/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "Prototype pollution risk — Object.assign with user input", fix_hint: "Use a schema validator (Zod) to strip unexpected keys." });
      }
    }

    // --- Unsafe regex (ReDoS) ---
    if (isTsJs && /new RegExp\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 2, lines.length)).join(" ");
      if (/(?:req\.|request\.|params\.|query\.|body\.|user)/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "ReDoS risk — user input in RegExp constructor", fix_hint: "Sanitize or escape user input before constructing regex." });
      }
    }

    // --- Command injection ---
    if (isTsJs && /(?:exec|execSync|spawn|spawnSync|execFile)\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      if (/(?:req\.|request\.|params\.|query\.|body\.)/.test(context) || /\$\{/.test(line)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P0", line: lineNum, description: "Command injection — user input in shell execution", fix_hint: "Use execFile with explicit args array, never string interpolation." });
      }
    }
    if (isPython && /(?:os\.system|subprocess\.call|subprocess\.Popen|os\.popen)\s*\(/.test(line)) {
      if (/f['"]|\.format\(|%\s/.test(line)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P0", line: lineNum, description: "Command injection — string interpolation in shell command", fix_hint: "Use subprocess.run() with a list of args and shell=False." });
      }
    }

    // --- Unsafe JWT ---
    if (isTsJs && /jwt\.verify\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
      if (/algorithms\s*:\s*\[.*none/i.test(context) || !/algorithms/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "JWT verification without explicit algorithm constraint", fix_hint: "Always specify algorithms: ['HS256'] or ['RS256'] in jwt.verify options." });
      }
    }

    // --- Unsafe deserialization ---
    if (isTsJs && /JSON\.parse\s*\(/.test(line)) {
      const context = lines.slice(Math.max(0, i - 3), Math.min(i + 3, lines.length)).join(" ");
      if (/(?:req\.body|request\.body|readFile|readStream|Buffer)/.test(context) && !/(?:try|catch|schema|validate|parse|safeParse)/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P2", line: lineNum, description: "JSON.parse on untrusted input without error handling", fix_hint: "Wrap in try/catch and validate shape with Zod." });
      }
    }

    // --- Missing helmet/security headers ---
    if (isTsJs && /app\s*=\s*express\(\)/.test(line)) {
      if (!/helmet/.test(content)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "Express app without helmet security headers", fix_hint: "Add app.use(helmet()) for security headers." });
      }
    }

    // --- Insecure cookie ---
    if (isTsJs && /cookie\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 8, lines.length)).join(" ");
      if (!/httpOnly\s*:\s*true/.test(context) || !/secure\s*:\s*true/.test(context)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "Cookie set without httpOnly or secure flags", fix_hint: "Set httpOnly: true, secure: true, sameSite: 'strict'." });
      }
    }

    // --- Python: unsafe yaml loading ---
    if (isPython && /yaml\.load\s*\(/.test(line) && !/Loader\s*=/.test(line)) {
      defects.push({ id: nextId(), dimension: "security", priority: "P0", line: lineNum, description: "yaml.load() without Loader — arbitrary code execution risk", fix_hint: "Use yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader)." });
    }

    // --- Python: SQL injection ---
    if (isPython && /(?:execute|executemany|cursor\.)/.test(line)) {
      if (/f['"]|\.format\(|%\s/.test(line) && /(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line)) {
        defects.push({ id: nextId(), dimension: "security", priority: "P0", line: lineNum, description: "SQL injection — string formatting in query", fix_hint: "Use parameterized queries with %s placeholders." });
      }
    }

    // --- Exposed debug mode ---
    if (/DEBUG\s*[:=]\s*(?:true|True|1|'1'|"1")/.test(line) && !/test|dev|local/.test(filePath)) {
      defects.push({ id: nextId(), dimension: "security", priority: "P2", line: lineNum, description: "Debug mode enabled — may expose sensitive information", fix_hint: "Use environment variable and default to false in production." });
    }
  }

  // File-level checks
  if (isTsJs && /express/.test(content) && /app\.listen/.test(content)) {
    if (!/(?:trust\s*proxy|trustProxy)/.test(content) && /req\.ip|req\.hostname/.test(content)) {
      defects.push({ id: nextId(), dimension: "security", priority: "P2", line: null, description: "Express app reads IP/hostname without trust proxy configuration", fix_hint: "Set app.set('trust proxy', ...) if behind a reverse proxy." });
    }
  }

  return defects;
}

export const securityScanner: ScannerPlugin = {
  name: "security",
  dimensions: ["security"],
  scan,
};
