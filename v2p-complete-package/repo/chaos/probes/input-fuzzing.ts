/**
 * chaos/probes/input-fuzzing.ts — Schema bypass and type coercion attacks
 *
 * Generates adversarial inputs that attempt to bypass Zod validation.
 * Tests: type coercion, prototype pollution, unicode tricks, oversized
 * payloads, null bytes, boundary values.
 */

export interface ChaosProbe {
  id: string;
  category: "input-fuzzing";
  target: { method: string; path: string };
  payload: unknown;
  description: string;
  expected_status: number[];
  severity_if_bypassed: "P0" | "P1" | "P2";
}

export function generateInputFuzzingProbes(endpoints: Array<{
  method: string;
  path: string;
  schema_fields?: string[];
}>): ChaosProbe[] {
  const probes: ChaosProbe[] = [];
  let counter = 0;

  function nextId(): string {
    counter++;
    return `FUZZ-${String(counter).padStart(3, "0")}`;
  }

  for (const endpoint of endpoints) {
    // Only fuzz POST/PUT/PATCH endpoints (ones that accept bodies)
    if (!["POST", "PUT", "PATCH"].includes(endpoint.method.toUpperCase())) continue;

    // 1. Prototype pollution attempts
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "__proto__": { "isAdmin": true }, "title": "test" },
      description: `Prototype pollution via __proto__ on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P0",
    });

    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "constructor": { "prototype": { "isAdmin": true } }, "title": "test" },
      description: `Prototype pollution via constructor.prototype on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P0",
    });

    // 2. Type coercion attacks
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": ["array", "instead", "of", "string"] },
      description: `Array instead of string for title on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P1",
    });

    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": { "toString": "injected" } },
      description: `Object with toString override on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P1",
    });

    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": true, "priority": 42 },
      description: `Boolean/number type coercion on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P1",
    });

    // 3. Unicode and encoding tricks
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": "test\u0000injected\u0000null\u0000bytes" },
      description: `Null byte injection in string field on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422, 201, 200], // May be accepted if sanitized
      severity_if_bypassed: "P2",
    });

    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": "\u202Emalicious\u202C" },
      description: `Unicode RTL override in string on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422, 201, 200],
      severity_if_bypassed: "P2",
    });

    // 4. Oversized payloads
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": "A".repeat(100_000) },
      description: `100KB string in title field on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 413, 422],
      severity_if_bypassed: "P1",
    });

    // 5. Deeply nested objects
    let nested: Record<string, unknown> = { "value": "deep" };
    for (let i = 0; i < 50; i++) {
      nested = { "nested": nested };
    }
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: nested,
      description: `50-level nested object on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P2",
    });

    // 6. Empty and null payloads
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: null,
      description: `Null body on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P1",
    });

    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: "",
      description: `Empty string body on ${endpoint.method} ${endpoint.path}`,
      expected_status: [400, 422],
      severity_if_bypassed: "P1",
    });

    // 7. SQL-like strings in fields (should be harmless with parameterized queries)
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": "'; DROP TABLE tasks; --" },
      description: `SQL injection string in field on ${endpoint.method} ${endpoint.path}`,
      expected_status: [201, 200, 400], // Should be treated as a normal string
      severity_if_bypassed: "P0",
    });

    // 8. XSS payloads in fields
    probes.push({
      id: nextId(),
      category: "input-fuzzing",
      target: endpoint,
      payload: { "title": "<script>alert('xss')</script>" },
      description: `XSS payload in field on ${endpoint.method} ${endpoint.path}`,
      expected_status: [201, 200, 400],
      severity_if_bypassed: "P1",
    });
  }

  return probes;
}
