/**
 * chaos/probes/injection-replay.ts — SQL, XSS, and command injection variants
 *
 * For every parameterized query that replaced string interpolation,
 * replays the original vector plus advanced variants: UNION SELECT,
 * time-based blind, second-order injection, NoSQL injection.
 */

export interface InjectionProbe {
  id: string;
  category: "injection-replay";
  target: { method: string; path: string };
  injection_type: "sql" | "xss" | "nosql" | "command" | "path-traversal";
  payload: Record<string, unknown>;
  description: string;
  expected_status: number[];
  severity_if_bypassed: "P0" | "P1" | "P2";
}

export function generateInjectionProbes(endpoints: Array<{
  method: string;
  path: string;
}>): InjectionProbe[] {
  const probes: InjectionProbe[] = [];
  let counter = 0;

  function nextId(): string {
    counter++;
    return `INJ-${String(counter).padStart(3, "0")}`;
  }

  // SQL injection vectors
  const sqlVectors = [
    { payload: "' OR '1'='1' --", desc: "Classic OR 1=1 bypass" },
    { payload: "' UNION SELECT NULL,NULL,NULL --", desc: "UNION SELECT column probe" },
    { payload: "'; DROP TABLE tasks; --", desc: "DROP TABLE via semicolon" },
    { payload: "' AND 1=1 --", desc: "Boolean-based blind (true)" },
    { payload: "' AND 1=2 --", desc: "Boolean-based blind (false)" },
    { payload: "' AND (SELECT CASE WHEN (1=1) THEN 1 ELSE (SELECT 1 UNION SELECT 2) END)='1", desc: "Conditional error-based" },
    { payload: "\\'; WAITFOR DELAY '0:0:5' --", desc: "Time-based blind (MSSQL)" },
    { payload: "'; SELECT pg_sleep(5); --", desc: "Time-based blind (PostgreSQL)" },
    { payload: "1; UPDATE users SET role='admin' WHERE email='attacker@test.com'", desc: "Second-order privilege escalation" },
  ];

  // Apply SQL vectors to endpoints that accept text input
  for (const endpoint of endpoints) {
    if (!["POST", "PUT", "PATCH"].includes(endpoint.method.toUpperCase()) &&
        !endpoint.path.includes("search")) continue;

    for (const vector of sqlVectors) {
      const fieldName = endpoint.path.includes("search") ? "q" : "title";
      probes.push({
        id: nextId(),
        category: "injection-replay",
        injection_type: "sql",
        target: endpoint,
        payload: { [fieldName]: vector.payload },
        description: `SQL injection: ${vector.desc} on ${endpoint.method} ${endpoint.path}`,
        expected_status: [200, 201, 400, 422], // Should NOT return 500
        severity_if_bypassed: "P0",
      });
    }
  }

  // XSS vectors for endpoints that store/return user content
  const xssVectors = [
    { payload: "<script>alert(1)</script>", desc: "Basic script tag" },
    { payload: "<img src=x onerror=alert(1)>", desc: "Event handler XSS" },
    { payload: "javascript:alert(1)", desc: "JavaScript protocol" },
    { payload: "<svg onload=alert(1)>", desc: "SVG onload" },
    { payload: "{{7*7}}", desc: "Template injection probe" },
    { payload: "${7*7}", desc: "Template literal injection" },
  ];

  for (const endpoint of endpoints) {
    if (!["POST", "PUT", "PATCH"].includes(endpoint.method.toUpperCase())) continue;

    for (const vector of xssVectors) {
      probes.push({
        id: nextId(),
        category: "injection-replay",
        injection_type: "xss",
        target: endpoint,
        payload: { "title": vector.payload, "description": vector.payload },
        description: `XSS: ${vector.desc} on ${endpoint.method} ${endpoint.path}`,
        expected_status: [200, 201, 400, 422],
        severity_if_bypassed: "P1",
      });
    }
  }

  // Path traversal
  for (const endpoint of endpoints) {
    if (!endpoint.path.includes(":id")) continue;

    const traversalVectors = [
      { path: endpoint.path.replace(":id", "../../etc/passwd"), desc: "Directory traversal" },
      { path: endpoint.path.replace(":id", "%2e%2e%2f%2e%2e%2f"), desc: "URL-encoded traversal" },
      { path: endpoint.path.replace(":id", "1 OR 1=1"), desc: "ID param SQL injection" },
    ];

    for (const vector of traversalVectors) {
      probes.push({
        id: nextId(),
        category: "injection-replay",
        injection_type: "path-traversal",
        target: { method: endpoint.method, path: vector.path },
        payload: {},
        description: `Path traversal: ${vector.desc} on ${endpoint.method} ${endpoint.path}`,
        expected_status: [400, 404, 422],
        severity_if_bypassed: "P0",
      });
    }
  }

  // NoSQL injection (relevant if the target uses MongoDB-like queries)
  for (const endpoint of endpoints) {
    if (!["POST", "PUT"].includes(endpoint.method.toUpperCase())) continue;

    probes.push({
      id: nextId(),
      category: "injection-replay",
      injection_type: "nosql",
      target: endpoint,
      payload: { "email": { "$gt": "" }, "password": { "$gt": "" } },
      description: `NoSQL operator injection on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P0",
    });
  }

  return probes;
}
