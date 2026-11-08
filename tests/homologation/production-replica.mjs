#!/usr/bin/env node
/**
 * Homologação de rollout em réplica isolada da produção.
 *
 * O workflow sobe um Supabase descartável (Auth, PostgREST, Storage,
 * Mailpit) contendo SOMENTE as migrations que a produção já tem
 * (scripts/operations/release-migrations.mjs), executa:
 *
 *   seed          dados sintéticos realistas criados pelas APIs reais
 *                 (Auth admin, checkout_cart_secure via PostgREST)
 *   assert-before prova que a réplica reproduz os defeitos de produção
 *   (migrations pendentes aplicadas na ordem, pelo CLI)
 *   assert-after  prova que os defeitos sumiram, que a chave pública não
 *                 lê campos restritos nem pedidos, e que nenhum dado
 *                 sintético anterior foi alterado
 *
 * Recusa qualquer endpoint que não seja loopback e qualquer arquivo .env:
 * nunca toca produção, Preview ou serviços externos.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(new URL(`../../${filename}`, import.meta.url))) throw new Error(`Refusing to run with ${filename} present.`);
}

const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const pick = (...names) => {
  const value = names.map((name) => status[name]).find((candidate) => typeof candidate === "string" && candidate.length > 0);
  if (!value) throw new Error(`Local Supabase status is missing ${names.join(" or ")}.`);
  return value;
};
const apiUrl = pick("API_URL");
const databaseUrl = pick("DB_URL");
const publishableKey = pick("PUBLISHABLE_KEY");
const secretKey = pick("SECRET_KEY");
for (const url of [apiUrl, databaseUrl]) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Replica only accepts loopback endpoints.");
}
if (!publishableKey.startsWith("sb_publishable_") || !secretKey.startsWith("sb_secret_")) throw new Error("Replica requires the modern keys issued by the local gateway.");

const statePath = process.env.HOMOLOG_STATE ?? `${process.env.RUNNER_TEMP ?? "/tmp"}/vexo-homolog-state.json`;
const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function rest(path, { key, method = "GET", body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: key, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
}
const denied = (result) => [401, 403].includes(result.status);

async function withDb(fn) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

async function privileges() {
  return withDb(async (db) => (await db.query(`select
      has_table_privilege('service_role', 'public.products', 'SELECT') as svc_products,
      has_function_privilege('anon', 'public.get_order_confirmation(uuid,uuid)', 'EXECUTE') as anon_confirmation,
      has_function_privilege('service_role', 'public.get_order_confirmation(uuid,uuid)', 'EXECUTE') as svc_confirmation,
      has_column_privilege('anon', 'public.tenants', 'pix_key', 'SELECT') as anon_pix,
      has_column_privilege('anon', 'public.tenants', 'created_by', 'SELECT') as anon_created_by,
      has_column_privilege('anon', 'public.tenant_domains', 'verification_token_hash', 'SELECT') as anon_domain_hash,
      has_table_privilege('anon', 'public.product_inventory', 'UPDATE') as anon_inventory_update,
      has_table_privilege('service_role', 'public.roles', 'SELECT') as svc_roles,
      has_table_privilege('service_role', 'public.tenant_members', 'INSERT') as svc_member_insert,
      has_column_privilege('authenticated', 'public.tenant_members', 'role_id', 'UPDATE') as auth_role_update,
      has_column_privilege('authenticated', 'public.tenant_members', 'status', 'UPDATE') as auth_status_update,
      has_table_privilege('authenticated', 'public.tenant_members', 'DELETE') as auth_member_delete,
      (select max(version) from supabase_migrations.schema_migrations) as last_migration,
      (select count(*)::int from supabase_migrations.schema_migrations) as migration_count`)).rows[0]);
}

async function fingerprint(state) {
  return withDb(async (db) => {
    const rows = await db.query(
      `select
         (select count(*)::int from public.orders where tenant_id = $1) as orders,
         (select count(*)::int from public.order_items oi join public.orders o on o.id = oi.order_id where o.tenant_id = $1) as order_items,
         (select coalesce(sum(stock_quantity), 0)::int from public.product_inventory where tenant_id = $1) as stock,
         (select count(*)::int from public.tenant_members where tenant_id = $1) as members,
         (select md5(coalesce(pix_key, '') || '|' || coalesce(address_street, '') || '|' || coalesce(created_by::text, '')) from public.tenants where id = $1) as tenant_digest,
         (select md5(string_agg(o.id::text || o.total::text || o.status || o.customer_name, ',' order by o.id)) from public.orders o where o.tenant_id = $1) as orders_digest`,
      [state.tenantId],
    );
    return rows.rows[0];
  });
}

async function seed() {
  const runId = randomUUID().slice(0, 8);
  const email = `homolog-owner-${runId}@example.test`;
  const password = `Homolog-${runId}-${randomBytes(6).toString("hex")}-A9!`;
  const admin = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const owner = await admin.json();
  if (!admin.ok || !owner?.id) throw new Error(`Synthetic owner creation failed (HTTP ${admin.status}).`);

  const state = await withDb(async (db) => {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    const tenant = await db.query(
      `insert into public.tenants (name, slug, created_by, status, onboarding_completed_at, checkout_mode, whatsapp_phone,
                                   pix_enabled, pix_key, pix_key_type, pix_recipient_name,
                                   address_zip, address_street, address_number, address_neighborhood, address_city, address_state)
       values ('Loja Homologação', $1, $2, 'active', now(), 'whatsapp', '11999999999',
               true, 'homolog-pix@example.test', 'email', 'Titular Sintetico',
               '01310100', 'Rua Sintetica', '100', 'Centro', 'São Paulo', 'SP') returning id`,
      [`homolog-${runId}`, owner.id],
    );
    const tenantId = tenant.rows[0].id;
    await db.query("insert into public.tenant_members (tenant_id, user_id, role_id) select $1, $2, id from public.roles where key = 'OWNER'", [tenantId, owner.id]);
    await db.query("insert into public.subscriptions (tenant_id, plan_id, status) select $1, id, 'active' from public.plans where slug = 'pro'", [tenantId]);
    await db.query("update public.shipping_settings set enabled = false where tenant_id = $1", [tenantId]);
    const product = await db.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, 'Produto Homologação', 'produto-homologacao', 80, 'active') returning id", [tenantId]);
    const productId = product.rows[0].id;
    await db.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 10)", [tenantId, productId]);
    await db.query(
      "insert into public.tenant_domains (tenant_id, domain, domain_type, status, verification_token_hash) values ($1, $2, 'custom', 'active', $3)",
      [tenantId, `homolog-${runId}.example.test`, createHash("sha256").update(runId).digest("hex")],
    );
    const ownerHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const cartId = randomUUID();
    await db.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [cartId, tenantId, ownerHash]);
    await db.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 2)", [cartId, tenantId, productId]);
    const openCartId = randomUUID();
    await db.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [openCartId, tenantId, createHash("sha256").update(randomBytes(32)).digest("hex")]);
    await db.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [openCartId, tenantId, productId]);
    await db.query("commit");
    return { runId, tenantId, productId, cartId, openCartId, ownerHash, ownerId: owner.id };
  });

  // Pedido criado pelo caminho real do BFF: RPC transacional via PostgREST.
  const checkout = await rest("/rest/v1/rpc/checkout_cart_secure", {
    key: secretKey,
    method: "POST",
    body: {
      p_tenant_id: state.tenantId, p_cart_id: state.cartId, p_owner_token_hash: state.ownerHash,
      p_customer_name: "Comprador Sintetico", p_customer_email: `buyer-${state.runId}@example.test`, p_customer_phone: "+5511999999999",
      p_shipping_address: { zip: "01310100", street: "Rua Sintetica", number: "1", complement: null, neighborhood: "Centro", city: "São Paulo", state: "SP" },
      p_order_source: "whatsapp", p_payment_channel: "external", p_requested_payment_method: "pix", p_cash_change_for: null,
      p_shipping_kind: "none", p_shipping_method_id: null, p_expected_shipping_price: null,
      p_me_service_id: null, p_me_service_name: null, p_me_price: null, p_me_estimated_days: null,
    },
  });
  const row = Array.isArray(checkout.json) ? checkout.json[0] : checkout.json;
  const result = row && typeof row === "object" && "result" in row ? row.result : row;
  if (checkout.status !== 200 || !result?.orderId) throw new Error(`Synthetic checkout failed (HTTP ${checkout.status}).`);
  state.orderId = result.orderId;
  state.before = await fingerprint(state);
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`Synthetic tenant, owner, product, open cart and one order created (run ${state.runId}).`);
}

function loadState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

const confirmationBody = (state) => ({ p_tenant_id: state.tenantId, p_order_id: state.orderId });
const cartEmbed = (state) => `/rest/v1/cart_items?select=quantity,products(name)&cart_id=eq.${state.openCartId}`;

async function assertBefore() {
  const state = loadState();
  const p = await privileges();
  console.log(`Replica migration state: ${p.migration_count} applied, last ${p.last_migration}.`);
  check("réplica parte da linha de base da produção", p.last_migration === "20261026210716" && p.migration_count === 123);
  // Defeitos que a produção apresenta hoje (inventário somente leitura 07–08/11).
  check("reproduz: servidor sem leitura de products (carrinho vazio)", p.svc_products === false);
  const cart = await rest(cartEmbed(state), { key: secretKey });
  check("reproduz: leitura do carrinho pelo servidor falha", cart.status >= 400, `HTTP ${cart.status}`);
  check("reproduz: confirmação de pedido executável pela chave pública", p.anon_confirmation === true);
  const exposed = await rest("/rest/v1/rpc/get_order_confirmation", { key: publishableKey, method: "POST", body: confirmationBody(state) });
  check("reproduz: chave pública lê o pedido pela RPC", exposed.status === 200 && Boolean(exposed.json?.customerName), `HTTP ${exposed.status}`);
  const pix = await rest(`/rest/v1/tenants?select=pix_key,created_by&id=eq.${state.tenantId}`, { key: publishableKey });
  check("reproduz: chave pública lê PIX e dono da loja", pix.status === 200 && pix.json?.[0]?.pix_key === "homolog-pix@example.test", `HTTP ${pix.status}`);
  check("reproduz: servidor sem privilégio para convite", p.svc_roles === false && p.svc_member_insert === false);
  check("reproduz: sessão sem UPDATE/DELETE em tenant_members", p.auth_role_update === false && p.auth_member_delete === false);
}

async function assertAfter() {
  const state = loadState();
  const p = await privileges();
  console.log(`Replica migration state: ${p.migration_count} applied, last ${p.last_migration}.`);
  check("todas as migrations pendentes aplicadas", p.migration_count === 128 && p.last_migration === "20261107123000");

  check("carrinho: servidor lê products", p.svc_products === true);
  const cart = await rest(cartEmbed(state), { key: secretKey });
  check("carrinho: leitura do carrinho aberto com produto", cart.status === 200 && cart.json?.[0]?.products?.name === "Produto Homologação", `HTTP ${cart.status}`);

  check("confirmação: RPC fora do alcance de anon", p.anon_confirmation === false && p.svc_confirmation === true);
  const publicRpc = await rest("/rest/v1/rpc/get_order_confirmation", { key: publishableKey, method: "POST", body: confirmationBody(state) });
  check("confirmação: chave pública negada", denied(publicRpc), `HTTP ${publicRpc.status}`);
  const serverRpc = await rest("/rest/v1/rpc/get_order_confirmation", { key: secretKey, method: "POST", body: confirmationBody(state) });
  check("confirmação: servidor lê o pedido existente", serverRpc.status === 200 && serverRpc.json?.customerName === "Comprador Sintetico", `HTTP ${serverRpc.status}`);

  for (const column of ["pix_key", "pix_recipient_name", "address_street", "created_by"]) {
    const result = await rest(`/rest/v1/tenants?select=${column}&id=eq.${state.tenantId}`, { key: publishableKey });
    check(`dados: chave pública negada em tenants.${column}`, denied(result), `HTTP ${result.status}`);
  }
  const hash = await rest(`/rest/v1/tenant_domains?select=verification_token_hash&tenant_id=eq.${state.tenantId}`, { key: publishableKey });
  check("dados: chave pública negada no hash de verificação de domínio", denied(hash), `HTTP ${hash.status}`);
  for (const table of ["orders", "order_items", "customers", "carts", "cart_items", "payments"]) {
    const result = await rest(`/rest/v1/${table}?select=*&limit=1`, { key: publishableKey });
    check(`dados: chave pública não lista ${table}`, denied(result) || (result.status === 200 && Array.isArray(result.json) && result.json.length === 0), `HTTP ${result.status}`);
  }
  const storefront = await rest(`/rest/v1/tenants?select=id,name,slug,checkout_mode&id=eq.${state.tenantId}`, { key: publishableKey });
  check("vitrine: chave pública ainda lê os campos da vitrine", storefront.status === 200 && storefront.json?.[0]?.name === "Loja Homologação", `HTTP ${storefront.status}`);
  const write = await rest(`/rest/v1/product_inventory?product_id=eq.${state.productId}`, { key: publishableKey, method: "PATCH", body: { stock_quantity: 999 } });
  check("dados: chave pública não altera estoque", denied(write), `HTTP ${write.status}`);
  check("dados: sem DML anônimo no estoque", p.anon_inventory_update === false);

  check("equipe: convite com privilégio mínimo", p.svc_roles === true && p.svc_member_insert === true);
  check("equipe: sessão altera só role_id e pode remover", p.auth_role_update === true && p.auth_status_update === false && p.auth_member_delete === true);

  const after = await fingerprint(state);
  check("dados sintéticos anteriores intactos", JSON.stringify(after) === JSON.stringify(state.before), JSON.stringify({ before: state.before, after }));
}

const command = process.argv[2];
if (command === "seed") await seed();
else if (command === "assert-before") await assertBefore();
else if (command === "assert-after") await assertAfter();
else throw new Error(`Unknown command: ${command}`);

if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exit(1);
}
