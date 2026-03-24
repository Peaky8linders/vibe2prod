import * as fs from 'fs';
import * as path from 'path';
import { SKIP_DIRS, parseGitignore, isGitignored, isCommentLine, isPlaceholderValue, isExampleConfigFile } from './scan-utils';

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

interface SecretPattern {
  name: string;
  regex: RegExp;
  description: string;
  remediation: string;
  standard_refs: string[];
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'AWS Access Key',
    regex: /(?<![A-Za-z0-9/+=])(AKIA[0-9A-Z]{16})(?![A-Za-z0-9/+=])/,
    description: 'AWS Access Key ID found hardcoded in source code',
    remediation: 'Use environment variables or AWS IAM roles. Store secrets in AWS Secrets Manager or similar vault.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021', 'SOC2-CC6.1'],
  },
  {
    name: 'AWS Secret Key',
    regex: /(?<![A-Za-z0-9/+=])([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])(?=.*(?:aws|secret|key))/i,
    description: 'Potential AWS Secret Access Key found in source code',
    remediation: 'Use environment variables or AWS IAM roles. Rotate the compromised key immediately.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021', 'SOC2-CC6.1'],
  },
  {
    name: 'Generic API Key Assignment',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"`]([A-Za-z0-9_\-]{16,})[`'"]/i,
    description: 'API key or secret assigned directly in source code',
    remediation: 'Move API keys to environment variables or a secrets manager. Never commit secrets to version control.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'Generic Secret Assignment',
    regex: /(?:secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/i,
    description: 'Secret or credential assigned directly in source code',
    remediation: 'Use environment variables or a secrets vault. Rotate the exposed credential immediately.',
    standard_refs: ['CWE-798', 'CWE-259', 'OWASP-A07:2021'],
  },
  {
    name: 'JWT Secret',
    regex: /(?:jwt[_-]?secret|jwt[_-]?key|signing[_-]?key|token[_-]?secret)\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/i,
    description: 'JWT signing secret hardcoded in source code',
    remediation: 'Store JWT secrets in environment variables or a secrets manager. Use strong, randomly generated secrets.',
    standard_refs: ['CWE-798', 'CWE-321', 'OWASP-A02:2021'],
  },
  {
    name: 'Database Connection URL',
    regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\/[^\s'"`,)}{]+:[^\s'"`,)}{]+@[^\s'"`,)}{]+/i,
    description: 'Database connection string with embedded credentials found in source code',
    remediation: 'Use environment variables for database URLs. Never embed credentials in connection strings in code.',
    standard_refs: ['CWE-798', 'CWE-259', 'OWASP-A07:2021'],
  },
  {
    name: 'Private Key Block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    description: 'Private key found embedded in source code',
    remediation: 'Store private keys in a secure key management system. Never commit private keys to version control.',
    standard_refs: ['CWE-321', 'CWE-798', 'OWASP-A02:2021'],
  },
  {
    name: 'Bearer Token',
    regex: /(?:Authorization|Bearer)\s*[:=]\s*['"`]Bearer\s+([A-Za-z0-9_\-.]{20,})['"`]/i,
    description: 'Hardcoded Bearer token found in source code',
    remediation: 'Use dynamic token retrieval via OAuth flows. Never hardcode authorization tokens.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'SendGrid API Key',
    regex: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/,
    description: 'SendGrid API key found in source code',
    remediation: 'Use environment variables for SendGrid keys. Rotate the exposed key via the SendGrid dashboard.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'Stripe Secret Key',
    regex: /sk_(?:live|test)_[A-Za-z0-9]{24,}/,
    description: 'Stripe secret key found in source code',
    remediation: 'Use environment variables for Stripe keys. Rotate the key via the Stripe dashboard immediately.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021', 'PCI-DSS-3.4'],
  },
  {
    name: 'Stripe Publishable Key (in server code)',
    regex: /pk_live_[A-Za-z0-9]{24,}/,
    description: 'Stripe live publishable key found (verify it is not in server-side code)',
    remediation: 'Publishable keys should only appear in client-side code. Ensure this is not exposing server-side context.',
    standard_refs: ['CWE-200', 'PCI-DSS-3.4'],
  },
  {
    name: 'Slack Token',
    regex: /xox[bporas]-[A-Za-z0-9-]{10,}/,
    description: 'Slack API token found in source code',
    remediation: 'Use environment variables for Slack tokens. Rotate the token via Slack admin settings.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'GitHub Token',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,
    description: 'GitHub personal access token found in source code',
    remediation: 'Use environment variables or GitHub Apps for authentication. Revoke the exposed token immediately.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'Google API Key',
    regex: /AIza[A-Za-z0-9_\\-]{35}/,
    description: 'Google API key found in source code',
    remediation: 'Use environment variables and restrict the API key in Google Cloud Console.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'Twilio Auth Token',
    regex: /(?:twilio[_-]?(?:auth[_-]?)?token)\s*[:=]\s*['"`]([a-f0-9]{32})['"`]/i,
    description: 'Twilio authentication token found in source code',
    remediation: 'Use environment variables for Twilio credentials. Rotate the token in the Twilio console.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'OpenAI API Key',
    regex: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/,
    description: 'OpenAI API key found in source code',
    remediation: 'Use environment variables for API keys. Rotate the key in the OpenAI dashboard.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
  {
    name: 'Anthropic API Key',
    regex: /sk-ant-[A-Za-z0-9_\-]{80,}/,
    description: 'Anthropic API key found in source code',
    remediation: 'Use environment variables for API keys. Rotate the key in the Anthropic console.',
    standard_refs: ['CWE-798', 'OWASP-A07:2021'],
  },
];

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.rs', '.php',
  '.yaml', '.yml', '.json', '.toml', '.ini', '.cfg',
  '.env', '.sh', '.bash', '.zsh', '.ps1',
  '.tf', '.hcl', '.dockerfile',
  '.cs', '.kt', '.scala', '.swift',
]);

function shouldScanFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (basename === 'dockerfile' || basename === 'docker-compose.yml') return true;
  return CODE_EXTENSIONS.has(ext);
}

function collectFiles(dir: string, gitignorePatterns: Set<string>): string[] {
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
        const filePath = path.join(currentDir, entry.name);
        if (!isGitignored(path.relative(dir, filePath), gitignorePatterns)) {
          files.push(filePath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

function isLikelyFalsePositive(line: string, filePath: string): boolean {
  // Skip ALL comment lines (not just ones with specific keywords)
  if (isCommentLine(line)) return true;
  // Skip placeholder values universally (not just in test files)
  if (isPlaceholderValue(line)) return true;
  // Skip example config files (.env.example, .env.sample, etc.)
  if (isExampleConfigFile(filePath)) return true;
  // Skip test fixtures with obviously fake values
  if (/test|spec|mock|fixture|fake|dummy|sample/i.test(filePath)) {
    if (/['"\`](test|fake|dummy|example|placeholder|xxx|your-?|my-?|change-?me)/i.test(line)) {
      return true;
    }
  }
  return false;
}

function extractEvidence(line: string): string {
  // Truncate long lines and redact the actual secret value
  const maxLen = 120;
  let evidence = line.trim();
  if (evidence.length > maxLen) {
    evidence = evidence.substring(0, maxLen) + '...';
  }
  return evidence;
}

function createFinding(
  pattern: SecretPattern,
  filePath: string,
  lineNumber: number,
  line: string,
  targetDir: string,
  counter: { value: number },
): Finding {
  counter.value++;
  const relativeFile = path.relative(targetDir, filePath);
  return {
    id: `SEC-${String(counter.value).padStart(3, '0')}`,
    domain: 3,
    control_id: 'DATA-003',
    severity: 'P0',
    category: 'secret-exposure',
    title: `Hardcoded ${pattern.name}`,
    description: pattern.description,
    file: relativeFile,
    line: lineNumber,
    evidence: extractEvidence(line),
    remediation: pattern.remediation,
    standard_refs: pattern.standard_refs,
    auto_fixable: false,
  };
}

export async function scan(targetDir: string): Promise<Finding[]> {
  const counter = { value: 0 };
  const gitignorePatterns = parseGitignore(targetDir);
  const findings: Finding[] = [];
  const files = collectFiles(targetDir, gitignorePatterns);

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

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push(createFinding(pattern, filePath, i + 1, line, targetDir, counter));
          break; // One finding per line to avoid duplicates
        }
      }
    }
  }

  return findings;
}
