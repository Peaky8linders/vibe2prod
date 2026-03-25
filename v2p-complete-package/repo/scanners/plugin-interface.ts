/**
 * scanners/plugin-interface.ts — Scanner Plugin Contract
 *
 * All scanner plugins implement this interface. The scan-e2e orchestrator
 * discovers and loads plugins automatically from scanners/*-scanner.ts.
 */

export interface FileDefect {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  line: number | null;
  description: string;
  fix_hint: string;
  code_snippet?: string;
  /** Regulatory reference (e.g., "EU AI Act Art. 14", "NIST AI RMF GOVERN") */
  regulation?: string;
}

export interface ScannerPlugin {
  /** Plugin name (e.g., "compliance", "governance", "evidence") */
  name: string;
  /** Dimensions this plugin covers */
  dimensions: string[];
  /** Scan a single file and return defects found */
  scan(filePath: string, content: string, language: string): FileDefect[];
}

export interface EvidenceEntry {
  seq: number;
  type: "scan" | "fix" | "comply" | "verify";
  hash: string;
  prev_hash: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}
