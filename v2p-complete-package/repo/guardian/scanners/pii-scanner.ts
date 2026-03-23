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

interface PIIPattern {
  name: string;
  regex: RegExp;
  severity: 'P1' | 'P2';
  category: string;
  control_id: string;
  description: string;
  remediation: string;
  standard_refs: string[];
}

const PII_PATTERNS: PIIPattern[] = [
  // Email in logging
  {
    name: 'Email in log output',
    regex: /(?:console\.(?:log|info|warn|error|debug)|logger?\.\w+|log\.(?:info|warn|error|debug)|print(?:ln)?|puts)\s*\(.*(?:email|mail|e_mail)(?!.*(?:mask|redact|sanitize|hash|anonymize))/i,
    severity: 'P1',
    category: 'pii-logging',
    control_id: 'DATA-001',
    description: 'Email address may be logged directly without redaction',
    remediation: 'Redact or hash email addresses before logging. Use a PII sanitization utility.',
    standard_refs: ['GDPR-Art5', 'CWE-532', 'SOC2-CC6.1'],
  },
  // SSN patterns in code
  {
    name: 'SSN pattern in code',
    regex: /(?:ssn|social[_-]?security|social_security_number|tax[_-]?id)\s*[:=]/i,
    severity: 'P1',
    category: 'pii-handling',
    control_id: 'DATA-001',
    description: 'Social Security Number field found — ensure proper encryption and access control',
    remediation: 'Encrypt SSNs at rest and in transit. Never log SSNs. Mask when displaying (show last 4 only).',
    standard_refs: ['GDPR-Art5', 'CWE-359', 'HIPAA-164.312', 'SOC2-CC6.1'],
  },
  // SSN regex pattern in validation (might expose in responses)
  {
    name: 'SSN regex validation',
    regex: /\d{3}[- ]?\d{2}[- ]?\d{4}/,
    severity: 'P2',
    category: 'pii-handling',
    control_id: 'DATA-001',
    description: 'Potential SSN pattern literal found in code',
    remediation: 'Ensure SSN values are never stored in plaintext or returned in API responses.',
    standard_refs: ['CWE-359', 'GDPR-Art5'],
  },
  // Phone number in logging
  {
    name: 'Phone number in log output',
    regex: /(?:console\.(?:log|info|warn|error|debug)|logger?\.\w+|log\.(?:info|warn|error|debug))\s*\(.*(?:phone|mobile|cell|telephone)(?!.*(?:mask|redact|sanitize|hash))/i,
    severity: 'P2',
    category: 'pii-logging',
    control_id: 'DATA-001',
    description: 'Phone number may be logged directly without redaction',
    remediation: 'Redact phone numbers before logging. Mask all but last 4 digits.',
    standard_refs: ['GDPR-Art5', 'CWE-532'],
  },
  // Password hash returned to client
  {
    name: 'Password hash in response',
    regex: /(?:res\.(?:json|send|status\(\d+\)\.json)|return\s+(?:Response|JsonResponse|jsonify))\s*\(?\s*{[^}]*(?:password|passwd|pwd|hash|password_hash)/i,
    severity: 'P1',
    category: 'pii-exposure',
    control_id: 'DATA-002',
    description: 'Password or password hash may be included in API response',
    remediation: 'Exclude password fields from API responses. Use DTOs or select specific fields.',
    standard_refs: ['CWE-200', 'CWE-359', 'OWASP-A01:2021'],
  },
  // User data in error responses
  {
    name: 'User data in error response',
    regex: /(?:catch|except|rescue)\s*(?:\([^)]*\))?\s*{?[^}]*(?:res\.(?:json|send)|return\s+(?:Response|JsonResponse)).*(?:user|email|name|address|phone|ssn)/i,
    severity: 'P1',
    category: 'pii-exposure',
    control_id: 'DATA-002',
    description: 'User data may be exposed in error responses',
    remediation: 'Return generic error messages to clients. Log detailed errors server-side only.',
    standard_refs: ['CWE-209', 'CWE-200', 'OWASP-A07:2021'],
  },
  // console.log with user object
  {
    name: 'User object in console.log',
    regex: /console\.(?:log|info|warn|error|debug)\s*\(\s*(?:['"`].*['"`]\s*,\s*)?(?:user|customer|patient|member|account|profile)\b/i,
    severity: 'P2',
    category: 'pii-logging',
    control_id: 'DATA-001',
    description: 'User object logged directly — may contain PII',
    remediation: 'Never log full user objects. Log only non-PII identifiers (user ID, session ID).',
    standard_refs: ['GDPR-Art5', 'CWE-532', 'SOC2-CC6.1'],
  },
  // Sending user data to external analytics/services
  {
    name: 'User data sent to external service',
    regex: /(?:fetch|axios|http|request)\s*(?:\.\w+)?\s*\([^)]*(?:analytics|tracking|segment|mixpanel|amplitude|sentry|bugsnag|datadog|newrelic)[^)]*[^}]*(?:email|name|phone|user|address)/i,
    severity: 'P1',
    category: 'pii-external-sharing',
    control_id: 'DATA-004',
    description: 'User PII may be sent to external service without sanitization',
    remediation: 'Sanitize PII before sending to third-party services. Use anonymized identifiers.',
    standard_refs: ['GDPR-Art5', 'GDPR-Art28', 'CWE-359', 'SOC2-CC6.1'],
  },
  // Full user object in response (select * or spreading user)
  {
    name: 'Full user record in response',
    regex: /(?:SELECT\s+\*\s+FROM\s+(?:users|customers|accounts|patients|members))|(?:\.findOne|\.findById|\.find)\s*\([^)]*\)\s*(?:;|\))\s*(?:\/\/|$)|(?:res\.json\(\s*(?:await\s+)?(?:User|Customer|Account)\.find)/i,
    severity: 'P2',
    category: 'pii-exposure',
    control_id: 'DATA-002',
    description: 'Full user record may be returned without field filtering',
    remediation: 'Select only required fields. Use DTOs to control response shape. Exclude sensitive fields.',
    standard_refs: ['CWE-200', 'OWASP-A01:2021', 'GDPR-Art5'],
  },
  // Credit card patterns
  {
    name: 'Credit card number handling',
    regex: /(?:credit[_-]?card|card[_-]?number|cc[_-]?num|pan)\s*[:=]/i,
    severity: 'P1',
    category: 'pii-handling',
    control_id: 'DATA-005',
    description: 'Credit card number field found — ensure PCI DSS compliance',
    remediation: 'Never store raw card numbers. Use a PCI-compliant payment processor (Stripe, etc.).',
    standard_refs: ['PCI-DSS-3.4', 'CWE-311', 'CWE-359'],
  },
  // Date of birth / birthday logging
  {
    name: 'Date of birth in logs',
    regex: /(?:console\.(?:log|info|warn|error)|logger?\.\w+)\s*\(.*(?:dob|date[_-]?of[_-]?birth|birthday|birth[_-]?date)(?!.*(?:mask|redact))/i,
    severity: 'P2',
    category: 'pii-logging',
    control_id: 'DATA-001',
    description: 'Date of birth may be logged without redaction',
    remediation: 'Redact dates of birth before logging. Log only age ranges if needed.',
    standard_refs: ['GDPR-Art5', 'CWE-532', 'HIPAA-164.312'],
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

function isTestOrMockFile(filePath: string): boolean {
  return /(?:test|spec|mock|fixture|__test__|__spec__|\.test\.|\.spec\.)/i.test(filePath);
}

function extractEvidence(line: string): string {
  const maxLen = 120;
  let evidence = line.trim();
  if (evidence.length > maxLen) {
    evidence = evidence.substring(0, maxLen) + '...';
  }
  return evidence;
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
    const isTest = isTestOrMockFile(filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      for (const pattern of PII_PATTERNS) {
        if (pattern.regex.test(line)) {
          // Reduce severity for test files
          const severity = isTest ? 'P2' : pattern.severity;

          findingCounter++;
          findings.push({
            id: `PII-${String(findingCounter).padStart(3, '0')}`,
            domain: 3,
            control_id: pattern.control_id,
            severity,
            category: pattern.category,
            title: pattern.name,
            description: pattern.description,
            file: relativeFile,
            line: i + 1,
            evidence: extractEvidence(line),
            remediation: pattern.remediation,
            standard_refs: pattern.standard_refs,
            auto_fixable: false,
          });
          break;
        }
      }
    }
  }

  return findings;
}
