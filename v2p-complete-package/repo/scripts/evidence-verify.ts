/**
 * scripts/evidence-verify.ts — Verify evidence chain integrity
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyChain } from "../scanners/evidence-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m";

const chainPath = resolve(ROOT, "logs", "evidence-chain.jsonl");
const result = verifyChain(chainPath);

console.log(`\n${BOLD}  EVIDENCE CHAIN VERIFICATION${NC}\n`);
console.log(`  Status:  ${result.valid ? GREEN + "VERIFIED" : RED + "BROKEN"}${NC}`);
console.log(`  Entries: ${result.entries}`);
if (result.first_scan) console.log(`  First:   ${result.first_scan}`);
if (result.last_scan) console.log(`  Last:    ${result.last_scan}`);
if (result.broken_at) console.log(`  ${RED}Broken at entry #${result.broken_at}${NC}`);
console.log(`\n  ${result.summary}\n`);

if (!result.valid) process.exit(1);
