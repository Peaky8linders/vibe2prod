import type { Finding } from './secret-scanner';

const FETCH_TIMEOUT = 5_000;

function createFinding(
  counter: { value: number },
  severity: Finding['severity'],
  category: string,
  controlId: string,
  title: string,
  description: string,
  evidence: string,
  remediation: string,
  standardRefs: string[],
  targetUrl: string,
): Finding {
  counter.value++;
  return {
    id: `DAST-${String(counter.value).padStart(3, '0')}`,
    domain: 7,
    control_id: controlId,
    severity,
    category,
    title,
    description,
    file: targetUrl,
    line: 0,
    evidence,
    remediation,
    standard_refs: standardRefs,
    auto_fixable: false,
  };
}

async function safeFetch(
  url: string,
  options?: RequestInit,
  followRedirects = false,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: followRedirects ? 'follow' : 'manual',
    });
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Check: Security Headers
// ---------------------------------------------------------------------------

interface HeaderCheck {
  header: string;
  severity: Finding['severity'];
  controlId: string;
  title: string;
  remediation: string;
  standardRefs: string[];
}

const SECURITY_HEADERS: HeaderCheck[] = [
  {
    header: 'content-security-policy',
    severity: 'P1',
    controlId: 'DAST-HDR-001',
    title: 'Missing Content-Security-Policy header',
    remediation:
      "Add a Content-Security-Policy header to restrict resource loading. Start with a report-only policy and tighten over time. Example: Content-Security-Policy: default-src 'self'",
    standardRefs: ['CWE-1021', 'OWASP-A05:2021'],
  },
  {
    header: 'strict-transport-security',
    severity: 'P1',
    controlId: 'DAST-HDR-002',
    title: 'Missing Strict-Transport-Security header',
    remediation:
      'Add HSTS header to enforce HTTPS. Example: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    standardRefs: ['CWE-319', 'OWASP-A02:2021'],
  },
  {
    header: 'x-frame-options',
    severity: 'P2',
    controlId: 'DAST-HDR-003',
    title: 'Missing X-Frame-Options header',
    remediation:
      'Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking attacks.',
    standardRefs: ['CWE-1021', 'OWASP-A05:2021'],
  },
  {
    header: 'x-content-type-options',
    severity: 'P2',
    controlId: 'DAST-HDR-004',
    title: 'Missing X-Content-Type-Options header',
    remediation:
      'Add X-Content-Type-Options: nosniff to prevent MIME-type sniffing.',
    standardRefs: ['CWE-16', 'OWASP-A05:2021'],
  },
  {
    header: 'referrer-policy',
    severity: 'P2',
    controlId: 'DAST-HDR-005',
    title: 'Missing Referrer-Policy header',
    remediation:
      'Add Referrer-Policy: strict-origin-when-cross-origin or no-referrer to limit referrer leakage.',
    standardRefs: ['CWE-200', 'OWASP-A01:2021'],
  },
  {
    header: 'permissions-policy',
    severity: 'P3',
    controlId: 'DAST-HDR-006',
    title: 'Missing Permissions-Policy header',
    remediation:
      'Add Permissions-Policy header to restrict browser features. Example: Permissions-Policy: camera=(), microphone=(), geolocation=()',
    standardRefs: ['CWE-16', 'OWASP-A05:2021'],
  },
];

async function checkSecurityHeaders(
  counter: { value: number },
  targetUrl: string,
  response: Response,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const check of SECURITY_HEADERS) {
    const value = response.headers.get(check.header);
    if (!value) {
      findings.push(
        createFinding(
          counter,
          check.severity,
          'missing-security-header',
          check.controlId,
          check.title,
          `The ${check.header} header is not set on the response from ${targetUrl}.`,
          `Response headers do not include ${check.header}`,
          check.remediation,
          check.standardRefs,
          targetUrl,
        ),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check: Information Leakage
// ---------------------------------------------------------------------------

async function checkInformationLeakage(
  counter: { value: number },
  targetUrl: string,
  response: Response,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Server header reveals technology
  const server = response.headers.get('server');
  if (server) {
    findings.push(
      createFinding(
        counter,
        'P2',
        'information-leakage',
        'DAST-INFO-001',
        'Server header reveals technology',
        `The Server header discloses server software: "${server}". This aids attackers in fingerprinting the stack.`,
        `Server: ${server}`,
        'Remove or genericize the Server header. In Nginx: server_tokens off; In Apache: ServerTokens Prod',
        ['CWE-200', 'OWASP-A05:2021'],
        targetUrl,
      ),
    );
  }

  // X-Powered-By header present
  const poweredBy = response.headers.get('x-powered-by');
  if (poweredBy) {
    findings.push(
      createFinding(
        counter,
        'P2',
        'information-leakage',
        'DAST-INFO-002',
        'X-Powered-By header reveals technology',
        `The X-Powered-By header discloses framework information: "${poweredBy}".`,
        `X-Powered-By: ${poweredBy}`,
        'Remove the X-Powered-By header. In Express: app.disable("x-powered-by")',
        ['CWE-200', 'OWASP-A05:2021'],
        targetUrl,
      ),
    );
  }

  // Check for detailed error pages on a non-existent path
  const errorUrl = targetUrl.replace(/\/$/, '') + '/nonexistent-path-' + Date.now();
  const errorResponse = await safeFetch(errorUrl, undefined, true);
  if (errorResponse) {
    try {
      const body = await errorResponse.text();
      const stackTracePatterns = [
        /at\s+\S+\s+\(.*:\d+:\d+\)/,       // Node.js stack trace
        /Traceback \(most recent call last\)/, // Python
        /Exception in thread/,                 // Java
        /Stack trace:/i,
        /Fatal error:/i,
        /\.php:\d+/,                           // PHP file references
        /SQLSTATE\[/,                          // SQL errors
      ];

      for (const pattern of stackTracePatterns) {
        if (pattern.test(body)) {
          findings.push(
            createFinding(
              counter,
              'P1',
              'information-leakage',
              'DAST-INFO-003',
              'Detailed error page exposes stack trace',
              'Error pages reveal internal stack traces or technology details that could help attackers.',
              `Error page at ${errorUrl} contains stack trace / debug information`,
              'Configure custom error pages in production. Disable debug mode and stack trace output.',
              ['CWE-209', 'CWE-200', 'OWASP-A05:2021'],
              targetUrl,
            ),
          );
          break;
        }
      }
    } catch {
      // Could not read response body — skip
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check: CORS Misconfiguration
// ---------------------------------------------------------------------------

async function checkCors(counter: { value: number }, targetUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  const corsResponse = await safeFetch(targetUrl, {
    headers: { Origin: 'https://evil.com' },
  }, true);

  if (corsResponse) {
    const acao = corsResponse.headers.get('access-control-allow-origin');
    const acac = corsResponse.headers.get('access-control-allow-credentials');

    if (acao === '*') {
      if (acac?.toLowerCase() === 'true') {
        findings.push(
          createFinding(
            counter,
            'P0',
            'cors-misconfiguration',
            'DAST-CORS-001',
            'CORS wildcard origin with credentials allowed',
            'Access-Control-Allow-Origin is * and Access-Control-Allow-Credentials is true. This is a critical misconfiguration that allows any site to make authenticated cross-origin requests.',
            `Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true`,
            'Never combine wildcard origin with credentials. Validate the Origin header against a whitelist.',
            ['CWE-942', 'CWE-346', 'OWASP-A01:2021', 'OWASP-A07:2021'],
            targetUrl,
          ),
        );
      } else {
        findings.push(
          createFinding(
            counter,
            'P1',
            'cors-misconfiguration',
            'DAST-CORS-002',
            'CORS allows any origin',
            'Access-Control-Allow-Origin is set to *, allowing any website to read responses. This may be intentional for public APIs but is risky for authenticated endpoints.',
            `Access-Control-Allow-Origin: *`,
            'Restrict Access-Control-Allow-Origin to specific trusted domains instead of using a wildcard.',
            ['CWE-942', 'OWASP-A01:2021'],
            targetUrl,
          ),
        );
      }
    } else if (acao === 'https://evil.com') {
      findings.push(
        createFinding(
          counter,
          'P0',
          'cors-misconfiguration',
          'DAST-CORS-003',
          'CORS reflects arbitrary origin',
          'The server reflects the Origin header value in Access-Control-Allow-Origin, allowing any site to make cross-origin requests.',
          `Origin: https://evil.com reflected in Access-Control-Allow-Origin`,
          'Validate the Origin header against a strict whitelist of trusted domains. Never reflect the origin blindly.',
          ['CWE-942', 'CWE-346', 'OWASP-A01:2021', 'OWASP-A07:2021'],
          targetUrl,
        ),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check: Cookie Security
// ---------------------------------------------------------------------------

async function checkCookies(
  counter: { value: number },
  targetUrl: string,
  response: Response,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // getSetCookie() returns an array of raw Set-Cookie header values
  const setCookieHeaders: string[] =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/).filter(Boolean);

  for (const cookie of setCookieHeaders) {
    if (!cookie.trim()) continue;

    const cookieName = cookie.split('=')[0]?.trim() || 'unknown';
    const lower = cookie.toLowerCase();

    const missingFlags: string[] = [];
    if (!lower.includes('httponly')) missingFlags.push('HttpOnly');
    if (!lower.includes('secure')) missingFlags.push('Secure');
    if (!lower.includes('samesite')) missingFlags.push('SameSite');

    if (missingFlags.length > 0) {
      findings.push(
        createFinding(
          counter,
          missingFlags.includes('HttpOnly') || missingFlags.includes('Secure') ? 'P1' : 'P2',
          'cookie-security',
          'DAST-COOKIE-001',
          `Cookie "${cookieName}" missing security flags: ${missingFlags.join(', ')}`,
          `The cookie "${cookieName}" is missing important security attributes that protect against XSS and CSRF.`,
          `Set-Cookie: ${cookie.substring(0, 120)}${cookie.length > 120 ? '...' : ''}`,
          `Add missing flags to the cookie: ${missingFlags.map((f) => {
            if (f === 'HttpOnly') return 'HttpOnly';
            if (f === 'Secure') return 'Secure';
            return 'SameSite=Lax or SameSite=Strict';
          }).join('; ')}`,
          ['CWE-614', 'CWE-1004', 'OWASP-A05:2021'],
          targetUrl,
        ),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check: SSL/TLS
// ---------------------------------------------------------------------------

async function checkSslTls(counter: { value: number }, targetUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check if HTTP redirects to HTTPS
  try {
    const httpUrl = targetUrl.replace(/^https:\/\//, 'http://');
    if (httpUrl.startsWith('http://')) {
      const httpResponse = await safeFetch(httpUrl);
      if (httpResponse) {
        const location = httpResponse.headers.get('location') || '';
        const status = httpResponse.status;
        const isRedirectToHttps =
          (status >= 300 && status < 400 && location.startsWith('https://'));

        if (!isRedirectToHttps) {
          findings.push(
            createFinding(
              counter,
              'P1',
              'ssl-tls',
              'DAST-TLS-001',
              'HTTP does not redirect to HTTPS',
              'The HTTP endpoint does not issue a redirect to HTTPS, allowing unencrypted connections.',
              `HTTP request to ${httpUrl} returned status ${status} without HTTPS redirect`,
              'Configure the server to redirect all HTTP traffic to HTTPS with a 301 redirect.',
              ['CWE-319', 'OWASP-A02:2021'],
              targetUrl,
            ),
          );
        }
      }
    }
  } catch {
    // Network error checking HTTP — skip
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check: Open Redirect
// ---------------------------------------------------------------------------

async function checkOpenRedirect(counter: { value: number }, targetUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const baseUrl = targetUrl.replace(/\/$/, '');
  const evilTarget = 'https://evil.com/pwned';

  const redirectParams = ['redirect', 'next', 'url', 'return', 'returnTo', 'return_to', 'redir'];

  for (const param of redirectParams) {
    const testUrl = `${baseUrl}?${param}=${encodeURIComponent(evilTarget)}`;
    const response = await safeFetch(testUrl);
    if (response) {
      const location = response.headers.get('location') || '';
      const status = response.status;

      if (status >= 300 && status < 400 && location.includes('evil.com')) {
        findings.push(
          createFinding(
            counter,
            'P1',
            'open-redirect',
            'DAST-REDIR-001',
            `Open redirect via "${param}" parameter`,
            `The application redirects to an attacker-controlled URL when the "${param}" query parameter contains an external URL. This can be abused for phishing.`,
            `${testUrl} → ${status} Location: ${location}`,
            'Validate redirect targets against a whitelist of allowed domains. Never redirect to user-supplied URLs without validation.',
            ['CWE-601', 'OWASP-A01:2021'],
            targetUrl,
          ),
        );
        // One finding is enough to demonstrate the issue
        break;
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main scan entry point
// ---------------------------------------------------------------------------

/**
 * Scan a live deployed URL for common security issues (DAST).
 * Checks security headers, information leakage, CORS, cookies, SSL/TLS, and open redirects.
 */
export async function scan(targetUrl: string): Promise<Finding[]> {
  // Local counter — safe for concurrent calls (no module-level mutation)
  const counter = { value: 0 };

  // Normalize URL
  let url = targetUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Initial request to the target (follow redirects)
  const response = await safeFetch(url, undefined, true);
  if (!response) {
    return [
      createFinding(
        counter,
        'P1',
        'connectivity',
        'DAST-CONN-001',
        'Target URL unreachable',
        `Could not connect to ${url} within the ${FETCH_TIMEOUT}ms timeout.`,
        `fetch(${url}) failed`,
        'Verify the URL is correct and the server is running.',
        ['CWE-400'],
        url,
      ),
    ];
  }

  // Run all checks in parallel
  const [
    headerFindings,
    infoLeakFindings,
    corsFindings,
    cookieFindings,
    sslFindings,
    redirectFindings,
  ] = await Promise.all([
    checkSecurityHeaders(counter, url, response),
    checkInformationLeakage(counter, url, response),
    checkCors(counter, url),
    checkCookies(counter, url, response),
    checkSslTls(counter, url),
    checkOpenRedirect(counter, url),
  ]);

  return [
    ...headerFindings,
    ...infoLeakFindings,
    ...corsFindings,
    ...cookieFindings,
    ...sslFindings,
    ...redirectFindings,
  ];
}
