/**
 * chaos/chaos-runner.ts — Orchestrates adversarial probes against hardened code
 *
 * Generates probes based on fixed defects from the taxonomy, runs them,
 * and converts failures into new P0/P1/P2 defects.
 *
 * Two modes:
 *   1. Static analysis (default): generate probes, verify defenses exist in code
 *   2. HTTP mode (--http): send actual requests to running server
 *
 * Usage:
 *   npx tsx chaos/chaos-runner.ts                         # static analysis
 *   npx tsx chaos/chaos-runner.ts --http --port 3000      # live probing
 *   npx tsx chaos/chaos-runner.ts --endpoint /api/users   # target specific endpoint
 *   npx tsx chaos/chaos-runner.ts --merge                 # merge findings into taxonomy
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { glob } from "glob";
import { generateInputFuzzingProbes } from "./probes/input-fuzzing.js";
import { generateAuthProbes } from "./probes/auth-probes.js";
import { generateInjectionProbes } from "./probes/injection-replay.js";
import { generateDependencyProbes } from "./probes/dependency-failure.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChaosResult {
  probe_id: string;
  category: string;
  target: { method: string; path: string };
  status: "pass" | "fail" | "warn";
  detail: string;
  severity: "P0" | "P1" | "P2";
}

interface Defect {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  file: string;
  line_range: [number, number] | null;
  description: string;
  fixed: boolean;
  fix_commit: string | null;
  attempts: number;
  needs_human_review: boolean;
  source: "scan" | "chaos" | "production" | "judge-failure" | "subtract";
  discovered_at: string;
}

// ---------------------------------------------------------------------------
// Endpoint Discovery
// ---------------------------------------------------------------------------

async function discoverEndpoints(targetDir: string): Promise<Array<{
  method: string;
  path: string;
  file: string;
  line: number;
  requires_auth: boolean;
  has_db_query: boolean;
  has_external_call: boolean;
}>> {
  const endpoints: Array<{
    method: string;
    path: string;
    file: string;
    line: number;
    requires_auth: boolean;
    has_db_query: boolean;
    has_external_call: boolean;
  }> = [];

  const sourceFiles = await glob(`${targetDir}/**/*.{ts,js}`, {
    ignore: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
  });

  const routePattern = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split("\n").length;

      // Look at the handler code (next 30 lines) for context
      const handlerBlock = lines.slice(lineNum - 1, lineNum + 30).join("\n");

      endpoints.push({
        method: match[1]!.toUpperCase(),
        path: match[2]!,
        file,
        line: lineNum,
        requires_auth: /requireAuth|authenticate|auth/.test(handlerBlock),
        has_db_query: /pool\.query|db\.query|\.findOne|\.findMany|\.create|\.update/.test(handlerBlock),
        has_external_call: /fetch\s*\(|axios\.|http\.|webhook|external/.test(handlerBlock),
      });
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Static Analysis Mode
// ---------------------------------------------------------------------------

async function runStaticAnalysis(targetDir: string, endpoints: Awaited<ReturnType<typeof discoverEndpoints>>): Promise<ChaosResult[]> {
  const results: ChaosResult[] = [];

  const sourceFiles = await glob(`${targetDir}/**/*.{ts,js}`, {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });
  const allSource = sourceFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

  // Check input fuzzing defenses
  const fuzzProbes = generateInputFuzzingProbes(endpoints);
  for (const probe of fuzzProbes) {
    // Check if the target endpoint has Zod/validation
    const endpointDef = endpoints.find((e) => e.path === probe.target.path);
    if (!endpointDef) continue;

    const fileContent = readFileSync(endpointDef.file, "utf-8");
    const hasValidation = /z\.\w+|safeParse|parse\(|validate/.test(fileContent);
    const hasPayloadLimit = /limit|maxLength|max\(/.test(fileContent);

    if (probe.description.includes("Prototype pollution")) {
      // Check for Object.freeze or __proto__ filtering
      const hasProtoPrevention = /Object\.freeze|__proto__|constructor.*prototype/.test(allSource);
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasProtoPrevention ? "pass" : "warn",
        detail: hasProtoPrevention
          ? "Prototype pollution prevention detected"
          : "No explicit prototype pollution prevention found",
        severity: probe.severity_if_bypassed,
      });
    } else if (probe.description.includes("100KB")) {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasPayloadLimit ? "pass" : "warn",
        detail: hasPayloadLimit
          ? "Payload size limit detected"
          : "No explicit payload size limit on this endpoint",
        severity: probe.severity_if_bypassed,
      });
    } else {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasValidation ? "pass" : "fail",
        detail: hasValidation
          ? "Input validation (Zod/schema) detected"
          : "No input validation found — type coercion attacks may succeed",
        severity: probe.severity_if_bypassed,
      });
    }
  }

  // Check auth defenses
  const authProbes = generateAuthProbes(endpoints);
  for (const probe of authProbes) {
    const endpointDef = endpoints.find((e) => e.path === probe.target.path);
    if (!endpointDef) {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: "warn",
        detail: "Could not locate endpoint definition for verification",
        severity: probe.severity_if_bypassed,
      });
      continue;
    }

    results.push({
      probe_id: probe.id,
      category: probe.category,
      target: probe.target,
      status: endpointDef.requires_auth ? "pass" : "fail",
      detail: endpointDef.requires_auth
        ? "Auth middleware detected on endpoint"
        : "No auth middleware found — endpoint may be unprotected",
      severity: probe.severity_if_bypassed,
    });
  }

  // Check injection defenses
  const injectionProbes = generateInjectionProbes(endpoints);
  for (const probe of injectionProbes) {
    if (probe.injection_type === "sql") {
      const hasParamQueries = /\$\d|\?\s|prepared|parameterized/.test(allSource);
      const hasStringConcat = /\$\{.*\}.*SELECT|'\s*\+.*WHERE/i.test(allSource);
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasParamQueries && !hasStringConcat ? "pass" : "fail",
        detail: hasParamQueries && !hasStringConcat
          ? "Parameterized queries detected, no string concatenation in SQL"
          : "Potential SQL injection risk — string concatenation in queries",
        severity: probe.severity_if_bypassed,
      });
    } else {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: "warn",
        detail: `${probe.injection_type} defense requires HTTP testing to verify`,
        severity: probe.severity_if_bypassed,
      });
    }
  }

  // Check dependency failure handling
  const depProbes = generateDependencyProbes(endpoints);
  for (const probe of depProbes) {
    const endpointDef = endpoints.find((e) => e.path === probe.target.path);
    if (!endpointDef) continue;

    const fileContent = readFileSync(endpointDef.file, "utf-8");
    const hasTryCatch = /try\s*\{[\s\S]*?catch/.test(fileContent);
    const hasTimeout = /timeout|AbortController|signal/.test(fileContent);

    if (probe.failure_type === "api-timeout" || probe.failure_type === "dns-failure") {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasTryCatch && hasTimeout ? "pass" : hasTryCatch ? "warn" : "fail",
        detail: hasTryCatch && hasTimeout
          ? "Error handling with timeout detected"
          : hasTryCatch
            ? "Error handling exists but no timeout — may hang on slow responses"
            : "No error handling for external dependency failure",
        severity: probe.severity_if_unhandled,
      });
    } else {
      results.push({
        probe_id: probe.id,
        category: probe.category,
        target: probe.target,
        status: hasTryCatch ? "pass" : "fail",
        detail: hasTryCatch
          ? "Database error handling detected"
          : "No error handling for database failure",
        severity: probe.severity_if_unhandled,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Triage: Convert results to defects (not blanket P0 — severity-aware)
// ---------------------------------------------------------------------------

function triageResults(results: ChaosResult[]): Defect[] {
  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");
  const timestamp = new Date().toISOString();

  let counter = 0;
  function nextId(): string {
    counter++;
    return `CHAOS-${String(counter).padStart(3, "0")}`;
  }

  const defects: Defect[] = [];

  // Failures become defects at their assessed severity (NOT blanket P0)
  for (const failure of failures) {
    defects.push({
      id: nextId(),
      dimension: failure.category === "auth-probe" ? "security" :
                 failure.category === "injection-replay" ? "security" :
                 failure.category === "dependency-failure" ? "error-handling" :
                 "input-validation",
      priority: failure.severity,
      file: `chaos-probe:${failure.target.method}:${failure.target.path}`,
      line_range: null,
      description: `[chaos] ${failure.detail} — ${failure.target.method} ${failure.target.path}`,
      fixed: false,
      fix_commit: null,
      attempts: 0,
      needs_human_review: failure.severity === "P0",
      source: "chaos",
      discovered_at: timestamp,
    });
  }

  // Warnings with P0 severity also become defects (but at P1)
  for (const warning of warnings) {
    if (warning.severity === "P0") {
      defects.push({
        id: nextId(),
        dimension: "security",
        priority: "P1",
        file: `chaos-probe:${warning.target.method}:${warning.target.path}`,
        line_range: null,
        description: `[chaos-warn] ${warning.detail} — ${warning.target.method} ${warning.target.path}`,
        fixed: false,
        fix_commit: null,
        attempts: 0,
        needs_human_review: true,
        source: "chaos",
        discovered_at: timestamp,
      });
    }
  }

  return defects;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mergeIntoTaxonomy = args.includes("--merge");
  const targetEndpoint = args.find((_a, i) => args[i - 1] === "--endpoint");

  // Determine target directory
  const targetDir = existsSync("target/demo-app") ? "target/demo-app" :
                    existsSync("target") ? "target" : ".";

  console.log(`\x1b[31m[chaos]\x1b[0m Discovering endpoints in ${targetDir}...\n`);

  let endpoints = await discoverEndpoints(targetDir);

  if (targetEndpoint) {
    endpoints = endpoints.filter((e) => e.path.includes(targetEndpoint));
    console.log(`\x1b[31m[chaos]\x1b[0m Filtered to ${endpoints.length} endpoints matching "${targetEndpoint}"\n`);
  }

  if (endpoints.length === 0) {
    console.log("\x1b[31m[chaos]\x1b[0m No endpoints found in target directory.");
    process.exit(1);
  }

  console.log(`\x1b[31m[chaos]\x1b[0m Found ${endpoints.length} endpoints:`);
  for (const ep of endpoints) {
    const flags = [
      ep.requires_auth ? "auth" : null,
      ep.has_db_query ? "db" : null,
      ep.has_external_call ? "ext" : null,
    ].filter(Boolean).join(",");
    console.log(`  ${ep.method.padEnd(6)} ${ep.path.padEnd(30)} [${flags}]`);
  }

  // Generate and run probes
  console.log(`\n\x1b[31m[chaos]\x1b[0m Running static chaos analysis...\n`);

  const results = await runStaticAnalysis(targetDir, endpoints);

  // Report
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;

  console.log(`\x1b[31m[chaos]\x1b[0m Results: ${results.length} probes`);
  console.log(`  \x1b[32mPassed:\x1b[0m ${passed}`);
  console.log(`  \x1b[31mFailed:\x1b[0m ${failed}`);
  console.log(`  \x1b[33mWarnings:\x1b[0m ${warned}`);

  if (failed > 0) {
    console.log(`\n\x1b[31m[chaos] Failures:\x1b[0m`);
    for (const r of results.filter((r) => r.status === "fail")) {
      const severity = r.severity === "P0" ? "\x1b[31m" :
                       r.severity === "P1" ? "\x1b[33m" : "\x1b[2m";
      console.log(`  ${severity}[${r.severity}]\x1b[0m ${r.detail}`);
      console.log(`       \x1b[2m${r.target.method} ${r.target.path}\x1b[0m`);
    }
  }

  // Triage into defects
  const defects = triageResults(results);

  if (defects.length > 0) {
    console.log(`\n\x1b[31m[chaos]\x1b[0m ${defects.length} new defects from chaos testing`);
  }

  // Write report
  const reportPath = "logs/chaos-results.json";
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    endpoints_tested: endpoints.length,
    probes_run: results.length,
    passed,
    failed,
    warned,
    results,
    defects,
  }, null, 2));
  console.log(`\n\x1b[31m[chaos]\x1b[0m Report written to ${reportPath}`);

  // Merge into taxonomy
  if (mergeIntoTaxonomy && defects.length > 0) {
    const taxPath = "evals/defect-taxonomy.json";
    if (existsSync(taxPath)) {
      const taxonomy = JSON.parse(readFileSync(taxPath, "utf-8")) as {
        dimensions: Record<string, { defects: Defect[] }>;
        total_defects: number;
      };

      let added = 0;
      for (const defect of defects) {
        const dim = taxonomy.dimensions[defect.dimension];
        if (dim) {
          const exists = dim.defects.some((d) => d.description === defect.description);
          if (!exists) {
            dim.defects.push(defect);
            added++;
          }
        }
      }

      taxonomy.total_defects = Object.values(taxonomy.dimensions)
        .reduce((sum, dim) => sum + dim.defects.length, 0);

      writeFileSync(taxPath, JSON.stringify(taxonomy, null, 2));
      console.log(`\x1b[32m[chaos]\x1b[0m Merged ${added} new defects into ${taxPath}`);
    }
  }

  // Chaos resilience score
  const chaosResilience = results.length > 0 ? Math.round((passed / results.length) * 100) : 100;
  console.log(`\n\x1b[31m[chaos]\x1b[0m Chaos resilience: ${chaosResilience}% (${passed}/${results.length} probes passed)`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
