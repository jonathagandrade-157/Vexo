import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function verifyKeyCutover({ apiUrl, projectRef, mode, publishableKey, secretKey, legacyAnonKey, legacyServiceKey, synthetic = false }, fetcher = fetch) {
  const url = new URL(apiUrl);
  if (!(synthetic && projectRef === "local" && LOOPBACK.has(url.hostname)) && url.origin !== `https://${projectRef}.supabase.co`) {
    throw new Error("Key probe origin does not match the approved project.");
  }
  if (!["before-revoke", "after-revoke"].includes(mode)) throw new Error("Choose the explicit cutover verification phase.");
  if (!publishableKey?.startsWith("sb_publishable_") || !secretKey?.startsWith("sb_secret_") ||
      !legacyAnonKey?.startsWith("eyJ") || !legacyServiceKey?.startsWith("eyJ")) {
    throw new Error("Modern opaque keys and the original legacy JWT keys are required; values are never logged.");
  }
  const cases = [
    ["modern-public-catalog", publishableKey, "products", 200],
    // PostgREST returns 401 for an anonymous role denied SQL privileges;
    // gateways can surface the same denial as 403. Catalog access below
    // proves this is a valid public key, rather than accepting any 401.
    ["modern-public-cart-denied", publishableKey, "carts", [401, 403]],
    ["modern-server-cart", secretKey, "carts", 200],
    ["legacy-public", legacyAnonKey, "products", mode === "after-revoke" ? 401 : 200],
    ["legacy-privileged", legacyServiceKey, "carts", mode === "after-revoke" ? 401 : 200],
  ];
  const checks = await Promise.all(cases.map(async ([name, key, table, expected]) => {
    try {
      const response = await fetcher(`${url.origin}/rest/v1/${table}?select=id&limit=0`, {
        headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
      // No row, response body, URL parameter, header or key is recorded.
      await response.body?.cancel();
      return { name, expected, status: response.status, passed: Array.isArray(expected) ? expected.includes(response.status) : response.status === expected };
    } catch { return { name, expected, status: 0, passed: false }; }
  }));
  return { projectRef, mode, verified: checks.every((check) => check.passed), checks };
}

async function main() {
  const env = process.env;
  const requiredNames = ["KEY_PROBE_PROJECT_REF", "KEY_PROBE_API_URL", "KEY_PROBE_PUBLISHABLE_KEY", "KEY_PROBE_SECRET_KEY", "KEY_PROBE_LEGACY_ANON_KEY", "KEY_PROBE_LEGACY_SERVICE_KEY"];
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ mode: "plan-only", readOnly: true, rowsRequested: 0, requiredNames,
      phases: ["--before-revoke", "--after-revoke"], expectedRevocationEvidence: "Both original legacy keys receive HTTP 401 while modern access and public cart denial remain correct." }));
    return;
  }
  if (requiredNames.some((name) => !env[name]) || env.KEY_PROBE_APPROVED_PROJECT_REF !== env.KEY_PROBE_PROJECT_REF) {
    throw new Error("Exact project approval and secure runtime key configuration required.");
  }
  const mode = process.argv.includes("--after-revoke") ? "after-revoke" : process.argv.includes("--before-revoke") ? "before-revoke" : undefined;
  const result = await verifyKeyCutover({ apiUrl: env.KEY_PROBE_API_URL, projectRef: env.KEY_PROBE_PROJECT_REF, mode,
    publishableKey: env.KEY_PROBE_PUBLISHABLE_KEY, secretKey: env.KEY_PROBE_SECRET_KEY,
    legacyAnonKey: env.KEY_PROBE_LEGACY_ANON_KEY, legacyServiceKey: env.KEY_PROBE_LEGACY_SERVICE_KEY });
  console.log(JSON.stringify(result));
  if (!result.verified) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Key cutover probe failed; key values and provider response bodies withheld."); process.exitCode = 1; });
}
