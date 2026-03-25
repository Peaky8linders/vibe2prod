/**
 * scanners/evidence-scanner.ts — Tamper-Proof Audit Trail
 *
 * Creates and verifies a SHA-256 hash-linked evidence chain for scan results.
 * Borrowed from AI Compliance Product's evidence/store.py pattern.
 *
 * Each scan result gets chained to the previous one, creating a verifiable
 * audit trail from "vibe-coded" to "production-ready."
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EvidenceEntry } from "./plugin-interface.js";

const CHAIN_FILE = "logs/evidence-chain.jsonl";

// ---------------------------------------------------------------------------
// Evidence Chain Operations
// ---------------------------------------------------------------------------

function computeHash(entry: Omit<EvidenceEntry, "hash">): string {
  const payload = JSON.stringify({
    seq: entry.seq,
    type: entry.type,
    prev_hash: entry.prev_hash,
    timestamp: entry.timestamp,
    data: entry.data,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function readChain(chainPath: string): EvidenceEntry[] {
  if (!existsSync(chainPath)) return [];
  const lines = readFileSync(chainPath, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as EvidenceEntry);
}

/** Append a new entry to the evidence chain */
export function appendEvidence(
  type: EvidenceEntry["type"],
  data: Record<string, unknown>,
  chainPath: string = CHAIN_FILE,
): EvidenceEntry {
  const chain = readChain(chainPath);
  const lastEntry = chain.length > 0 ? chain[chain.length - 1]! : null;

  const entry: Omit<EvidenceEntry, "hash"> = {
    seq: (lastEntry?.seq ?? 0) + 1,
    type,
    prev_hash: lastEntry?.hash ?? null,
    timestamp: new Date().toISOString(),
    data,
  };

  const hash = computeHash(entry);
  const fullEntry: EvidenceEntry = { ...entry, hash };

  mkdirSync(dirname(chainPath), { recursive: true });
  writeFileSync(chainPath, JSON.stringify(fullEntry) + "\n", { flag: "a" });

  return fullEntry;
}

/** Verify the integrity of the entire evidence chain */
export function verifyChain(chainPath: string = CHAIN_FILE): {
  valid: boolean;
  entries: number;
  first_scan: string | null;
  last_scan: string | null;
  broken_at: number | null;
  summary: string;
} {
  const chain = readChain(chainPath);

  if (chain.length === 0) {
    return {
      valid: true,
      entries: 0,
      first_scan: null,
      last_scan: null,
      broken_at: null,
      summary: "No evidence chain found. Run a scan to start tracking.",
    };
  }

  // Verify each entry
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;

    // Verify hash
    const { hash: storedHash, ...rest } = entry;
    const expectedHash = computeHash(rest);
    if (storedHash !== expectedHash) {
      return {
        valid: false,
        entries: chain.length,
        first_scan: chain[0]!.timestamp,
        last_scan: chain[chain.length - 1]!.timestamp,
        broken_at: entry.seq,
        summary: `TAMPERED: Entry #${entry.seq} hash mismatch. Expected ${expectedHash.substring(0, 12)}..., got ${storedHash.substring(0, 12)}...`,
      };
    }

    // Verify chain linkage
    if (i > 0) {
      const prevEntry = chain[i - 1]!;
      if (entry.prev_hash !== prevEntry.hash) {
        return {
          valid: false,
          entries: chain.length,
          first_scan: chain[0]!.timestamp,
          last_scan: chain[chain.length - 1]!.timestamp,
          broken_at: entry.seq,
          summary: `BROKEN CHAIN: Entry #${entry.seq} prev_hash doesn't match entry #${prevEntry.seq}`,
        };
      }
    }

    // First entry should have null prev_hash
    if (i === 0 && entry.prev_hash !== null) {
      return {
        valid: false,
        entries: chain.length,
        first_scan: chain[0]!.timestamp,
        last_scan: chain[chain.length - 1]!.timestamp,
        broken_at: 1,
        summary: "BROKEN CHAIN: First entry has non-null prev_hash",
      };
    }
  }

  // Count by type
  const scanCount = chain.filter((e) => e.type === "scan").length;
  const fixCount = chain.filter((e) => e.type === "fix").length;
  const complyCount = chain.filter((e) => e.type === "comply").length;

  return {
    valid: true,
    entries: chain.length,
    first_scan: chain[0]!.timestamp,
    last_scan: chain[chain.length - 1]!.timestamp,
    broken_at: null,
    summary: `VERIFIED: ${chain.length} entries (${scanCount} scans, ${fixCount} fixes, ${complyCount} compliance checks). Chain integrity confirmed.`,
  };
}
