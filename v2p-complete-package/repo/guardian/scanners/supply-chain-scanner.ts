import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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

let findingCounter = 0;

function addFinding(
  findings: Finding[],
  opts: {
    severity: 'P0' | 'P1' | 'P2';
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
  findingCounter++;
  findings.push({
    id: `SCA-${String(findingCounter).padStart(3, '0')}`,
    domain: 8,
    control_id: opts.control_id,
    severity: opts.severity,
    category: opts.category,
    title: opts.title,
    description: opts.description,
    file: opts.file,
    line: opts.line,
    evidence: opts.evidence.length > 150 ? opts.evidence.substring(0, 150) + '...' : opts.evidence,
    remediation: opts.remediation,
    standard_refs: opts.standard_refs,
    auto_fixable: opts.auto_fixable ?? false,
  });
}

// Known malicious or typosquat package names (common examples)
const KNOWN_MALICIOUS_PACKAGES = new Set([
  'event-stream', // compromised in 2018
  'flatmap-stream',
  'ua-parser-js', // compromised versions
  'coa', // compromised
  'rc', // compromised
  'colors', // sabotaged
  'faker', // sabotaged
  'node-ipc', // protestware
  'peacenotwar',
  'es5-ext', // protestware
  'styled-components5', // typosquat
  'babelcli', // typosquat
  'cross-env.js', // typosquat
  'crossenv', // typosquat
  'd3.js', // typosquat
  'fabric-js', // typosquat
  'ffmpegs', // typosquat
  'gruntcli', // typosquat
  'http-proxy.js', // typosquat
  'jquery.js', // typosquat
  'mariadb', // typosquat
  'mongose', // typosquat
  'mssql.js', // typosquat
  'mssql-node', // typosquat
  'node-fabric', // typosquat
  'node-opencv', // typosquat
  'node-opensl', // typosquat
  'node-openssl', // typosquat
  'nodecaffe', // typosquat
  'nodefabric', // typosquat
  'nodeffmpeg', // typosquat
  'nodemailer-js', // typosquat
  'nodemailer.js', // typosquat
  'nodemssql', // typosquat
  'noderequest', // typosquat
  'nodesass', // typosquat
  'nodesqlite', // typosquat
  'opencv.js', // typosquat
  'openssl.js', // typosquat
  'proxy.js', // typosquat
  'shadowsock', // typosquat
  'smb', // typosquat
  'sqlite.js', // typosquat
  'sqliter', // typosquat
  'sqlserver', // typosquat
  'tkinter', // typosquat
]);

// --- npm audit ---

interface NpmAuditVulnerability {
  severity: string;
  name: string;
  title: string;
  url: string;
  range: string;
}

function runNpmAudit(targetDir: string, findings: Finding[]): void {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return;

  // Check if node_modules exists (npm audit needs it or package-lock)
  const lockfilePath = path.join(targetDir, 'package-lock.json');
  const yarnLockPath = path.join(targetDir, 'yarn.lock');
  if (!fs.existsSync(lockfilePath) && !fs.existsSync(yarnLockPath)) {
    addFinding(findings, {
      severity: 'P2',
      category: 'supply-chain',
      control_id: 'DEP-001',
      title: 'No lockfile found',
      description: 'No package-lock.json or yarn.lock found — dependency versions are not pinned',
      file: 'package.json',
      line: 1,
      evidence: 'Missing package-lock.json and yarn.lock',
      remediation: 'Run npm install or yarn install to generate a lockfile. Commit it to version control.',
      standard_refs: ['CWE-829', 'OWASP-A06:2021'],
    });
    return;
  }

  try {
    const result = execSync('npm audit --json 2>/dev/null', {
      cwd: targetDir,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let auditData: any;
    try {
      auditData = JSON.parse(result);
    } catch {
      return;
    }

    const vulnerabilities = auditData.vulnerabilities || {};
    for (const [pkgName, vuln] of Object.entries(vulnerabilities) as [string, any][]) {
      const severity = vuln.severity;
      let findingSeverity: 'P0' | 'P1' | 'P2' = 'P2';
      if (severity === 'critical') findingSeverity = 'P1';
      else if (severity === 'high') findingSeverity = 'P1';
      else if (severity === 'moderate') findingSeverity = 'P2';

      const title = vuln.via?.[0]?.title || `Known vulnerability in ${pkgName}`;
      const url = vuln.via?.[0]?.url || '';

      addFinding(findings, {
        severity: findingSeverity,
        category: 'vulnerable-dependency',
        control_id: 'DEP-002',
        title: `Vulnerable dependency: ${pkgName} (${severity})`,
        description: `${title}${url ? ` — ${url}` : ''}`,
        file: 'package.json',
        line: 1,
        evidence: `${pkgName}@${vuln.range || 'unknown'} — severity: ${severity}`,
        remediation: vuln.fixAvailable
          ? `Run npm audit fix or update ${pkgName} to a patched version.`
          : `No fix available yet. Consider replacing ${pkgName} or monitoring for updates.`,
        standard_refs: ['CWE-1035', 'OWASP-A06:2021'],
      });
    }
  } catch {
    // npm audit may exit non-zero when vulnerabilities found — that's expected
    // If it truly failed (e.g., npm not installed), just skip
  }
}

// --- Floating dependency versions ---

function checkDependencyVersions(targetDir: string, findings: Finding[]): void {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return;

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return;
  }

  const content = fs.readFileSync(packageJsonPath, 'utf-8');
  const lines = content.split('\n');

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version !== 'string') continue;

    // Check for known malicious packages
    if (KNOWN_MALICIOUS_PACKAGES.has(name)) {
      const lineNum = findLineForDep(lines, name);
      addFinding(findings, {
        severity: 'P0' as any,
        category: 'malicious-package',
        control_id: 'DEP-003',
        title: `Known malicious/compromised package: ${name}`,
        description: `Package "${name}" is known to be malicious, compromised, or contains protestware`,
        file: 'package.json',
        line: lineNum,
        evidence: `"${name}": "${version}"`,
        remediation: `Remove ${name} immediately and find a safe alternative. Audit your system for compromise.`,
        standard_refs: ['CWE-506', 'CWE-829', 'OWASP-A06:2021'],
      });
    }

    // Check for floating versions (^, ~, *, >=, latest, etc.)
    if (/^[\^~*>]|latest|next/i.test(version)) {
      const lineNum = findLineForDep(lines, name);
      addFinding(findings, {
        severity: 'P2',
        category: 'floating-version',
        control_id: 'DEP-004',
        title: `Floating dependency version: ${name}@${version}`,
        description: `Dependency "${name}" uses floating version "${version}" — builds may not be reproducible`,
        file: 'package.json',
        line: lineNum,
        evidence: `"${name}": "${version}"`,
        remediation: 'Pin dependency versions to exact versions (remove ^ or ~ prefix). Use a lockfile for reproducible builds.',
        standard_refs: ['CWE-829', 'SLSA-L1'],
        auto_fixable: true,
      });
    }
  }
}

function findLineForDep(lines: string[], depName: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"${depName}"`)) {
      return i + 1;
    }
  }
  return 1;
}

// --- Python requirements check ---

function checkPythonDependencies(targetDir: string, findings: Finding[]): void {
  const reqFiles = ['requirements.txt', 'requirements-dev.txt', 'requirements-prod.txt'];

  for (const reqFile of reqFiles) {
    const reqPath = path.join(targetDir, reqFile);
    if (!fs.existsSync(reqPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(reqPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;

      // Check for unpinned versions (no == or ===)
      if (line.includes('>=') || line.includes('~=') || line.includes('>') || !line.includes('==')) {
        if (line.includes('==')) continue; // Has exact pin
        addFinding(findings, {
          severity: 'P2',
          category: 'floating-version',
          control_id: 'DEP-004',
          title: `Unpinned Python dependency: ${line}`,
          description: `Python dependency "${line}" does not use exact version pinning`,
          file: reqFile,
          line: i + 1,
          evidence: line,
          remediation: 'Pin to exact versions (package==1.2.3). Use pip-compile for reproducible builds.',
          standard_refs: ['CWE-829', 'SLSA-L1'],
          auto_fixable: true,
        });
      }
    }
  }
}

// --- Docker image version checks ---

function checkDockerImages(targetDir: string, findings: Finding[]): void {
  const dockerFiles: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'vendor'].includes(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'dockerfile' || name.endsWith('.dockerfile') || name === 'docker-compose.yml' || name === 'docker-compose.yaml') {
          dockerFiles.push(path.join(dir, entry.name));
        }
      }
    }
  }

  walk(targetDir);

  for (const filePath of dockerFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relativeFile = path.relative(targetDir, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Dockerfile: FROM image:latest or FROM image (no tag)
      const fromMatch = /^FROM\s+(\S+)/i.exec(line);
      if (fromMatch) {
        const image = fromMatch[1];
        if (image.endsWith(':latest') || (!image.includes(':') && !image.includes('@'))) {
          addFinding(findings, {
            severity: 'P1',
            category: 'unpinned-docker-image',
            control_id: 'DEP-005',
            title: `Unpinned Docker image: ${image}`,
            description: `Docker image "${image}" uses :latest or no tag — builds are not reproducible`,
            file: relativeFile,
            line: i + 1,
            evidence: line,
            remediation: 'Pin Docker images to specific versions or SHA256 digests. Example: node:20.11.1-alpine',
            standard_refs: ['CWE-829', 'SLSA-L1'],
            auto_fixable: true,
          });
        }
      }

      // docker-compose: image: xxx:latest or image: xxx (no tag)
      const composeImageMatch = /^\s*image\s*:\s*['"]?(\S+?)['"]?\s*$/i.exec(line);
      if (composeImageMatch) {
        const image = composeImageMatch[1];
        if (image.endsWith(':latest') || (!image.includes(':') && !image.includes('@'))) {
          addFinding(findings, {
            severity: 'P1',
            category: 'unpinned-docker-image',
            control_id: 'DEP-005',
            title: `Unpinned Docker Compose image: ${image}`,
            description: `Docker Compose image "${image}" uses :latest or no tag`,
            file: relativeFile,
            line: i + 1,
            evidence: line,
            remediation: 'Pin Docker images to specific versions. Example: postgres:16.1-alpine',
            standard_refs: ['CWE-829', 'SLSA-L1'],
            auto_fixable: true,
          });
        }
      }
    }
  }
}

// --- Install scripts check ---

function checkInstallScripts(targetDir: string, findings: Finding[]): void {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return;

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return;
  }

  const suspiciousScripts = ['preinstall', 'postinstall', 'install'];
  const scripts = pkg.scripts || {};
  const content = fs.readFileSync(packageJsonPath, 'utf-8');
  const lines = content.split('\n');

  for (const scriptName of suspiciousScripts) {
    if (scripts[scriptName]) {
      const scriptValue = scripts[scriptName];
      // Flag if install scripts run curl, wget, or execute remote code
      if (/(?:curl|wget|fetch|eval|node\s+-e|bash\s+-c|sh\s+-c)/i.test(scriptValue)) {
        const lineNum = findLineForDep(lines, scriptName);
        addFinding(findings, {
          severity: 'P1',
          category: 'suspicious-install-script',
          control_id: 'DEP-006',
          title: `Suspicious ${scriptName} script`,
          description: `The ${scriptName} script downloads or executes remote code`,
          file: 'package.json',
          line: lineNum,
          evidence: `"${scriptName}": "${scriptValue.substring(0, 100)}"`,
          remediation: 'Review install scripts carefully. Avoid downloading/executing remote code during install.',
          standard_refs: ['CWE-829', 'CWE-506', 'OWASP-A06:2021'],
        });
      }
    }
  }
}

export async function scan(targetDir: string): Promise<Finding[]> {
  findingCounter = 0;
  const findings: Finding[] = [];

  runNpmAudit(targetDir, findings);
  checkDependencyVersions(targetDir, findings);
  checkPythonDependencies(targetDir, findings);
  checkDockerImages(targetDir, findings);
  checkInstallScripts(targetDir, findings);

  return findings;
}
