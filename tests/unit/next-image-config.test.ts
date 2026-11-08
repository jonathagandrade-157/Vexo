import { afterEach, expect, it, vi } from "vitest";
vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each([
  ["true", "1", "http://127.0.0.1:54321", true],
  ["true", "1", "https://production.supabase.co", false],
  ["true", "", "http://127.0.0.1:54321", false],
  ["", "1", "http://127.0.0.1:54321", false],
])("keeps private-network image access isolated (%s, %s, %s)", async (ci, marker, url, expected) => {
  vi.resetModules();
  vi.stubEnv("CI", ci); vi.stubEnv("E2E_ISOLATED_SUPABASE", marker); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  const config = (await import("../../next.config")).default;
  expect(config.images?.dangerouslyAllowLocalIP).toBe(expected);
});
