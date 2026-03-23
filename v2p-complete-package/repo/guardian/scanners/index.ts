import * as secretScanner from './secret-scanner';
import * as piiScanner from './pii-scanner';
import * as injectionScanner from './injection-scanner';
import * as accessControlScanner from './access-control-scanner';
import * as supplyChainScanner from './supply-chain-scanner';
import * as promptInjectionScanner from './prompt-injection-scanner';
import * as llmJudge from './llm-judge';

// Re-export the shared Finding interface
export type { Finding } from './secret-scanner';

// Re-export all scanners
export { secretScanner, piiScanner, injectionScanner, accessControlScanner, supplyChainScanner, promptInjectionScanner };

// Re-export llm-judge
export { llmJudge };
export type { JudgeVerdict, JudgeOptions } from './llm-judge';

export interface ScanResult {
  scanner: string;
  findings: secretScanner.Finding[];
  duration: number; // ms
  error?: string;
}

export interface FullScanResult {
  targetDir: string;
  timestamp: string;
  totalFindings: number;
  scanners: ScanResult[];
  findings: secretScanner.Finding[];
  summary: {
    P0: number;
    P1: number;
    P2: number;
    P3: number;
    byCategory: Record<string, number>;
  };
}

interface ScannerEntry {
  name: string;
  scan: (targetDir: string) => Promise<secretScanner.Finding[]>;
}

const ALL_SCANNERS: ScannerEntry[] = [
  { name: 'secret-scanner', scan: secretScanner.scan },
  { name: 'pii-scanner', scan: piiScanner.scan },
  { name: 'injection-scanner', scan: injectionScanner.scan },
  { name: 'access-control-scanner', scan: accessControlScanner.scan },
  { name: 'supply-chain-scanner', scan: supplyChainScanner.scan },
  { name: 'prompt-injection-scanner', scan: promptInjectionScanner.scan },
];

/**
 * Run all scanners in parallel against the target directory.
 * Returns aggregated findings with timing and summary data.
 */
export async function runAllScanners(targetDir: string): Promise<FullScanResult> {
  const scannerResults = await Promise.all(
    ALL_SCANNERS.map(async (scanner): Promise<ScanResult> => {
      const start = Date.now();
      try {
        const findings = await scanner.scan(targetDir);
        return {
          scanner: scanner.name,
          findings,
          duration: Date.now() - start,
        };
      } catch (error) {
        return {
          scanner: scanner.name,
          findings: [],
          duration: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  // Aggregate all findings
  const allFindings = scannerResults.flatMap((r) => r.findings);

  // Build summary
  const summary = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
    byCategory: {} as Record<string, number>,
  };

  for (const finding of allFindings) {
    summary[finding.severity]++;
    summary.byCategory[finding.category] = (summary.byCategory[finding.category] || 0) + 1;
  }

  return {
    targetDir,
    timestamp: new Date().toISOString(),
    totalFindings: allFindings.length,
    scanners: scannerResults,
    findings: allFindings,
    summary,
  };
}

/**
 * Run all scanners and then triage findings through the LLM judge.
 * Returns findings separated into confirmed, dismissed, and needs-review buckets.
 */
export async function runAllScannersWithTriage(
  targetDir: string,
  judgeOptions?: llmJudge.JudgeOptions,
): Promise<
  FullScanResult & {
    triage: {
      confirmed: secretScanner.Finding[];
      dismissed: secretScanner.Finding[];
      needsReview: secretScanner.Finding[];
    };
  }
> {
  const scanResult = await runAllScanners(targetDir);
  const triage = await llmJudge.filterFindings(scanResult.findings, targetDir, judgeOptions);

  return {
    ...scanResult,
    triage,
  };
}
