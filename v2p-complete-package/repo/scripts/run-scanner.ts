#!/usr/bin/env tsx
/**
 * scripts/run-scanner.ts — Run a specific scanner plugin against target files
 *
 * Usage: tsx scripts/run-scanner.ts <scanner-name> [--path <dir>] [--json]
 *
 * Loads the named scanner from scanners/<name>-scanner.ts and runs it
 * against all source files in the target directory.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { glob } from "glob";
import type { ScannerPlugin, FileDefect } from "../scanners/plugin-interface.js";

const KNOWN_SCANNERS = ["performance", "observability", "api-contract", "compliance", "governance", "evidence"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

// Parse args
const args = process.argv.slice(2);
const scannerName = args[0];
const pathIdx = args.indexOf("--path");
const targetPath = pathIdx >= 0 ? resolve(args[pathIdx + 1] ?? ".") : resolve(ROOT, "target/demo-app");
const jsonOutput = args.includes("--json");

if (!scannerName || !KNOWN_SCANNERS.includes(scannerName)) {
  console.error(`${RED}Usage: run-scanner.ts <scanner-name> [--path <dir>] [--json]${NC}`);
  console.error(`${DIM}Available scanners: ${KNOWN_SCANNERS.join(", ")}${NC}`);
  process.exit(1);
}

// Language mapping
const LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
  ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".sql": "sql", ".json": "json",
};

async function main() {
  // Dynamic import of the scanner
  const scannerPath = resolve(ROOT, `scanners/${scannerName}-scanner.ts`);
  if (!existsSync(scannerPath)) {
    console.error(`${RED}Scanner not found: ${scannerPath}${NC}`);
    process.exit(1);
  }

  const mod = await import(pathToFileURL(scannerPath).href);
  const scanner: ScannerPlugin = mod.default;

  if (!scanner?.name || typeof scanner.scan !== "function") {
    console.error(`${RED}Invalid scanner module: ${scannerPath} — missing name or scan()${NC}`);
    process.exit(1);
  }

  if (!jsonOutput) {
    console.log(`${CYAN}Running ${scanner.name} scanner on ${targetPath}${NC}\n`);
  }

  // Find source files
  const files = await glob("**/*.{ts,js,tsx,jsx,mjs,cjs,py,sql}", {
    cwd: targetPath,
    ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/*.test.*", "**/*.spec.*"],
    absolute: true,
  });

  if (files.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ scanner: scanner.name, files_scanned: 0, defects: [] }));
    } else {
      console.log(`${YELLOW}No source files found in ${targetPath}${NC}`);
    }
    process.exit(0);
  }

  // Run scanner on each file
  const allDefects: Array<FileDefect & { file: string }> = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const ext = extname(filePath);
    const language = LANG_MAP[ext] ?? "unknown";
    const defects = scanner.scan(filePath, content, language);

    for (const d of defects) {
      allDefects.push({ ...d, file: relative(targetPath, filePath) });
    }
  }

  // Sort by priority
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allDefects.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  if (jsonOutput) {
    console.log(JSON.stringify({
      scanner: scanner.name,
      files_scanned: files.length,
      total_defects: allDefects.length,
      by_priority: {
        P0: allDefects.filter((d) => d.priority === "P0").length,
        P1: allDefects.filter((d) => d.priority === "P1").length,
        P2: allDefects.filter((d) => d.priority === "P2").length,
        P3: allDefects.filter((d) => d.priority === "P3").length,
      },
      defects: allDefects,
    }, null, 2));
  } else {
    // Pretty print
    const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const d of allDefects) byPriority[d.priority]++;

    console.log(`  Files scanned:  ${files.length}`);
    console.log(`  Total findings: ${allDefects.length}`);
    console.log(`  P0 (critical):  ${byPriority.P0 > 0 ? RED : GREEN}${byPriority.P0}${NC}`);
    console.log(`  P1 (must fix):  ${byPriority.P1 > 0 ? YELLOW : GREEN}${byPriority.P1}${NC}`);
    console.log(`  P2 (should fix): ${byPriority.P2}${NC}`);
    console.log(`  P3 (nice to have): ${byPriority.P3}${NC}\n`);

    for (const d of allDefects) {
      const color = d.priority === "P0" ? RED : d.priority === "P1" ? YELLOW : DIM;
      console.log(`  ${color}[${d.priority}]${NC} ${d.id} — ${d.description}`);
      console.log(`  ${DIM}${d.file}${d.line ? `:${d.line}` : ""}${NC}`);
      console.log(`  ${DIM}Fix: ${d.fix_hint}${NC}\n`);
    }

    if (allDefects.length === 0) {
      console.log(`  ${GREEN}No findings — looking good!${NC}\n`);
    }
  }
}

main().catch((err) => {
  console.error(`${RED}Scanner error: ${err.message}${NC}`);
  process.exit(1);
});
