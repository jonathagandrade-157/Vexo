import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { verifyKeyCutover } from "../../scripts/operations/verify-key-cutover.mjs";

// This runner must never use a linked or hosted database, developer .env
// files, or external payment/email credentials. All rows are disposable.
const root = fileURLToPath(new URL("../../", import.meta.url));
for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(new URL(`../../${filename}`, import.meta.url))) {
    throw new Error(`Isolated E2E refuses to load ${filename}; use a clean checkout.`);
  }
}

let status;
try {
  status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
} catch {
  throw new Error("Start the disposable local Supabase stack before running browser integration tests.");
}

function required(...names) {
  const value = names.map((name) => status[name]).find((candidate) => typeof candidate === "string" && candidate.length > 0);
  if (!value) throw new Error(`Local Supabase status is missing ${names.join(" or ")}.`);
  return value;
}

const apiUrl = required("API_URL");
const databaseUrl = required("DB_URL");
for (const value of [apiUrl, databaseUrl]) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Isolated E2E only accepts loopback Supabase endpoints.");
  }
}

const publicKey = required("PUBLISHABLE_KEY");
const secretKey = required("SECRET_KEY");
if (!publicKey.startsWith("sb_publishable_") || !secretKey.startsWith("sb_secret_")) {
  throw new Error("Modern-key E2E requires opaque publishable/secret keys issued by the local Supabase gateway.");
}
const keyProbe = await verifyKeyCutover({ apiUrl, projectRef: "local", mode: "before-revoke", synthetic: true,
  publishableKey: publicKey, secretKey, legacyAnonKey: required("ANON_KEY"), legacyServiceKey: required("SERVICE_ROLE_KEY") });
if (!keyProbe.verified) throw new Error(`Local cutover preflight failed: ${JSON.stringify(keyProbe.checks)}`);
console.log("Modern-key cutover preflight: catalog allowed, direct public cart denied, administrative cart allowed; legacy baseline still valid (not revoked).");
const runId = randomUUID().slice(0, 8);
const slug = `e2e-browser-${runId}`;
const otherSlug = `e2e-other-${runId}`;
const email = `owner-${runId}@example.test`;
const password = `Local-browser-${runId}-A9!`;
const supabase = createClient(apiUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error("Could not create the disposable browser test owner.");
const operatorEmail = `operator-${runId}@example.test`;
const operator = await supabase.auth.admin.createUser({ email: operatorEmail, password, email_confirm: true });
if (operator.error || !operator.data.user) throw new Error("Could not create the disposable browser test operator.");

const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();
try {
  await database.query("begin");
  // Match withSuperuser() in the integration fixtures: audit triggers
  // require an explicit actor even on the direct setup connection.
  // The transaction ends before any real browser request is executed.
  await database.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
  for (const tenantSlug of [slug, otherSlug]) {
    const tenant = await database.query(
      `insert into public.tenants (name, slug, created_by, status, onboarding_completed_at, checkout_mode, whatsapp_phone)
       values ($1, $2, $3, 'active', now(), 'whatsapp', '11999999999') returning id`,
      [tenantSlug === slug ? "Loja E2E" : "Outra loja E2E", tenantSlug, data.user.id],
    );
    const tenantId = tenant.rows[0].id;
    await database.query(
      "update public.tenants set segment = 'apparel', instagram_handle = 'loja_e2e', contact_email = $1 where id = $2",
      [email, tenantId],
    );
    // Only the first tenant belongs to the owner used by the panel test.
    if (tenantSlug === slug) {
      await database.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) select $1, $2, id from public.roles where key = 'OWNER'",
        [tenantId, data.user.id],
      );
      await database.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) select $1, $2, id from public.roles where key = 'OPERATOR'",
        [tenantId, operator.data.user.id],
      );
    }
    await database.query(
      "insert into public.subscriptions (tenant_id, plan_id, status) select $1, id, 'active' from public.plans where slug = 'pro'",
      [tenantId],
    );
    for (const [name, productSlug, price] of [["Produto E2E principal", "principal", 100], ["Produto E2E adicional", "adicional", 35]]) {
      const product = await database.query(
        "insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, 'active') returning id",
        [tenantId, name, productSlug, price],
      );
      await database.query(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 100)",
        [tenantId, product.rows[0].id],
      );
    }
    const variableProduct = await database.query(
      "insert into public.products (tenant_id, name, slug, price, status) values ($1, 'Produto E2E com variantes', 'variantes', 120, 'active') returning id",
      [tenantId],
    );
    const variableId = variableProduct.rows[0].id;
    const option = await database.query(
      "insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id",
      [tenantId, variableId],
    );
    for (const [position, color, price, promotion, stock, active] of [[0, "Preto", 120, 90, 5, true], [1, "Branco", 130, null, 0, true], [2, "Azul", 140, null, 5, false]]) {
      const value = await database.query(
        "insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, $3, $4) returning id",
        [tenantId, option.rows[0].id, color, position],
      );
      const variant = await database.query(
        "insert into public.product_variants (tenant_id, product_id, sku, price, promotional_price, option_value_ids, is_active) values ($1, $2, $3, $4, $5, array[$6]::uuid[], $7) returning id",
        [tenantId, variableId, `E2E-${color.toUpperCase()}`, price, promotion, value.rows[0].id, active],
      );
      await database.query(
        "insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, $4)",
        [tenantId, variableId, variant.rows[0].id, stock],
      );
    }
    const unavailable = await database.query(
      "insert into public.products (tenant_id, name, slug, price, status) values ($1, 'Produto E2E sem estoque', 'sem-estoque', 60, 'active') returning id",
      [tenantId],
    );
    await database.query(
      "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 0)",
      [tenantId, unavailable.rows[0].id],
    );
    await database.query("update public.shipping_settings set enabled = false where tenant_id = $1", [tenantId]);
  }
  await database.query("commit");
} catch (cause) {
  await database.query("rollback");
  throw cause;
} finally {
  await database.end();
}

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:E2E_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MERCADO_PAGO_|ASAAS_|RESEND_|SENTRY_|NEXT_PUBLIC_SENTRY_|VERCEL_|MELHOR_ENVIO_|EMAIL_FROM$|DATABASE_URL$)/.test(name),
));
Object.assign(env, {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SECRET_KEY: secretKey,
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
  NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
  TRIAL_HASH_SECRET: "disposable-browser-test-only-hash-secret",
  E2E_ISOLATED_SUPABASE: "1",
  E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL === "chrome" ? "chrome" : "",
  E2E_STOREFRONT_SLUG: slug,
  E2E_OTHER_STOREFRONT_SLUG: otherSlug,
  E2E_OWNER_EMAIL: email,
  E2E_OWNER_PASSWORD: password,
  E2E_OPERATOR_EMAIL: operatorEmail,
  DATABASE_URL: databaseUrl,
});

function run(relativePath, args) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(relativePath, import.meta.url)), ...args], {
    cwd: root, env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Disposable loopback Supabase seeded; modern opaque keys required, legacy key variables absent, external integration credentials excluded.");
run("../../node_modules/next/dist/bin/next", ["build"]);
run("../../node_modules/@playwright/test/cli.js", ["test", "--config=playwright.supabase.config.ts"]);
