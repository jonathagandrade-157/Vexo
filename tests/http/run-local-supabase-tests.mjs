import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function required(status, ...names) {
  const value = names.map((name) => status[name]).find((candidate) => typeof candidate === "string" && candidate.length > 0);
  if (!value) throw new Error(`Supabase local status is missing ${names.join(" or ")}`);
  return value;
}

const status = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);

const testEnv = {
  ...process.env,
  RUN_SUPABASE_HTTP_TESTS: "1",
  SUPABASE_HTTP_URL: required(status, "API_URL"),
  SUPABASE_HTTP_ANON_KEY: required(status, "ANON_KEY", "PUBLISHABLE_KEY"),
  SUPABASE_HTTP_SERVICE_ROLE_KEY: required(status, "SERVICE_ROLE_KEY", "SECRET_KEY"),
  SUPABASE_HTTP_JWT_SECRET: required(status, "JWT_SECRET"),
  DATABASE_URL: required(status, "DB_URL"),
};

const vitestPath = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitestPath, "run", "tests/http/supabase-http.test.ts"], {
  env: testEnv,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
