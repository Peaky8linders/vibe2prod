/**
 * chaos/probes/dependency-failure.ts — External dependency failure simulation
 *
 * Verifies graceful degradation when dependencies fail: database connection
 * drops, external API timeouts, Redis unavailability, DNS failures.
 *
 * These probes work by analyzing code paths for proper error handling,
 * not by actually killing dependencies. For live chaos testing,
 * use the HTTP mode with actual fault injection.
 */

export interface DependencyProbe {
  id: string;
  category: "dependency-failure";
  failure_type: "db-timeout" | "db-connection-drop" | "api-timeout" | "dns-failure" | "malformed-response";
  target: { method: string; path: string };
  description: string;
  expected_behavior: string;
  severity_if_unhandled: "P0" | "P1" | "P2";
}

export function generateDependencyProbes(endpoints: Array<{
  method: string;
  path: string;
  has_db_query: boolean;
  has_external_call: boolean;
}>): DependencyProbe[] {
  const probes: DependencyProbe[] = [];
  let counter = 0;

  function nextId(): string {
    counter++;
    return `DEP-${String(counter).padStart(3, "0")}`;
  }

  for (const endpoint of endpoints) {
    // Database failure probes
    if (endpoint.has_db_query) {
      probes.push({
        id: nextId(),
        category: "dependency-failure",
        failure_type: "db-timeout",
        target: endpoint,
        description: `Database query timeout on ${endpoint.method} ${endpoint.path}`,
        expected_behavior: "Return 503 Service Unavailable with retry-after header",
        severity_if_unhandled: "P1",
      });

      probes.push({
        id: nextId(),
        category: "dependency-failure",
        failure_type: "db-connection-drop",
        target: endpoint,
        description: `Database connection pool exhausted on ${endpoint.method} ${endpoint.path}`,
        expected_behavior: "Return 503 with structured error log, not crash process",
        severity_if_unhandled: "P0",
      });
    }

    // External API failure probes
    if (endpoint.has_external_call) {
      probes.push({
        id: nextId(),
        category: "dependency-failure",
        failure_type: "api-timeout",
        target: endpoint,
        description: `External API timeout on ${endpoint.method} ${endpoint.path}`,
        expected_behavior: "Return partial success or queued response, not 500",
        severity_if_unhandled: "P1",
      });

      probes.push({
        id: nextId(),
        category: "dependency-failure",
        failure_type: "dns-failure",
        target: endpoint,
        description: `DNS resolution failure for external API on ${endpoint.method} ${endpoint.path}`,
        expected_behavior: "Catch ENOTFOUND, return 502 or degrade gracefully",
        severity_if_unhandled: "P1",
      });

      probes.push({
        id: nextId(),
        category: "dependency-failure",
        failure_type: "malformed-response",
        target: endpoint,
        description: `External API returns malformed JSON on ${endpoint.method} ${endpoint.path}`,
        expected_behavior: "Catch parse error, return 502 with structured log",
        severity_if_unhandled: "P2",
      });
    }
  }

  return probes;
}
