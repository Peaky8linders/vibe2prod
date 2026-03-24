/**
 * Shared scanning utilities — .gitignore parsing, comment detection,
 * placeholder filtering, and framework detection.
 *
 * Used by all Guardian scanners to reduce false positives.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Extended Skip Directories ──────────────────────────────────────

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  'vendor', '.terraform', '.gradle',
  // Added: build caches and output dirs
  '.vite', '.turbo', '.parcel-cache', '.cache', 'out',
  '.output', '.nuxt', '.svelte-kit', '.angular',
  'tmp', 'temp', '__generated__', '.eggs', '.pytest_cache',
]);

// ─── .gitignore Parsing ─────────────────────────────────────────────

/**
 * Parse .gitignore file and return a set of ignored relative paths.
 * Simple implementation: handles common patterns (dir/, *.ext, exact paths).
 * Does NOT handle negation (!) or complex glob patterns — those are rare in practice.
 */
export function parseGitignore(rootDir: string): Set<string> {
  const ignored = new Set<string>();
  const gitignorePath = path.join(rootDir, '.gitignore');

  if (!fs.existsSync(gitignorePath)) return ignored;

  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;

      // Normalize: remove trailing slashes, leading slashes
      const pattern = line.replace(/\/+$/, '').replace(/^\/+/, '');
      ignored.add(pattern);
    }
  } catch {
    // Can't read .gitignore — continue without it
  }

  return ignored;
}

/**
 * Check if a file path (relative to scan root) matches any gitignore pattern.
 */
export function isGitignored(relativePath: string, gitignorePatterns: Set<string>): boolean {
  if (gitignorePatterns.size === 0) return false;

  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  for (const pattern of gitignorePatterns) {
    // Directory name match (e.g., ".vite" matches "frontend/.vite/deps/foo.js")
    if (!pattern.includes('/') && !pattern.includes('*')) {
      if (parts.some(p => p === pattern)) return true;
    }
    // Path prefix match (e.g., "frontend/.vite" matches "frontend/.vite/deps/foo.js")
    if (normalized.startsWith(pattern + '/') || normalized === pattern) return true;
    // Glob extension match (e.g., "*.pyc")
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // ".pyc"
      if (normalized.endsWith(ext)) return true;
    }
  }

  return false;
}

// ─── Comment Detection ──────────────────────────────────────────────

/**
 * Check if a line is a comment in any common language.
 * Covers: //, #, /*, *, --, ;, %
 */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:\/\/|#|\/\*|\*|--|;|%|REM\b)/.test(trimmed);
}

// ─── Placeholder Detection ──────────────────────────────────────────

/** Known placeholder values that appear in example configs, docs, test fixtures */
const PLACEHOLDER_PATTERNS = [
  /\buser:pass(?:word)?\b/i,
  /\bchangeme\b/i,
  /\bplaceholder\b/i,
  /\bexample\b/i,
  /\bREPLACE[_-]?ME\b/i,
  /\byour[_-](?:api|key|secret|token|password)/i,
  /\bxxx+\b/i,
  /\bdummy\b/i,
  /\bfake[_-]?(?:key|secret|token|password)/i,
  /\btest[_-]?(?:key|secret|token|password)/i,
  /\b<[A-Z_]+>\b/,  // <TOKEN>, <API_KEY>, etc.
  /\$\{[A-Z_]+\}/,  // ${DATABASE_URL}, ${API_KEY}
  /\bFODNN7EXAMPLE\b/,  // AWS canonical placeholder
  /\bbPxRfiCYEXAMPLEKEY\b/,  // AWS canonical placeholder
];

/**
 * Check if a line contains obvious placeholder values (not real secrets).
 */
export function isPlaceholderValue(line: string): boolean {
  return PLACEHOLDER_PATTERNS.some(p => p.test(line));
}

/**
 * Check if a file path indicates it's a placeholder/example config.
 */
export function isExampleConfigFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return /\.example$|\.sample$|\.template$|\.dist$/.test(basename)
    || basename === '.env.example'
    || basename === '.env.sample'
    || basename === '.env.template';
}

// ─── Framework Detection ────────────────────────────────────────────

/**
 * Detect which web framework a file belongs to based on imports and patterns.
 */
export type Framework = 'express' | 'fastapi' | 'flask' | 'django' | 'unknown';

export function detectFramework(fileContent: string, filePath: string): Framework {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.py') {
    if (/from\s+fastapi\b|import\s+fastapi\b|FastAPI\s*\(/i.test(fileContent)) return 'fastapi';
    if (/from\s+flask\b|import\s+flask\b|Flask\s*\(/i.test(fileContent)) return 'flask';
    if (/from\s+django\b|import\s+django\b/i.test(fileContent)) return 'django';
  }

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    if (/require\s*\(\s*['"]express['"]\)|from\s+['"]express['"]/i.test(fileContent)) return 'express';
  }

  return 'unknown';
}

// ─── FastAPI Auth Detection ─────────────────────────────────────────

/** FastAPI dependency injection patterns that indicate auth is present */
const FASTAPI_AUTH_PATTERNS = [
  /Depends\s*\(\s*(?:get_current_user|get_current_active_user|get_current_admin|require_auth|check_auth|verify_token|authenticate)/i,
  /Security\s*\(/i,
  /OAuth2PasswordBearer\s*\(/i,
  /HTTPBearer\s*\(/i,
  /HTTPBasic\s*\(/i,
  /APIKeyHeader\s*\(/i,
  /APIKeyCookie\s*\(/i,
  /Depends\s*\(\s*\w*auth\w*\)/i,  // Depends(some_auth_func)
];

/**
 * Check if a FastAPI file has auth dependencies.
 * Looks at the file content for Depends(get_current_user) and similar patterns.
 */
export function hasFastAPIAuth(fileContent: string): boolean {
  return FASTAPI_AUTH_PATTERNS.some(p => p.test(fileContent));
}

/**
 * Check if a specific route line has a FastAPI auth dependency inline.
 * FastAPI auth is typically in function params, not the decorator.
 * We need to check the function definition following the decorator.
 */
export function routeHasFastAPIAuth(fileContent: string, routeLineIndex: number): boolean {
  const lines = fileContent.split('\n');
  // Check the next 10 lines after the decorator for Depends(auth)
  for (let i = routeLineIndex; i < Math.min(routeLineIndex + 10, lines.length); i++) {
    if (FASTAPI_AUTH_PATTERNS.some(p => p.test(lines[i]))) return true;
    // Stop at next decorator or class definition
    if (i > routeLineIndex && /^(?:@|class\s|def\s)/.test(lines[i].trim())) break;
  }
  return false;
}

// ─── JWT / Bearer Token Detection ───────────────────────────────────

/** Patterns that indicate token-in-header auth (not cookies → CSRF not needed) */
const TOKEN_AUTH_PATTERNS = [
  /Authorization.*Bearer|Bearer.*Authorization/i,
  /jwt\.sign|jwt\.verify|jsonwebtoken|python-jose|PyJWT/i,
  /JWTBearer|HTTPBearer|OAuth2PasswordBearer/i,
  /APIKeyHeader\s*\(|APIKeyQuery\s*\(/i,
  /from\s+(?:jose|jwt)\s+import|import\s+jwt/i,
  /from\s+fastapi\.security\s+import.*(?:APIKeyHeader|HTTPBearer|OAuth2)/i,
];

/**
 * Check if a file uses token-based auth (JWT Bearer, API key in header, etc.)
 * which means CSRF protection is not needed.
 */
export function usesJWTBearerAuth(fileContent: string): boolean {
  return TOKEN_AUTH_PATTERNS.some(p => p.test(fileContent));
}

/**
 * Check if the project (not just one file) uses token-based auth.
 * Scans common auth file locations for JWT/APIKey patterns.
 */
export function projectUsesTokenAuth(rootDir: string): boolean {
  const authFiles = [
    'auth.py', 'auth.ts', 'auth.js',
    'middleware/auth.py', 'middleware/auth.ts', 'middleware/auth.js',
    'app/auth.py', 'app/auth.ts',
    'src/auth.ts', 'src/auth.js',
    'utils/auth.py', 'utils/auth.ts',
    'security.py', 'security.ts',
    'app/security.py', 'app/dependencies.py',
  ];

  for (const relPath of authFiles) {
    const fullPath = path.join(rootDir, relPath);
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (usesJWTBearerAuth(content)) return true;
      }
    } catch { /* skip unreadable */ }
  }
  return false;
}

// ─── LLM Import Detection ───────────────────────────────────────────

const LLM_IMPORT_PATTERNS = [
  /import\s+(?:openai|anthropic|cohere|langchain|litellm)/i,
  /from\s+(?:openai|anthropic|cohere|langchain|litellm)\b/i,
  /require\s*\(\s*['"](?:openai|@anthropic-ai\/sdk|anthropic|cohere|langchain)['"]\)/i,
  /(?:OpenAI|Anthropic|ChatCompletion|ChatAnthropic)\s*\(/i,
  /\.chat\.completions\.create\b/i,
  /\.messages\.create\b/i,
  /ChatPromptTemplate|PromptTemplate|SystemMessage/i,
];

/**
 * Check if a file imports or uses an LLM library.
 */
export function hasLLMImport(fileContent: string): boolean {
  return LLM_IMPORT_PATTERNS.some(p => p.test(fileContent));
}

// ─── Python-jose JWT Detection ──────────────────────────────────────

/**
 * Check if a Python jwt.decode() call is using python-jose (which verifies by default)
 * vs PyJWT (which has a separate decode-without-verify method).
 */
export function isPythonJoseVerifiedDecode(fileContent: string, lineIndex: number): boolean {
  // Check if the file imports from jose
  if (/from\s+jose\s+import\s+jwt|from\s+jose\b/i.test(fileContent)) {
    const lines = fileContent.split('\n');
    const line = lines[lineIndex] || '';
    // python-jose jwt.decode() verifies by default when key + algorithms are passed
    // Only flag if options explicitly disable verification
    if (/options\s*=\s*\{[^}]*"verify_signature"\s*:\s*False/i.test(line)) return false;
    if (/options\s*=\s*\{[^}]*"verify_exp"\s*:\s*False/i.test(line)) return false;
    // Default: python-jose verifies, so this is NOT a vulnerability
    return true;
  }
  return false;
}
