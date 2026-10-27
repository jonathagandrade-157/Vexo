import { defineConfig, devices } from "@playwright/test";

import baseConfig from "./playwright.config";

if (process.env.E2E_ISOLATED_SUPABASE !== "1") {
  throw new Error("Use npm run test:e2e:supabase to configure the disposable Supabase stack.");
}

// defineConfig(baseConfig, overrides) concatenates webServer definitions.
// Replace the dev server here so only the production build is exercised.
export default defineConfig({
  ...baseConfig,
  retries: 0,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-360", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
  ],
  use: { ...baseConfig.use, baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NODE_ENV: "production" },
  },
});
