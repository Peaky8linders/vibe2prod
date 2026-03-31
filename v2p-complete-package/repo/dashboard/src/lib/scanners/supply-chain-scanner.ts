/**
 * scanners/supply-chain-scanner.ts — Supply chain & dependency risk scanner
 *
 * Detects slopsquatting (hallucinated packages), suspicious dependencies,
 * unpinned versions, deprecated patterns, and supply chain attack vectors
 * specific to AI-generated code.
 *
 * Background: AI coding tools hallucinate package names that don't exist.
 * Attackers register these names on npm/PyPI with malicious payloads
 * ("slopsquatting"). This scanner catches the patterns before deployment.
 *
 * References:
 * - Georgia Tech Vibe Security Radar (74+ CVEs from AI-generated code)
 * - Tenzai study: 69 vulnerabilities across 5 AI coding tools
 * - Escape.tech: 2000+ vulns across 5600 vibe-coded apps
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

function createIdGen() {
  let counter = 0;
  return () => { counter++; return `SC-${String(counter).padStart(3, "0")}`; };
}

// ---------------------------------------------------------------------------
// Known suspicious / commonly hallucinated package name patterns
// ---------------------------------------------------------------------------

/**
 * Packages AI frequently hallucinates that either don't exist or are typosquats.
 * Last updated: 2026-03-31 — review quarterly against new slopsquatting reports.
 */
const KNOWN_HALLUCINATED_PACKAGES: Record<string, string> = {
  // npm — wrong-ecosystem packages AI puts in package.json
  "flask-cors": "Python package — wrong ecosystem if found in package.json",
  "djangorestframework": "Python package — wrong ecosystem if found in package.json",
  "mongo-express": "Admin panel — AI sometimes imports this as a library instead of mongodb driver",
  "huggingface": "Correct name is @huggingface/hub or @huggingface/inference — 'huggingface' alone is a typosquat risk",
  // PyPI — commonly hallucinated import-vs-package name confusion
  "beautifulsoup": "Correct name is beautifulsoup4 — 'beautifulsoup' is an outdated/different package",
  "cv2": "Correct name is opencv-python — 'cv2' is the import name, not the pip package",
  "yaml": "Correct name is PyYAML — 'yaml' alone may not resolve correctly",
};

/**
 * Packages with known security issues that AI still recommends.
 * Last updated: 2026-03-31 — review quarterly against npm advisory DB.
 */
const DEPRECATED_INSECURE: Record<string, string> = {
  "request": "Deprecated since 2020 — use node-fetch, axios, or undici",
  "node-uuid": "Deprecated — use uuid package instead",
  "nomnom": "Deprecated and unmaintained — use commander or yargs",
  "cryptiles": "Deprecated — use crypto built-in",
  "querystring": "Node.js built-in is deprecated — use URLSearchParams",
  "node-serialize": "Known RCE vulnerability (CVE-2017-5941) — use JSON.parse/stringify",
  "serialize-to-js": "Unsafe deserialization — use JSON instead",
  "event-stream": "Compromised in 2018 supply chain attack (flatmap-stream)",
  "colors": "Maintainer sabotaged in protest (v1.4.1+) — pin to 1.4.0",
  "faker": "Maintainer sabotaged — use @faker-js/faker instead",
  "ua-parser-js": "Compromised versions 0.7.29/0.8.0/1.0.0 — verify version",
  "coa": "Compromised version 2.0.3 — verify version",
  "rc": "Compromised version 1.2.9 — verify version",
};

/** Scope typosquatting patterns — attackers register @scope-name/pkg or @scopename/pkg */
const SUSPICIOUS_SCOPE_PATTERNS = [
  /^@[a-z]+-[a-z]+\//, // @some-scope/pkg — uncommon, often typosquat
  /^[a-z]+-js$/, // pkg-js naming — often hallucinated
  /^[a-z]+-node$/, // pkg-node naming — often hallucinated
];

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scan(filePath: string, content: string, language: string): FileDefect[] {
  const nextId = createIdGen();
  const defects: FileDefect[] = [];
  const lines = content.split("\n");
  const isTest = /\.test\.|\.spec\.|__tests__|tests[/\\]|conftest/.test(filePath);
  if (isTest) return defects;

  const isPackageJson = /package\.json$/.test(filePath);
  const isRequirements = /requirements.*\.txt$/.test(filePath);
  const isPipfile = /Pipfile$/.test(filePath);
  const isPyProjectToml = /pyproject\.toml$/.test(filePath);
  const isLockFile = /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(filePath);

  const isTsJs = language === "typescript" || language === "javascript";
  const isPython = language === "python";

  // =========================================================================
  // 1. DEPENDENCY FILE SCANNING (package.json, requirements.txt, etc.)
  // =========================================================================

  if (isPackageJson) {
    scanPackageJson(content, lines, defects, nextId);
    return defects; // package.json is fully handled by scanPackageJson
  }

  if (isRequirements || isPipfile || isPyProjectToml) {
    scanPythonDeps(content, lines, defects, nextId, filePath);
    return defects; // dependency files are fully handled by scanPythonDeps
  }

  // Skip lock files entirely — they're auto-generated
  if (isLockFile) return defects;

  // =========================================================================
  // 2. SOURCE FILE SCANNING — detect risky import/require patterns
  // =========================================================================

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (isTsJs) {
      // --- Dynamic require/import from user input ---
      if (/(?:require|import)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.|process\.argv|user)/.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P0", line: lineNum,
          description: "Dynamic require/import with user-controlled input — code injection risk",
          fix_hint: "Never use dynamic imports with user input. Use a whitelist/switch statement.",
        });
      }

      // --- eval() with require/import result ---
      if (/eval\s*\(\s*(?:require|import|fs\.read)/.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P0", line: lineNum,
          description: "eval() on dynamically loaded code — arbitrary code execution",
          fix_hint: "Remove eval(). Use structured data formats (JSON) instead of executable code.",
        });
      }

      // --- Importing from URL (CDN/remote) without integrity ---
      if (/(?:import|require)\s*\(\s*['"`]https?:\/\//.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
          description: "Importing module from remote URL — no integrity verification",
          fix_hint: "Install the package locally via npm. If remote import is required, add subresource integrity (SRI) hash.",
        });
      }

      // --- npm install with --ignore-scripts in CI ---
      if (/npm\s+install.*--ignore-scripts/.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P2", line: lineNum,
          description: "npm install with --ignore-scripts may skip important security setup",
          fix_hint: "Review whether ignored scripts include security-critical setup steps.",
        });
      }
    }

    if (isPython) {
      // --- Dynamic import with user input ---
      if (/__import__\s*\(/.test(line) || /importlib\.import_module\s*\(/.test(line)) {
        const context = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
        if (/(?:request|input|argv|user|body|query|param)/.test(context)) {
          defects.push({
            id: nextId(), dimension: "supply-chain", priority: "P0", line: lineNum,
            description: "Dynamic import with user-controlled input — arbitrary module loading",
            fix_hint: "Use a whitelist of allowed module names instead of dynamic import.",
          });
        }
      }

      // --- pip install from URL without hash verification ---
      if (/pip\s+install.*https?:\/\//.test(line) && !/#.*sha256/.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
          description: "pip install from URL without hash verification",
          fix_hint: "Add --hash=sha256:... to verify package integrity, or install from PyPI.",
        });
      }

      // --- subprocess running pip/npm install ---
      if (/(?:subprocess|os\.system|os\.popen).*(?:pip install|npm install)/.test(line)) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
          description: "Runtime package installation via subprocess — supply chain risk",
          fix_hint: "Install dependencies at build time, not runtime. Use requirements.txt or package.json.",
        });
      }
    }
  }

  return defects;
}

// ---------------------------------------------------------------------------
// package.json specific checks
// ---------------------------------------------------------------------------

function scanPackageJson(content: string, lines: string[], defects: FileDefect[], nextId: () => string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return; // Malformed JSON — not our problem
  }

  const allDeps: Record<string, string> = {
    ...(parsed.dependencies as Record<string, string> || {}),
    ...(parsed.devDependencies as Record<string, string> || {}),
  };

  for (const [pkg, version] of Object.entries(allDeps)) {
    const lineNum = findLineNumber(lines, pkg);

    // --- Known hallucinated packages ---
    if (KNOWN_HALLUCINATED_PACKAGES[pkg]) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
        description: `Potentially hallucinated package "${pkg}" — ${KNOWN_HALLUCINATED_PACKAGES[pkg]}`,
        fix_hint: `Verify "${pkg}" exists on npmjs.com and is the intended package. AI tools frequently hallucinate package names.`,
      });
    }

    // --- Known deprecated/insecure packages ---
    if (DEPRECATED_INSECURE[pkg]) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
        description: `Deprecated/insecure package "${pkg}" — ${DEPRECATED_INSECURE[pkg]}`,
        fix_hint: `Replace "${pkg}" with its recommended alternative.`,
      });
    }

    // --- Wildcard or "latest" versions (high risk) ---
    if (typeof version === "string" && /^\*$|^latest$/.test(version)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P2", line: lineNum,
        description: `Wildcard dependency "${pkg}": "${version}" — accepts any version including compromised ones`,
        fix_hint: `Pin to exact version. Use npm shrinkwrap or package-lock.json for reproducible builds.`,
      });
    }

    // --- Unpinned range versions (^ or ~) in production deps ---
    if (typeof version === "string" && /^[\^~]/.test(version)) {
      const isProdDep = parsed.dependencies && pkg in (parsed.dependencies as Record<string, string>);
      if (isProdDep) {
        defects.push({
          id: nextId(), dimension: "supply-chain", priority: "P3", line: lineNum,
          description: `Range dependency "${pkg}": "${version}" — consider pinning for supply chain safety`,
          fix_hint: `Pin to exact version for maximum supply chain security. Lock files provide partial protection.`,
        });
      }
    }

    // --- Git/URL dependencies ---
    if (typeof version === "string" && /^(?:git|github|https?:\/\/|file:)/.test(version)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
        description: `Dependency "${pkg}" installed from URL/git — bypasses npm registry security checks`,
        fix_hint: `Install from npm registry if available. If git dep is required, pin to specific commit hash.`,
      });
    }

    // --- Suspicious scope patterns ---
    for (const pattern of SUSPICIOUS_SCOPE_PATTERNS) {
      if (pattern.test(pkg)) {
        // Only flag if the scope doesn't match well-known scopes
        const knownScopes = /^@(?:types|babel|eslint|typescript-eslint|next|vercel|supabase|stripe|testing-library|tanstack|trpc|auth|clerk|prisma|sentry|opentelemetry|aws-sdk|google-cloud|azure|huggingface|anthropic|langchain)\//;
        if (!knownScopes.test(pkg)) {
          defects.push({
            id: nextId(), dimension: "supply-chain", priority: "P3", line: lineNum,
            description: `Unusual scoped package "${pkg}" — verify this is the intended package and not a typosquat`,
            fix_hint: `Check npmjs.com for the package. Compare with the official library documentation.`,
          });
        }
        break;
      }
    }
  }

  // --- Lifecycle scripts (postinstall) — common supply chain attack vector ---
  for (let i = 0; i < lines.length; i++) {
    if (/["'](?:preinstall|postinstall|preuninstall|postuninstall)["']\s*:/.test(lines[i]!)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: i + 1,
        description: "Package has lifecycle scripts (postinstall) — common supply chain attack vector",
        fix_hint: "Audit the postinstall script. Consider using --ignore-scripts and running setup manually.",
      });
    }
  }

  // --- Check for overrideRegistry or custom registry ---
  const fullContent = content.toLowerCase();
  if (fullContent.includes('"registry"') && !fullContent.includes('registry.npmjs.org')) {
    const lineNum = findLineNumber(lines, "registry");
    defects.push({
      id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
      description: "Custom npm registry configured — packages may bypass official registry security",
      fix_hint: "Verify the custom registry is trusted. Use registry.npmjs.org for public packages.",
    });
  }
}

// ---------------------------------------------------------------------------
// Python dependency file checks
// ---------------------------------------------------------------------------

function scanPythonDeps(content: string, lines: string[], defects: FileDefect[], nextId: () => string, filePath: string) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = i + 1;

    // Skip comments and blank lines
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;

    // Extract package name (before any version specifier)
    const pkgMatch = line.match(/^([a-zA-Z0-9_-]+)/);
    if (!pkgMatch) continue;
    const pkg = pkgMatch[1]!.toLowerCase();

    // --- Known hallucinated Python packages ---
    if (KNOWN_HALLUCINATED_PACKAGES[pkg]) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
        description: `Potentially hallucinated package "${pkg}" — ${KNOWN_HALLUCINATED_PACKAGES[pkg]}`,
        fix_hint: `Verify "${pkg}" exists on pypi.org and is the intended package.`,
      });
    }

    // --- No version pinning in requirements.txt ---
    if (/requirements/.test(filePath) && /^[a-zA-Z0-9_-]+\s*$/.test(line)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P2", line: lineNum,
        description: `Unpinned Python dependency "${pkg}" — no version constraint`,
        fix_hint: `Pin to specific version: ${pkg}==X.Y.Z. Use pip freeze to capture current versions.`,
      });
    }

    // --- >= without upper bound ---
    if (/>=/.test(line) && !/</.test(line) && !/,/.test(line)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P3", line: lineNum,
        description: `Dependency "${pkg}" has >= without upper bound — may pull breaking/compromised versions`,
        fix_hint: `Add upper bound: ${pkg}>=X.Y,<Z.0 to prevent unexpected major version upgrades.`,
      });
    }

    // --- Installing from direct URL ---
    if (/https?:\/\//.test(line) && !/@/.test(line)) {
      defects.push({
        id: nextId(), dimension: "supply-chain", priority: "P1", line: lineNum,
        description: `Dependency installed from URL — bypasses PyPI security checks`,
        fix_hint: `Install from PyPI if available. If URL is required, add --hash for integrity verification.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLineNumber(lines: string[], searchTerm: string): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchTerm)) return i + 1;
  }
  return null;
}

export const supplyChainScanner: ScannerPlugin = {
  name: "supply-chain",
  dimensions: ["supply-chain"],
  scan,
};
