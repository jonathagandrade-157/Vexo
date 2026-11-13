#!/usr/bin/env node
/**
 * Ensaio de recuperação com serviços Supabase REAIS (Auth/GoTrue,
 * PostgREST, Storage) e dados 100% sintéticos, no executor descartável.
 *
 * Usa sem modificação os mesmos scripts do procedimento de produção
 * (scripts/backup/export.mjs e restore-lab.mjs) e acrescenta o que eles não
 * cobriam: semeadura com usuários de senha real e arquivos reais no Storage,
 * reenvio dos arquivos ao Storage restaurado e uma comparação completa.
 *
 * Fases (o workflow recovery-rehearsal.yml define a ordem):
 *   seed                     origem: usuários, lojas, catálogo, pedido, arquivos
 *   fingerprint <arquivo>    contagens, checksums de linhas, órfãos de FK, hashes de arquivos
 *   export                   export cifrado (age) da origem via export.mjs
 *   restore-db               restaura o banco no destino vazio via restore-lab.mjs
 *   restore-objects          decifra e reenvia cada objeto ao Storage do destino
 *   verify <antes.json>      compara com a origem; login com senha preservada; RLS
 *
 * NÃO é prova de recuperação de produção: nenhum dado real, nenhum destino
 * externo. Recusa endpoints que não sejam loopback e arquivos .env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { decryptStream, hashFile } from "../../scripts/backup/core.mjs";
import { readEncryptedJson } from "../../scripts/backup/restore-lab.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(join(root, filename))) throw new Error(`Refusing to run with ${filename} present.`);
}
const LOOP = new Set(["127.0.0.1", "localhost", "[::1]"]);
const temp = process.env.RUNNER_TEMP ?? "/tmp";
const statePath = join(temp, "recovery-rehearsal-state.json");

function stack(workdir = process.env.SUPABASE_WORKDIR) {
  const args = ["status", "--output", "json", ...(workdir ? ["--workdir", workdir] : [])];
  const status = JSON.parse(execFileSync("supabase", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pick = (name) => {
    if (typeof status[name] !== "string" || !status[name]) throw new Error(`Local Supabase status is missing ${name}.`);
    return status[name];
  };
  const value = { apiUrl: pick("API_URL"), dbUrl: pick("DB_URL"), publishable: pick("PUBLISHABLE_KEY"), secret: pick("SECRET_KEY") };
  for (const url of [value.apiUrl, value.dbUrl]) if (!LOOP.has(new URL(url).hostname)) throw new Error("Rehearsal only accepts loopback stacks.");
  return value;
}

async function withDb(url, fn) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

async function withServiceRoleDb(url, fn) {
  return withDb(url, async (db) => {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      const result = await fn(db);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

// Pequenas imagens válidas (bytes mágicos reais) com conteúdo único por arquivo.
function png(seed) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), createHash("sha256").update(`png-${seed}`).digest()]);
}
function jpeg(seed) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), createHash("sha256").update(`jpeg-${seed}`).digest(), Buffer.from([0xff, 0xd9])]);
}

async function seed() {
  const s = stack();
  const admin = createClient(s.apiUrl, s.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const runId = randomUUID().slice(0, 8);
  const owners = [];
  for (const label of ["a", "b"]) {
    const email = `recovery-owner-${label}-${runId}@example.test`;
    const password = `Rec-${label}-${randomBytes(6).toString("hex")}-A9!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error("Synthetic owner creation failed.");
    owners.push({ id: data.user.id, email, password });
  }
  const tenants = await withServiceRoleDb(s.dbUrl, async (db) => {
    const ids = [];
    for (const [index, owner] of owners.entries()) {
      const tenant = await db.query(
        `insert into public.tenants (name, slug, created_by, status, onboarding_completed_at, checkout_mode, whatsapp_phone, pix_enabled, pix_key, pix_key_type, pix_recipient_name, address_city)
         values ($1, $2, $3, 'active', now(), 'whatsapp', '11999999999', true, $4, 'email', 'Titular Sintetico', 'São Paulo') returning id`,
        [`Loja Recuperação ${index}`, `recovery-${index}-${runId}`, owner.id, `pix-${index}@example.test`],
      );
      const tenantId = tenant.rows[0].id;
      await db.query("insert into public.tenant_members (tenant_id, user_id, role_id) select $1, $2, id from public.roles where key = 'OWNER'", [tenantId, owner.id]);
      await db.query("insert into public.subscriptions (tenant_id, plan_id, status) select $1, id, 'active' from public.plans where slug = 'pro'", [tenantId]);
      await db.query("update public.shipping_settings set enabled = false where tenant_id = $1", [tenantId]);
      const product = await db.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, 'Produto Recuperação', 'produto-recuperacao', 70, 'active') returning id", [tenantId]);
      await db.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 12)", [tenantId, product.rows[0].id]);
      const variable = await db.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, 'Produto com variantes', 'variantes', 90, 'active') returning id", [tenantId]);
      const option = await db.query("insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id", [tenantId, variable.rows[0].id]);
      for (const [position, color] of ["Preto", "Branco"].entries()) {
        const value = await db.query("insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, $3, $4) returning id", [tenantId, option.rows[0].id, color, position]);
        const variant = await db.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active) values ($1, $2, 95, array[$3]::uuid[], true) returning id", [tenantId, variable.rows[0].id, value.rows[0].id]);
        await db.query("insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, 4)", [tenantId, variable.rows[0].id, variant.rows[0].id]);
      }
      ids.push({ tenantId, productId: product.rows[0].id });
    }
    return ids;
  });

  // Arquivos reais pelo serviço Storage, nos dois buckets usados pela aplicação.
  const files = [
    ["product-media", `${tenants[0].tenantId}/${tenants[0].productId}/principal.png`, png(`${runId}-1`), "image/png"],
    ["product-media", `${tenants[1].tenantId}/${tenants[1].productId}/principal.jpg`, jpeg(`${runId}-2`), "image/jpeg"],
    ["tenant-media", `${tenants[0].tenantId}/logo.png`, png(`${runId}-3`), "image/png"],
  ];
  for (const [bucket, path, bytes, contentType] of files) {
    const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error("Synthetic Storage upload failed.");
  }
  await withServiceRoleDb(s.dbUrl, (db) => db.query("update public.products set main_image = $1 where id = $2", [files[0][1], tenants[0].productId]));

  // Um pedido real pelo BFF (RPC transacional), com baixa de estoque e auditoria.
  const ownerHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const cartId = randomUUID();
  await withServiceRoleDb(s.dbUrl, async (db) => {
    await db.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [cartId, tenants[0].tenantId, ownerHash]);
    await db.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 3)", [cartId, tenants[0].tenantId, tenants[0].productId]);
  });
  const response = await fetch(`${s.apiUrl}/rest/v1/rpc/checkout_cart_secure`, {
    method: "POST",
    headers: { apikey: s.secret, "content-type": "application/json" },
    body: JSON.stringify({
      p_tenant_id: tenants[0].tenantId, p_cart_id: cartId, p_owner_token_hash: ownerHash,
      p_customer_name: "Comprador Sintetico", p_customer_email: `buyer-${runId}@example.test`, p_customer_phone: "+5511999999999",
      p_shipping_address: { zip: "01310100", street: "Rua Sintetica", number: "1", complement: null, neighborhood: "Centro", city: "São Paulo", state: "SP" },
      p_order_source: "whatsapp", p_payment_channel: "external", p_requested_payment_method: "pix", p_cash_change_for: null,
      p_shipping_kind: "none", p_shipping_method_id: null, p_expected_shipping_price: null,
      p_me_service_id: null, p_me_service_name: null, p_me_price: null, p_me_estimated_days: null,
    }),
  });
  if (!response.ok) throw new Error(`Synthetic checkout failed (HTTP ${response.status}).`);
  writeFileSync(statePath, JSON.stringify({ runId, owners, tenants }), { mode: 0o600 });
  console.log(`Seeded 2 owners, 2 stores, catalog with variants, 1 order and ${files.length} Storage files (run ${runId}).`);
}

async function fingerprint(s) {
  return withDb(s.dbUrl, async (db) => {
    const tables = (await db.query(
      `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname = 'public' order by 1, 2`,
    )).rows;
    const rowsByTable = {};
    for (const { schema, name } of tables) {
      const result = await db.query(`select count(*)::int as count, coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as digest from ${schema}."${name}" t`);
      rowsByTable[`${schema}.${name}`] = result.rows[0];
    }
    const special = {
      "auth.users": "select count(*)::int as count, coalesce(md5(string_agg(md5(concat_ws('|', id, email, encrypted_password, email_confirmed_at, created_at)), '' order by id)), '') as digest from auth.users",
      "auth.identities": "select count(*)::int as count, coalesce(md5(string_agg(md5(concat_ws('|', id, user_id, provider, provider_id)), '' order by id)), '') as digest from auth.identities",
      "storage.buckets": "select count(*)::int as count, coalesce(md5(string_agg(md5(concat_ws('|', id, public, file_size_limit, allowed_mime_types::text)), '' order by id)), '') as digest from storage.buckets",
      "storage.objects": "select count(*)::int as count, coalesce(md5(string_agg(md5(concat_ws('|', bucket_id, name, metadata->>'size', metadata->>'mimetype')), '' order by bucket_id, name)), '') as digest from storage.objects",
    };
    for (const [label, sql] of Object.entries(special)) rowsByTable[label] = (await db.query(sql)).rows[0];

    // Relacionamentos: linhas órfãs para cada FK de public (o restore roda
    // com triggers/FKs suspensos por session_replication_role=replica).
    const fks = (await db.query(
      `select con.conname, cl.relname as child, pl.relname as parent,
              to_jsonb(array(select att.attname from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum order by ord)) as child_cols,
              to_jsonb(array(select att.attname from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum order by ord)) as parent_cols,
              pn.nspname as parent_schema
       from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace cn on cn.oid = cl.relnamespace
       join pg_class pl on pl.oid = con.confrelid join pg_namespace pn on pn.oid = pl.relnamespace
       where con.contype = 'f' and cn.nspname = 'public' order by 1`,
    )).rows;
    let orphans = 0;
    for (const fk of fks) {
      const notNull = fk.child_cols.map((col) => `c."${col}" is not null`).join(" and ");
      const join = fk.child_cols.map((col, index) => `p."${fk.parent_cols[index]}" = c."${col}"`).join(" and ");
      const count = (await db.query(`select count(*)::int as n from public."${fk.child}" c where ${notNull} and not exists (select 1 from ${fk.parent_schema}."${fk.parent}" p where ${join})`)).rows[0].n;
      orphans += count;
    }
    const migrations = (await db.query("select version from supabase_migrations.schema_migrations order by version")).rows.map((row) => row.version);
    const objects = (await db.query("select bucket_id, name from storage.objects order by bucket_id, name")).rows;
    const storage = createClient(s.apiUrl, s.secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const fileHashes = {};
    for (const object of objects) {
      const { data, error } = await storage.storage.from(object.bucket_id).download(object.name);
      fileHashes[`${object.bucket_id}/${object.name}`] = error || !data ? "missing" : createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex");
    }
    return { rowsByTable, foreignKeys: fks.length, orphans, migrations, fileHashes };
  });
}

function runExport() {
  const s = stack();
  const output = join(temp, "recovery-bundle");
  const identity = join(temp, "recovery-identity.txt");
  execFileSync("age-keygen", ["--output", identity], { stdio: "ignore" });
  const recipient = execFileSync("age-keygen", ["-y", identity], { encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const result = spawnSync(process.execPath, [join(root, "scripts/backup/export.mjs"), "--execute"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      BACKUP_SOURCE_PROJECT_REF: "local", BACKUP_SOURCE_DATABASE_URL: s.dbUrl, BACKUP_SOURCE_API_URL: s.apiUrl,
      BACKUP_SOURCE_SECRET_KEY: s.secret, BACKUP_OUTPUT_DIR: output, BACKUP_AGE_RECIPIENT: recipient,
      BACKUP_DESTINATION: "synthetic-local-only", BACKUP_RELEASE_COMMIT: commit, BACKUP_SYNTHETIC_ONLY: "1",
    },
  });
  if (result.status !== 0) throw new Error("Synthetic export failed; diagnostics withheld by export.mjs.");
  const runs = readdirSync(output);
  if (runs.length !== 1) throw new Error("Expected exactly one export run.");
  const bundle = join(output, runs[0]);
  return hashFile(join(bundle, "manifest.json.age")).then((manifestHash) => {
    writeFileSync(join(temp, "recovery-receipt.json"), JSON.stringify({ bundle, identity, manifestHash, sourceDbUrl: s.dbUrl }), { mode: 0o600 });
    console.log(`Encrypted export complete: ${readdirSync(bundle).length} sealed artifacts; manifest hash recorded separately.`);
  });
}

function restoreDatabase() {
  const target = stack();
  const receipt = JSON.parse(readFileSync(join(temp, "recovery-receipt.json"), "utf8"));
  const result = spawnSync(process.execPath, [join(root, "scripts/backup/restore-lab.mjs"), "--execute"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      BACKUP_BUNDLE_DIR: receipt.bundle, BACKUP_AGE_IDENTITY_FILE: receipt.identity, BACKUP_EXPECTED_MANIFEST_SHA256: receipt.manifestHash,
      BACKUP_SOURCE_DATABASE_URL: receipt.sourceDbUrl, BACKUP_TARGET_DATABASE_URL: target.dbUrl,
      BACKUP_SYNTHETIC_ONLY: "1", BACKUP_RESTORE_ISOLATED: "1",
    },
  });
  if (result.status !== 0) throw new Error("Database restore into the isolated target failed; diagnostics withheld by restore-lab.mjs.");
  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1));
  console.log(`Database restored into an empty isolated stack (syntheticDatabaseRestored=${summary.syntheticDatabaseRestored}).`);
  return withDb(target.dbUrl, (db) => db.query("notify pgrst, 'reload schema'"));
}

async function restoreObjects() {
  const target = stack();
  const receipt = JSON.parse(readFileSync(join(temp, "recovery-receipt.json"), "utf8"));
  const manifest = await readEncryptedJson(join(receipt.bundle, "manifest.json.age"), receipt.identity, receipt.manifestHash);
  const storage = createClient(target.apiUrl, target.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let restored = 0;
  for (const object of manifest.objects) {
    const component = manifest.components.find((entry) => entry.filename === object.filename);
    if (!component || await hashFile(join(receipt.bundle, object.filename)) !== component.ciphertextSha256) throw new Error("Encrypted object does not match the manifest.");
    const chunks = [];
    const verified = await decryptStream(join(receipt.bundle, object.filename), receipt.identity, new Writable({ write(chunk, _e, cb) { chunks.push(chunk); cb(); } }));
    if (verified.plaintextSha256 !== component.plaintextSha256) throw new Error("Decrypted object differs from the manifest.");
    const { error } = await storage.storage.from(object.bucket).upload(object.path, Buffer.concat(chunks), { contentType: object.metadata?.mimetype, upsert: true });
    if (error) throw new Error("Restored object upload failed; path withheld.");
    restored += 1;
  }
  console.log(`Restored ${restored}/${manifest.objects.length} Storage objects from the encrypted bundle.`);
}

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function verify(beforePath) {
  const target = stack();
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = await fingerprint(target);
  check("histórico de migrations idêntico", JSON.stringify(after.migrations) === JSON.stringify(before.migrations), `${after.migrations.length} versões`);
  for (const [table, value] of Object.entries(before.rowsByTable)) {
    const now = after.rowsByTable[table];
    check(`${table}: contagem e checksum`, Boolean(now) && now.count === value.count && now.digest === value.digest, `${value.count} linhas`);
  }
  check("sem tabelas novas inesperadas", Object.keys(after.rowsByTable).length === Object.keys(before.rowsByTable).length);
  check("relacionamentos: zero órfãos em todas as FKs", after.orphans === 0 && before.orphans === 0, `${after.foreignKeys} FKs`);
  for (const [path, hash] of Object.entries(before.fileHashes)) {
    check(`arquivo ${path.split("/")[0]}/…: SHA-256 igual`, after.fileHashes[path] === hash && hash !== "missing");
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const [index, owner] of state.owners.entries()) {
    const login = await fetch(`${target.apiUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: target.publishable, "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: owner.password }),
    });
    const session = await login.json().catch(() => ({}));
    check(`Auth: login do dono ${index} com a senha original (hash preservado)`, login.status === 200 && typeof session.access_token === "string", `HTTP ${login.status}`);
    if (session.access_token) {
      const own = await fetch(`${target.apiUrl}/rest/v1/tenants?select=id&id=eq.${state.tenants[index].tenantId}`, { headers: { apikey: target.publishable, authorization: `Bearer ${session.access_token}` } });
      const other = await fetch(`${target.apiUrl}/rest/v1/orders?select=id&tenant_id=eq.${state.tenants[1 - index].tenantId}`, { headers: { apikey: target.publishable, authorization: `Bearer ${session.access_token}` } });
      check(`RLS: dono ${index} lê a própria loja`, own.status === 200 && (await own.json()).length === 1);
      check(`RLS: dono ${index} não vê pedidos da outra loja`, other.status === 200 && (await other.json()).length === 0);
    }
  }
  const publicCarts = await fetch(`${target.apiUrl}/rest/v1/carts?select=id&limit=1`, { headers: { apikey: target.publishable } });
  check("RLS/grants: chave pública sem acesso a carrinhos", [401, 403].includes(publicCarts.status), `HTTP ${publicCarts.status}`);
}

const [command, argument] = process.argv.slice(2);
if (command === "seed") await seed();
else if (command === "fingerprint") { writeFileSync(argument, JSON.stringify(await fingerprint(stack()))); console.log("Source fingerprint recorded (counts, row checksums, FK orphans, file hashes)."); }
else if (command === "export") await runExport();
else if (command === "restore-db") { await restoreDatabase(); await new Promise((resolve) => setTimeout(resolve, 3000)); }
else if (command === "restore-objects") await restoreObjects();
else if (command === "verify") await verify(argument);
else throw new Error(`Unknown command: ${command}`);

if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exit(1);
}
