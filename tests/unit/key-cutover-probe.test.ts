import { expect, it } from "vitest";

// @ts-expect-error Operational Node entrypoint deliberately uses .mjs.
import { verifyKeyCutover } from "../../scripts/operations/verify-key-cutover.mjs";

const config = { apiUrl: "http://127.0.0.1:54321", projectRef: "local", synthetic: true, mode: "after-revoke",
  publishableKey: "sb_publishable_fixture", secretKey: "sb_secret_fixture", legacyAnonKey: "eyJ.fixture.anon", legacyServiceKey: "eyJ.fixture.service" };

it("does not claim revocation when the old privileged key still works", async () => {
  const result = await verifyKeyCutover(config, async (url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>).apikey;
    return new Response(null, { status: key === config.publishableKey && url.includes("/carts") ? 403 : key === config.legacyAnonKey ? 401 : 200 });
  });
  expect(result.verified).toBe(false);
  expect(result.checks.find((check: { name: string }) => check.name === "legacy-privileged")).toMatchObject({ status: 200, expected: 401, passed: false });
  expect(JSON.stringify(result)).not.toContain("eyJ.fixture");
  expect(JSON.stringify(result)).not.toContain("sb_secret_fixture");
});

it("uses apikey for opaque keys and requires both legacy keys to fail", async () => {
  const result = await verifyKeyCutover(config, async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    expect(url).toMatch(/\?select=id&limit=0$/);
    const key = headers.apikey ?? "";
    if (key.startsWith("sb_")) expect(headers.Authorization).toBeUndefined();
    return new Response(null, { status: key.startsWith("eyJ") ? 401 : key === config.publishableKey && url.includes("/carts") ? 403 : 200 });
  });
  expect(result.verified).toBe(true);
  expect(result.checks).toHaveLength(5);
});

it("rejects mismatched origins before making any request", async () => {
  await expect(verifyKeyCutover({ ...config, synthetic: false, apiUrl: "https://unapproved.example" })).rejects.toThrow(/origin/);
});

it("accepts anonymous permission denial only while the same modern key reads the public catalog", async () => {
  const response = (url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>).apikey;
    return Promise.resolve(new Response(null, { status: key === config.secretKey ? 200 : key === config.publishableKey && url.includes("/products") ? 200 : 401 }));
  };
  expect((await verifyKeyCutover(config, response)).verified).toBe(true);
  expect((await verifyKeyCutover(config, async () => new Response(null, { status: 401 }))).verified).toBe(false);
});
