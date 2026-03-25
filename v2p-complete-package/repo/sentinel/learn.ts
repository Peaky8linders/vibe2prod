/**
 * sentinel/learn.ts — Process production signals into new defect taxonomy entries
 *
 * Reads sentinel events from .vibecheck/sentinel.jsonl, clusters by pattern,
 * deduplicates, assigns priority, and generates new defects tagged
 * with source: "production".
 *
 * Usage:
 *   npx tsx sentinel/learn.ts                             # analyze events
 *   npx tsx sentinel/learn.ts --merge                     # merge into taxonomy
 *   npx tsx sentinel/learn.ts --from .vibecheck/sentinel.jsonl  # custom path
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentinelEvent {
  timestamp: string;
  type: "rejected-input" | "auth-failure" | "unhandled-error" | "rate-limit-hit" | "anomalous-payload";
  endpoint: string;
  method: string;
  ip_hash: string;
  user_agent: string;
  pattern: Record<string, unknown>;
}

interface EventCluster {
  type: SentinelEvent["type"];
  endpoint: string;
  method: string;
  count: number;
  unique_ips: Set<string>;
  first_seen: string;
  last_seen: string;
  sample_patterns: Array<Record<string, unknown>>;
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
// Event Processing
// ---------------------------------------------------------------------------

function loadEvents(path: string): SentinelEvent[] {
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as SentinelEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is SentinelEvent => e !== null);
}

function clusterEvents(events: SentinelEvent[]): EventCluster[] {
  const clusters = new Map<string, EventCluster>();

  for (const event of events) {
    const key = `${event.type}:${event.method}:${event.endpoint}`;

    if (!clusters.has(key)) {
      clusters.set(key, {
        type: event.type,
        endpoint: event.endpoint,
        method: event.method,
        count: 0,
        unique_ips: new Set(),
        first_seen: event.timestamp,
        last_seen: event.timestamp,
        sample_patterns: [],
      });
    }

    const cluster = clusters.get(key)!;
    cluster.count++;
    cluster.unique_ips.add(event.ip_hash);
    cluster.last_seen = event.timestamp;

    if (cluster.sample_patterns.length < 3) {
      cluster.sample_patterns.push(event.pattern);
    }
  }

  return Array.from(clusters.values()).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Triage: Cluster → Defect
// ---------------------------------------------------------------------------

function triageClusters(clusters: EventCluster[]): Defect[] {
  const defects: Defect[] = [];
  let counter = 0;
  const timestamp = new Date().toISOString();

  function nextId(): string {
    counter++;
    return `PROD-${String(counter).padStart(3, "0")}`;
  }

  for (const cluster of clusters) {
    // Skip low-frequency events (likely noise)
    if (cluster.count < 3) continue;

    let priority: "P0" | "P1" | "P2" | "P3";
    let dimension: string;
    let description: string;

    switch (cluster.type) {
      case "unhandled-error":
        // Unhandled errors are always high priority — a code path exists
        // that the hardening loop didn't cover
        priority = cluster.count > 10 ? "P0" : "P1";
        dimension = "error-handling";
        description = `[production] Unhandled error on ${cluster.method} ${cluster.endpoint} — ${cluster.count} occurrences from ${cluster.unique_ips.size} IPs`;
        break;

      case "auth-failure":
        // Clustered auth failures indicate active scanning or brute force
        priority = cluster.unique_ips.size > 5 ? "P1" : "P2";
        dimension = "security";
        description = `[production] Auth failures on ${cluster.method} ${cluster.endpoint} — ${cluster.count} attempts from ${cluster.unique_ips.size} IPs`;
        break;

      case "anomalous-payload":
        // Anomalous payloads suggest active attack attempts
        priority = "P1";
        dimension = "security";
        const anomalies = cluster.sample_patterns
          .flatMap((p) => (p["anomalies"] as string[]) ?? [])
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ");
        description = `[production] Anomalous payloads on ${cluster.method} ${cluster.endpoint} — patterns: ${anomalies}`;
        break;

      case "rate-limit-hit":
        // Rate limit hits indicate endpoints under heavy load
        priority = "P2";
        dimension = "security";
        description = `[production] Rate limit triggered on ${cluster.method} ${cluster.endpoint} — ${cluster.count} hits from ${cluster.unique_ips.size} IPs`;
        break;

      case "rejected-input":
        // Repeated rejected inputs may indicate validation gaps
        priority = cluster.count > 20 ? "P1" : "P2";
        dimension = "input-validation";
        description = `[production] Repeated input rejections on ${cluster.method} ${cluster.endpoint} — ${cluster.count} rejections, may indicate validation gap`;
        break;

      default:
        continue;
    }

    defects.push({
      id: nextId(),
      dimension,
      priority,
      file: `sentinel:${cluster.method}:${cluster.endpoint}`,
      line_range: null,
      description,
      fixed: false,
      fix_commit: null,
      attempts: 0,
      needs_human_review: priority === "P0",
      source: "production",
      discovered_at: timestamp,
    });
  }

  return defects;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const mergeIntoTaxonomy = args.includes("--merge");
  const fromIdx = args.indexOf("--from");
  const eventPath = fromIdx >= 0 ? args[fromIdx + 1]! : ".vibecheck/sentinel.jsonl";

  console.log(`\x1b[34m[learn]\x1b[0m Reading production signals from ${eventPath}...\n`);

  const events = loadEvents(eventPath);

  if (events.length === 0) {
    console.log("\x1b[34m[learn]\x1b[0m No sentinel events found.");
    console.log("\x1b[2mTo start collecting: app.use(vcSentinel()) in your Express app\x1b[0m");
    return;
  }

  console.log(`\x1b[34m[learn]\x1b[0m Loaded ${events.length} events\n`);

  // Cluster events
  const clusters = clusterEvents(events);

  console.log(`\x1b[34m[learn]\x1b[0m ${clusters.length} event clusters:\n`);
  for (const cluster of clusters.slice(0, 10)) {
    const typeColor = cluster.type === "unhandled-error" ? "\x1b[31m" :
                      cluster.type === "auth-failure" ? "\x1b[33m" :
                      cluster.type === "anomalous-payload" ? "\x1b[35m" :
                      "\x1b[2m";
    console.log(`  ${typeColor}${cluster.type.padEnd(20)}\x1b[0m ${cluster.method.padEnd(6)} ${cluster.endpoint.padEnd(25)} ${cluster.count}x (${cluster.unique_ips.size} IPs)`);
  }
  if (clusters.length > 10) {
    console.log(`  ... and ${clusters.length - 10} more clusters`);
  }

  // Triage into defects
  const defects = triageClusters(clusters);

  if (defects.length > 0) {
    console.log(`\n\x1b[34m[learn]\x1b[0m ${defects.length} production-discovered defects:\n`);
    for (const d of defects) {
      const priority = d.priority === "P0" ? "\x1b[31m" :
                       d.priority === "P1" ? "\x1b[33m" : "\x1b[2m";
      console.log(`  ${priority}[${d.priority}]\x1b[0m ${d.description}`);
    }
  } else {
    console.log(`\n\x1b[32m[learn]\x1b[0m No actionable patterns found in production signals.`);
  }

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
      console.log(`\n\x1b[32m[learn]\x1b[0m Merged ${added} new defects into ${taxPath}`);
    }
  }

  // Write standalone report
  const reportPath = "logs/learn-report.json";
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    events_processed: events.length,
    clusters: clusters.length,
    defects_discovered: defects.length,
    clusters_detail: clusters.map((c) => ({
      ...c,
      unique_ips: c.unique_ips.size,
    })),
    defects,
  }, null, 2));
  console.log(`\n\x1b[34m[learn]\x1b[0m Report written to ${reportPath}`);
}

main();
