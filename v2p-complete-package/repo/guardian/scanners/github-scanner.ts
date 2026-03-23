import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { Finding } from './secret-scanner';
import type { FullScanResult } from './index';

interface GitHubScanResult {
  findings: Finding[];
  score: FullScanResult['summary'];
  summary: {
    totalFindings: number;
    scanners: { name: string; findingCount: number; duration: number; error?: string }[];
    timestamp: string;
  };
  tempDir: string;
}

/**
 * Parse owner/repo from various GitHub URL formats.
 * Accepts:
 *   - https://github.com/owner/repo
 *   - github.com/owner/repo
 *   - owner/repo
 */
function parseGitHubUrl(githubUrl: string): { owner: string; repo: string; cloneUrl: string } {
  let cleaned = githubUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  // Handle owner/repo shorthand (no dots, no slashes beyond the single separator)
  const shorthandMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2],
      cloneUrl: `https://github.com/${shorthandMatch[1]}/${shorthandMatch[2]}.git`,
    };
  }

  // Strip protocol if present
  cleaned = cleaned.replace(/^https?:\/\//, '');

  // Expect github.com/owner/repo
  const fullMatch = cleaned.match(/^github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (fullMatch) {
    return {
      owner: fullMatch[1],
      repo: fullMatch[2],
      cloneUrl: `https://github.com/${fullMatch[1]}/${fullMatch[2]}.git`,
    };
  }

  throw new Error(`Unable to parse GitHub URL: "${githubUrl}". Expected formats: https://github.com/owner/repo, github.com/owner/repo, or owner/repo`);
}

/**
 * Clone a GitHub repository to a temp directory and run all Guardian scanners against it.
 * Enriches each finding with GitHub-specific metadata (repo URL, commit SHA).
 */
export async function scanGitHubRepo(
  githubUrl: string,
  branch?: string,
): Promise<GitHubScanResult> {
  const { owner, repo, cloneUrl } = parseGitHubUrl(githubUrl);
  const tempDir = path.join(os.tmpdir(), `guardian-${Date.now()}`);

  try {
    // Clone the repository (shallow clone for speed)
    const targetBranch = branch || 'main';
    try {
      execSync(`git clone --depth 1 --branch ${targetBranch} ${cloneUrl} ${tempDir}`, {
        stdio: 'pipe',
        timeout: 60_000,
      });
    } catch (cloneError) {
      // If the specified branch (or default 'main') fails, try 'master' as fallback
      if (!branch) {
        try {
          execSync(`git clone --depth 1 --branch master ${cloneUrl} ${tempDir}`, {
            stdio: 'pipe',
            timeout: 60_000,
          });
        } catch {
          throw new Error(
            `Failed to clone ${cloneUrl}. The repository may not exist, may be private, or neither 'main' nor 'master' branches exist.`,
          );
        }
      } else {
        const msg = cloneError instanceof Error ? cloneError.message : String(cloneError);
        throw new Error(`Failed to clone ${cloneUrl} on branch '${targetBranch}': ${msg}`);
      }
    }

    // Get the HEAD commit SHA
    let commitSha = 'unknown';
    try {
      commitSha = execSync('git rev-parse HEAD', { cwd: tempDir, stdio: 'pipe' })
        .toString()
        .trim();
    } catch {
      // Non-fatal — continue with 'unknown'
    }

    // Dynamically import the index to call runAllScanners
    // Using dynamic import so the module resolution works at runtime
    const { runAllScanners } = await import('./index.js');
    const scanResult: FullScanResult = await runAllScanners(tempDir);

    // Enrich findings with GitHub metadata
    const repoFullName = `${owner}/${repo}`;
    const enrichedFindings: Finding[] = scanResult.findings.map((finding) => ({
      ...finding,
      github_url: `https://github.com/${repoFullName}`,
      commit_sha: commitSha,
      repo: repoFullName,
    } as Finding & { github_url: string; commit_sha: string; repo: string }));

    // Build summary
    const summary = {
      totalFindings: scanResult.totalFindings,
      scanners: scanResult.scanners.map((s) => ({
        name: s.scanner,
        findingCount: s.findings.length,
        duration: s.duration,
        ...(s.error ? { error: s.error } : {}),
      })),
      timestamp: scanResult.timestamp,
    };

    return {
      findings: enrichedFindings,
      score: scanResult.summary,
      summary,
      tempDir,
    };
  } finally {
    // Clean up the temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup — don't throw from finally
    }
  }
}
