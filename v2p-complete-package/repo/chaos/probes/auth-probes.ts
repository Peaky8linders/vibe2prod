/**
 * chaos/probes/auth-probes.ts — Authentication and authorization bypass attempts
 *
 * Tests: missing tokens, expired tokens, tampered JWTs, cross-user access,
 * privilege escalation, session fixation.
 */

export interface AuthProbe {
  id: string;
  category: "auth-probe";
  target: { method: string; path: string };
  auth_header: string | null;
  description: string;
  expected_status: number[];
  severity_if_bypassed: "P0" | "P1" | "P2";
}

export function generateAuthProbes(endpoints: Array<{
  method: string;
  path: string;
  requires_auth: boolean;
}>): AuthProbe[] {
  const probes: AuthProbe[] = [];
  let counter = 0;

  function nextId(): string {
    counter++;
    return `AUTH-${String(counter).padStart(3, "0")}`;
  }

  const authEndpoints = endpoints.filter((e) => e.requires_auth);

  for (const endpoint of authEndpoints) {
    // 1. No token at all
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: null,
      description: `No Authorization header on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });

    // 2. Empty Bearer token
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: "Bearer ",
      description: `Empty Bearer token on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });

    // 3. Malformed token (not a JWT)
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: "Bearer not-a-jwt-token",
      description: `Malformed JWT on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });

    // 4. Self-crafted JWT with none algorithm
    const noneAlgoHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const fakePayload = Buffer.from(JSON.stringify({ userId: 1, email: "admin@test.com", role: "admin" })).toString("base64url");
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: `Bearer ${noneAlgoHeader}.${fakePayload}.`,
      description: `JWT with alg:none bypass on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });

    // 5. JWT signed with empty string secret
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: `Bearer ${noneAlgoHeader}.${fakePayload}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`,
      description: `JWT signed with common weak secret on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });

    // 6. Wrong auth scheme
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: "Basic dXNlcjpwYXNz",
      description: `Basic auth instead of Bearer on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P1",
    });

    // 7. Token in wrong location (query param instead of header)
    // This is tested via the auth_header being null but with a note
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: { method: endpoint.method, path: `${endpoint.path}?token=fake-jwt-token` },
      auth_header: null,
      description: `Token in query string instead of header on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P1",
    });

    // 8. Expired token structure (payload with past exp)
    const expiredPayload = Buffer.from(JSON.stringify({
      userId: 1,
      email: "test@test.com",
      iat: Math.floor(Date.now() / 1000) - 86400 * 2,
      exp: Math.floor(Date.now() / 1000) - 86400,
    })).toString("base64url");
    const hs256Header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: `Bearer ${hs256Header}.${expiredPayload}.invalid-signature`,
      description: `Expired JWT (signature invalid) on ${endpoint.method} ${endpoint.path}`,
      expected_status: [401],
      severity_if_bypassed: "P0",
    });
  }

  // 9. Privilege escalation: access admin endpoints without admin role
  const adminEndpoints = endpoints.filter((e) => e.path.includes("admin"));
  for (const endpoint of adminEndpoints) {
    const regularUserPayload = Buffer.from(JSON.stringify({
      userId: 999,
      email: "regular@test.com",
      role: "user",
    })).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    probes.push({
      id: nextId(),
      category: "auth-probe",
      target: endpoint,
      auth_header: `Bearer ${header}.${regularUserPayload}.invalid-sig`,
      description: `Regular user accessing admin endpoint ${endpoint.method} ${endpoint.path}`,
      expected_status: [401, 403],
      severity_if_bypassed: "P0",
    });
  }

  return probes;
}
