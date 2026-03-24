import * as fs from 'fs';
import * as path from 'path';
import { SKIP_DIRS, parseGitignore, isGitignored, detectFramework, hasFastAPIAuth, routeHasFastAPIAuth, usesJWTBearerAuth, isPythonJoseVerifiedDecode, projectUsesTokenAuth } from './scan-utils';

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

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.rs', '.php',
  '.cs', '.kt', '.scala', '.swift',
]);

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  const gitignorePatterns = parseGitignore(dir);

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
          const entryPath = path.join(currentDir, entry.name);
          const relPath = path.relative(dir, entryPath);
          if (!isGitignored(relPath, gitignorePatterns)) {
            walk(entryPath);
          }
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          const entryPath = path.join(currentDir, entry.name);
          const relPath = path.relative(dir, entryPath);
          if (!isGitignored(relPath, gitignorePatterns)) {
            files.push(entryPath);
          }
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

function makeCounter() {
  let count = 0;
  return {
    next: () => ++count,
    reset: () => { count = 0; },
  };
}

const findingCounter = makeCounter();

function addFinding(
  findings: Finding[],
  opts: {
    severity: 'P0' | 'P1';
    category: string;
    control_id: string;
    title: string;
    description: string;
    file: string;
    line: number;
    evidence: string;
    remediation: string;
    standard_refs: string[];
    auto_fixable?: boolean;
  },
): void {
  findings.push({
    id: `ACL-${String(findingCounter.next()).padStart(3, '0')}`,
    domain: 2,
    control_id: opts.control_id,
    severity: opts.severity,
    category: opts.category,
    title: opts.title,
    description: opts.description,
    file: opts.file,
    line: opts.line,
    evidence: extractEvidence(opts.evidence),
    remediation: opts.remediation,
    standard_refs: opts.standard_refs,
    auto_fixable: opts.auto_fixable ?? false,
  });
}

// --- Check: Routes without auth middleware ---

const ROUTE_PATTERN = /(?:router|app)\s*\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]\s*,/;
const PYTHON_ROUTE_PATTERN = /@(?:app|router)\.\s*(?:get|post|put|patch|delete|api_route)\s*\(\s*['"]([^'"]+)['"]/;

const AUTH_MIDDLEWARE_NAMES = [
  'auth', 'authenticate', 'isAuthenticated', 'requireAuth', 'ensureAuth',
  'verifyToken', 'checkAuth', 'protect', 'isLoggedIn', 'requireLogin',
  'authMiddleware', 'authGuard', 'jwtAuth', 'passport.authenticate',
  'requireAuthentication', 'ensureAuthenticated',
  // FastAPI auth dependency injection names
  'Depends', 'Security', 'get_current_user', 'get_current_active_user',
  'get_current_admin', 'HTTPBearer', 'OAuth2PasswordBearer',
];

function checkRoutesWithoutAuth(
  lines: string[],
  fileContent: string,
  filePath: string,
  relativeFile: string,
  findings: Finding[],
): void {
  // Patterns that indicate public routes (don't need auth)
  const publicPatterns = /(?:\/health|\/ping|\/status|\/ready|\/live|\/version|\/api-docs|\/swagger|\/favicon|\/robots\.txt|\/public|\/static|\/assets|\/login|\/register|\/signup|\/forgot|\/reset-password|\/webhook)/i;

  const isPython = path.extname(filePath).toLowerCase() === '.py';

  // For FastAPI files: if auth is used anywhere in the file, all routes are protected
  // via the same router/dependency injection — skip the per-route check entirely
  if (isPython && hasFastAPIAuth(fileContent)) {
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let routePath: string | undefined;
    if (isPython) {
      const match = PYTHON_ROUTE_PATTERN.exec(line);
      if (!match) continue;
      routePath = match[1];
    } else {
      const match = ROUTE_PATTERN.exec(line);
      if (!match) continue;
      routePath = match[1];
    }

    if (publicPatterns.test(routePath)) continue;

    let hasAuth: boolean;
    if (isPython) {
      // For Python/FastAPI: check if the route handler function has a Depends() auth dependency
      hasAuth = routeHasFastAPIAuth(fileContent, i);
    } else {
      // Check if any auth middleware is in the route handler chain
      // Look at this line and the next few lines (route definitions can span lines)
      const context = lines.slice(i, Math.min(i + 5, lines.length)).join(' ');
      hasAuth = AUTH_MIDDLEWARE_NAMES.some((name) => context.includes(name));
    }

    if (!hasAuth) {
      addFinding(findings, {
        severity: 'P1',
        category: 'missing-auth',
        control_id: 'AUTH-001',
        title: `Route without auth middleware: ${routePath}`,
        description: `Route '${routePath}' does not appear to use authentication middleware`,
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Add authentication middleware to protect this route. Example: router.get("/path", authMiddleware, handler)',
        standard_refs: ['CWE-306', 'OWASP-A07:2021', 'SOC2-CC6.1'],
      });
    }
  }
}

// --- Check: Missing ownership checks ---

const RESOURCE_ACCESS_PATTERN = /(?:findById|findOne|findByPk|get|findUnique|findFirst)\s*\(\s*(?:req\.params\.(?:id|userId|accountId|orderId|documentId)|params\.(?:id|userId))/i;
const OWNERSHIP_CHECK_KEYWORDS = ['userId', 'user.id', 'req.user', 'currentUser', 'session.user', 'owner', 'createdBy', 'belongsTo'];

function checkMissingOwnershipChecks(
  lines: string[],
  relativeFile: string,
  findings: Finding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RESOURCE_ACCESS_PATTERN.test(line)) continue;

    // Look at surrounding context (10 lines before and after) for ownership check
    const contextStart = Math.max(0, i - 10);
    const contextEnd = Math.min(lines.length, i + 10);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    const hasOwnershipCheck = OWNERSHIP_CHECK_KEYWORDS.some((kw) => context.includes(kw));

    if (!hasOwnershipCheck) {
      addFinding(findings, {
        severity: 'P0',
        category: 'missing-authorization',
        control_id: 'AUTH-002',
        title: 'Resource access without ownership check',
        description: 'Database resource accessed by request param without verifying the requesting user owns the resource',
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Add ownership verification: verify req.user.id matches the resource owner before returning data.',
        standard_refs: ['CWE-284', 'CWE-639', 'OWASP-A01:2021'],
      });
    }
  }
}

// --- Check: Missing role checks on admin endpoints ---

const ADMIN_ROUTE_PATTERN = /(?:router|app)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]*(?:admin|manage|dashboard|internal|backoffice|superuser)[^'"`]*)['"`]/i;
const ROLE_CHECK_KEYWORDS = [
  'isAdmin', 'requireAdmin', 'adminOnly', 'checkRole', 'requireRole',
  'hasRole', 'role', 'admin', 'authorize', 'can', 'ability', 'permission',
  'guardAdmin', 'adminGuard', 'isSuperUser',
];

function checkMissingRoleChecks(
  lines: string[],
  relativeFile: string,
  findings: Finding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = ADMIN_ROUTE_PATTERN.exec(line);
    if (!match) continue;

    const routePath = match[1];
    const context = lines.slice(i, Math.min(i + 5, lines.length)).join(' ');
    const hasRoleCheck = ROLE_CHECK_KEYWORDS.some((kw) =>
      context.toLowerCase().includes(kw.toLowerCase()),
    );

    if (!hasRoleCheck) {
      addFinding(findings, {
        severity: 'P0',
        category: 'missing-authorization',
        control_id: 'AUTH-003',
        title: `Admin route without role check: ${routePath}`,
        description: `Admin endpoint '${routePath}' does not appear to verify the user has admin/elevated privileges`,
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Add role-based authorization middleware. Example: router.post("/admin/...", requireAdmin, handler)',
        standard_refs: ['CWE-285', 'CWE-862', 'OWASP-A01:2021'],
      });
    }
  }
}

// --- Check: Hardcoded CORS ---

const CORS_OPEN_PATTERN = /cors\s*\(\s*\)/;
const CORS_WILDCARD_PATTERN = /(?:origin|Access-Control-Allow-Origin)\s*[:=]\s*['"`]\*['"`]/;
const CORS_CREDENTIALS_WILDCARD = /(?:credentials\s*:\s*true).*(?:origin\s*:\s*['"`]\*['"`])|(?:origin\s*:\s*['"`]\*['"`]).*(?:credentials\s*:\s*true)/;

function checkCorsIssues(
  lines: string[],
  relativeFile: string,
  findings: Finding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (CORS_OPEN_PATTERN.test(line)) {
      addFinding(findings, {
        severity: 'P1',
        category: 'cors-misconfiguration',
        control_id: 'AUTH-004',
        title: 'CORS enabled with no restrictions',
        description: 'cors() called without options — allows all origins',
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Configure CORS with specific allowed origins: cors({ origin: ["https://your-domain.com"] })',
        standard_refs: ['CWE-346', 'CWE-942', 'OWASP-A07:2021'],
      });
    }

    if (CORS_WILDCARD_PATTERN.test(line)) {
      // Check surrounding context for credentials: true
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)).join(' ');
      if (CORS_CREDENTIALS_WILDCARD.test(context)) {
        addFinding(findings, {
          severity: 'P0',
          category: 'cors-misconfiguration',
          control_id: 'AUTH-004',
          title: 'CORS wildcard with credentials',
          description: 'CORS allows all origins with credentials enabled — browsers block this, but indicates misconfiguration intent',
          file: relativeFile,
          line: i + 1,
          evidence: line,
          remediation: 'Never use origin: "*" with credentials: true. Specify allowed origins explicitly.',
          standard_refs: ['CWE-346', 'CWE-942', 'OWASP-A05:2021'],
        });
      } else {
        addFinding(findings, {
          severity: 'P1',
          category: 'cors-misconfiguration',
          control_id: 'AUTH-004',
          title: 'CORS allows all origins',
          description: 'Access-Control-Allow-Origin set to wildcard (*) — any origin can access this resource',
          file: relativeFile,
          line: i + 1,
          evidence: line,
          remediation: 'Restrict CORS to specific trusted origins instead of using wildcard.',
          standard_refs: ['CWE-346', 'CWE-942'],
        });
      }
    }
  }
}

// --- Check: JWT issues ---

const JWT_LONG_EXPIRY_PATTERN = /(?:expiresIn|exp)\s*[:=]\s*['"`](\d+)([dhm])['"`]/;
const JWT_WEAK_SECRET_PATTERN = /(?:jwt\.sign|jsonwebtoken\.sign|\.sign)\s*\([^,]+,\s*['"`]([^'"`]{1,15})['"`]/;
const JWT_NO_VERIFY_PATTERN = /(?:jwt\.decode|jsonwebtoken\.decode)\s*\(/;
const JWT_ALGORITHM_NONE = /algorithm\s*[:=]\s*['"`]none['"`]/i;

function checkJwtIssues(
  lines: string[],
  fileContent: string,
  filePath: string,
  relativeFile: string,
  findings: Finding[],
): void {
  const isPython = path.extname(filePath).toLowerCase() === '.py';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for long JWT expiry
    const expiryMatch = JWT_LONG_EXPIRY_PATTERN.exec(line);
    if (expiryMatch) {
      const value = parseInt(expiryMatch[1], 10);
      const unit = expiryMatch[2];
      let hours = 0;
      if (unit === 'h') hours = value;
      else if (unit === 'd') hours = value * 24;
      else if (unit === 'm') hours = value / 60;

      if (hours > 24) {
        addFinding(findings, {
          severity: 'P1',
          category: 'jwt-misconfiguration',
          control_id: 'AUTH-005',
          title: `JWT token with long expiry: ${expiryMatch[1]}${unit}`,
          description: `JWT expiry set to ${expiryMatch[1]}${unit} — tokens should expire in 1-24 hours for access tokens`,
          file: relativeFile,
          line: i + 1,
          evidence: line,
          remediation: 'Use short-lived access tokens (15min-1hr) with refresh tokens. Set expiresIn to "1h" or less.',
          standard_refs: ['CWE-613', 'OWASP-A07:2021'],
        });
      }
    }

    // Check for weak JWT secret
    if (JWT_WEAK_SECRET_PATTERN.test(line)) {
      addFinding(findings, {
        severity: 'P0',
        category: 'jwt-misconfiguration',
        control_id: 'AUTH-005',
        title: 'JWT signed with weak/short secret',
        description: 'JWT signing secret is hardcoded and appears too short (< 16 chars) — easily brute-forced',
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Use a strong, randomly generated secret (32+ chars) stored in environment variables.',
        standard_refs: ['CWE-326', 'CWE-798', 'OWASP-A02:2021'],
      });
    }

    // Check for jwt.decode without verify
    if (JWT_NO_VERIFY_PATTERN.test(line)) {
      // For Python files using python-jose: jwt.decode() verifies by default
      if (isPython && isPythonJoseVerifiedDecode(fileContent, i)) {
        // python-jose verifies on decode — not a vulnerability, skip
      } else {
        // Check context for whether verify is also used
        const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join('\n');
        if (!context.includes('verify') && !context.includes('// decode only')) {
          addFinding(findings, {
            severity: 'P0',
            category: 'jwt-misconfiguration',
            control_id: 'AUTH-005',
            title: 'JWT decoded without signature verification',
            description: 'jwt.decode() used instead of jwt.verify() — tokens are not validated',
            file: relativeFile,
            line: i + 1,
            evidence: line,
            remediation: 'Use jwt.verify() to validate token signatures. jwt.decode() does not check authenticity.',
            standard_refs: ['CWE-345', 'CWE-347', 'OWASP-A02:2021'],
          });
        }
      }
    }

    // Check for algorithm: none
    if (JWT_ALGORITHM_NONE.test(line)) {
      addFinding(findings, {
        severity: 'P0',
        category: 'jwt-misconfiguration',
        control_id: 'AUTH-005',
        title: 'JWT algorithm set to "none"',
        description: 'JWT configured with algorithm "none" — disables signature verification entirely',
        file: relativeFile,
        line: i + 1,
        evidence: line,
        remediation: 'Always use a secure algorithm (RS256, ES256, HS256). Never allow algorithm "none".',
        standard_refs: ['CWE-327', 'CWE-345', 'OWASP-A02:2021'],
      });
    }
  }
}

// --- Check: Missing CSRF protection ---

const CSRF_STATE_CHANGE_PATTERN = /(?:router|app)\s*\.\s*(?:post|put|patch|delete)\s*\(/;
const CSRF_MIDDLEWARE_NAMES = ['csrf', 'csurf', 'csrfProtection', 'csrfToken', 'xsrf'];

function checkMissingCsrf(
  content: string,
  lines: string[],
  relativeFile: string,
  findings: Finding[],
  targetDir: string,
): void {
  // Only check if file defines state-changing routes but doesn't reference CSRF
  const hasStateChangingRoutes = CSRF_STATE_CHANGE_PATTERN.test(content);
  const hasCsrf = CSRF_MIDDLEWARE_NAMES.some((name) =>
    content.toLowerCase().includes(name.toLowerCase()),
  );

  // Token-based auth (JWT Bearer, API key in header) is not CSRF-vulnerable
  if (usesJWTBearerAuth(content) || projectUsesTokenAuth(targetDir)) {
    return;
  }

  if (hasStateChangingRoutes && !hasCsrf) {
    // Find first state-changing route for the finding location
    for (let i = 0; i < lines.length; i++) {
      if (CSRF_STATE_CHANGE_PATTERN.test(lines[i])) {
        addFinding(findings, {
          severity: 'P1',
          category: 'missing-csrf',
          control_id: 'AUTH-006',
          title: 'State-changing routes without CSRF protection',
          description: 'File defines POST/PUT/PATCH/DELETE routes but no CSRF middleware is referenced',
          file: relativeFile,
          line: i + 1,
          evidence: lines[i],
          remediation: 'Add CSRF protection middleware (e.g., csurf). Use CSRF tokens in forms and AJAX requests.',
          standard_refs: ['CWE-352', 'OWASP-A01:2021'],
        });
        break; // Report once per file
      }
    }
  }
}

export async function scan(targetDir: string): Promise<Finding[]> {
  findingCounter.reset();
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

    // Skip test files for most checks
    const isTest = /(?:test|spec|mock|fixture|__test__|__spec__|\.test\.|\.spec\.)/i.test(filePath);
    if (isTest) continue;

    checkRoutesWithoutAuth(lines, content, filePath, relativeFile, findings);
    checkMissingOwnershipChecks(lines, relativeFile, findings);
    checkMissingRoleChecks(lines, relativeFile, findings);
    checkCorsIssues(lines, relativeFile, findings);
    checkJwtIssues(lines, content, filePath, relativeFile, findings);
    checkMissingCsrf(content, lines, relativeFile, findings, targetDir);
  }

  return findings;
}
