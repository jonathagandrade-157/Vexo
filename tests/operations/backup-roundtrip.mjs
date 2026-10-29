import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable, Writable } from "node:stream";

import pg from "pg";

import { capture, decryptStream, encryptStream, hashFile, LOOPBACK } from "../../scripts/backup/core.mjs";
import { createEncryptedExport, exportConfiguration } from "../../scripts/backup/export.mjs";
import { readEncryptedJson, restoreSyntheticDatabase } from "../../scripts/backup/restore-lab.mjs";
import { sealRootKey, verifyEscrowCopy } from "../../scripts/backup/vault-escrow.mjs";

// This laboratory tests the native dump/encryption/restore machinery.
// Minimal managed-schema fixtures are NOT proof of Supabase Vault/Auth
// recovery. That remains a separate approved platform restore operation.
const adminUrl = process.env.BACKUP_LAB_DATABASE_URL;
if (!adminUrl || !LOOPBACK.has(new URL(adminUrl).hostname) || process.env.BACKUP_LAB_SYNTHETIC !== "1") {
  throw new Error("Recovery laboratory requires an explicit disposable loopback database.");
}
process.umask(0o077);
const started = Date.now();
const suffix = Date.now().toString(36);
const sourceName = `backup_source_${suffix}`;
const targetName = `backup_target_${suffix}`;
const sourceUrl = new URL(adminUrl);
sourceUrl.pathname = `/${sourceName}`;
const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${targetName}`;
const output = resolve("test-results/backup-lab", suffix);
await mkdir(output, { recursive: true });
const identity = join(output, "data-identity.txt");
const vaultIdentity = join(output, "vault-identity.txt");
await capture("age-keygen", ["--output", identity]);
await capture("age-keygen", ["--output", vaultIdentity]);
const recipient = (await capture("age-keygen", ["--y", identity])).trim();
const vaultRecipient = (await capture("age-keygen", ["--y", vaultIdentity])).trim();
const escrowPath = join(output, "vault-root.age");
const rootKey = "7a".repeat(32); // synthetic cryptographic fixture only
const stagedReceipt = await sealRootKey(rootKey, "local", vaultRecipient, escrowPath);
const receipt = await verifyEscrowCopy(escrowPath, vaultIdentity, { ...stagedReceipt, encryptedKeyLocation: "synthetic-separate-custodian-vault" });
assert.equal(receipt.rootKeyEscrowVerified, true);
await assert.rejects(() => verifyEscrowCopy(escrowPath, identity, receipt));
const receiptPath = join(output, "escrow-receipt.json");
await writeFile(receiptPath, JSON.stringify(receipt));

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`create database ${sourceName}`);
await admin.query(`create database ${targetName}`);
for (const role of ["anon", "authenticated", "service_role"]) {
  if (!(await admin.query("select 1 from pg_roles where rolname = $1", [role])).rowCount) await admin.query(`create role ${role}`);
}

const managedFixture = `
  create schema auth; create schema storage; create schema vault; create schema extensions;
  create extension pgcrypto with schema extensions;
  create table auth.users(id uuid primary key, email text, encrypted_password text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets(id text primary key, name text);
  create table storage.objects(id uuid primary key, bucket_id text references storage.buckets(id), name text, metadata jsonb, updated_at timestamptz default now());
  create table vault.secrets(id uuid primary key, secret bytea);
`;
const source = new pg.Client({ connectionString: sourceUrl.toString() });
const target = new pg.Client({ connectionString: targetUrl.toString() });
await source.connect(); await target.connect();
const storageBinary = Buffer.from([137, 80, 78, 71, 0, 255, 128, 1]);
const storageRequests = [];
let changeObjectDuringDownload = false;
// A loopback HTTP fixture exercises the SDK download path, not the hosted
// Supabase Storage service or the external backup destination.
const storageServer = createServer((request, response) => {
  storageRequests.push(request.url);
  if (request.url !== "/storage/v1/object/fixture-bucket/catalog/test.bin" ||
      request.headers.apikey !== "sb_secret_synthetic_fixture_only") {
    response.writeHead(404); response.end(); return;
  }
  const finish = () => { response.writeHead(200, { "Content-Type": "application/octet-stream" }); response.end(storageBinary); };
  if (changeObjectDuringDownload) {
    source.query("update storage.objects set updated_at = clock_timestamp()")
      .then(finish, () => { response.writeHead(500); response.end(); });
  } else finish();
});
await new Promise((accept) => storageServer.listen(0, "127.0.0.1", accept));
const storageApiUrl = `http://127.0.0.1:${storageServer.address().port}`;
try {
  await source.query(managedFixture);
  await target.query(managedFixture);
  await source.query(`
    create schema private; create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    insert into supabase_migrations.schema_migrations values ('20261026210716', array['synthetic migration'], 'fixture');
    create table public.tenants(id uuid primary key, name text);
    create table public.orders(id uuid primary key, tenant_id uuid references public.tenants(id), owner_id uuid references auth.users(id), total numeric(12,2));
    alter table public.orders enable row level security;
    create policy own_orders on public.orders to authenticated using (owner_id = auth.uid());
    grant usage on schema auth, public to authenticated;
    grant select on public.orders to authenticated;
    insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'synthetic@example.test', extensions.crypt('Fixture-password-A9!', extensions.gen_salt('bf')));
    insert into public.tenants values ('22222222-2222-4222-8222-222222222222', 'Loja de laboratório');
    insert into public.orders values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111', 180.00);
  `);
  // Actual pgcrypto ciphertext is used as a generic database fixture;
  // this is deliberately not called "Supabase Vault encryption".
  await source.query("insert into vault.secrets values ('44444444-4444-4444-8444-444444444444', extensions.pgp_sym_encrypt($1,$2))", ["synthetic-provider-token", rootKey]);
  await source.query("insert into storage.buckets values ('fixture-bucket','fixture-bucket')");
  await source.query("insert into storage.objects(id,bucket_id,name,metadata) values ('66666666-6666-4666-8666-666666666666','fixture-bucket','catalog/test.bin',$1)", [JSON.stringify({ size: storageBinary.length })]);
  const env = {
    ...process.env, BACKUP_SYNTHETIC_ONLY: "1", BACKUP_RESTORE_ISOLATED: "1",
    BACKUP_SOURCE_PROJECT_REF: "local", BACKUP_SOURCE_DATABASE_URL: sourceUrl.toString(),
    BACKUP_SOURCE_API_URL: storageApiUrl, BACKUP_SOURCE_SECRET_KEY: "sb_secret_synthetic_fixture_only",
    BACKUP_OUTPUT_DIR: output, BACKUP_AGE_RECIPIENT: recipient, BACKUP_DESTINATION: "synthetic-local-only",
    BACKUP_RELEASE_COMMIT: (await capture("git", ["rev-parse", "HEAD"])).trim(), BACKUP_VAULT_ESCROW_RECEIPT: receiptPath,
  };
  const bundle = await createEncryptedExport(exportConfiguration(env), env);
  assert.equal(bundle.manifest.exportComplete, true);
  assert.equal(bundle.manifest.restoreValidated, false);
  assert.equal(bundle.manifest.vaultSecrets, 1);
  assert.equal(storageRequests.length, 1);
  assert.equal(bundle.manifest.objects.length, 1);
  const storedObject = bundle.manifest.objects[0];
  assert.equal(storedObject.path, "catalog/test.bin");
  const objectBytes = [];
  await decryptStream(join(bundle.directory, storedObject.filename), identity,
    new Writable({ write(chunk, _encoding, next) { objectBytes.push(chunk); next(); } }));
  assert.deepEqual(Buffer.concat(objectBytes), storageBinary);
  assert.deepEqual(bundle.manifest.migrations, ["20261026210716"]);
  for (const entry of bundle.manifest.components) {
    const encrypted = await readFile(join(bundle.directory, entry.filename));
    assert(!encrypted.includes(Buffer.from("synthetic-provider-token")));
    assert(!encrypted.includes(Buffer.from("synthetic@example.test")));
    assert.equal(createHash("sha256").update(encrypted).digest("hex"), entry.ciphertextSha256);
  }
  const options = { directory: bundle.directory, identity, expectedManifestHash: bundle.sealedManifest.ciphertextSha256,
    sourceDatabaseUrl: sourceUrl.toString(), targetDatabaseUrl: targetUrl.toString(), env };
  await assert.rejects(() => readEncryptedJson(join(bundle.directory, "manifest.json.age"), identity, "0".repeat(64)));
  await assert.rejects(() => restoreSyntheticDatabase({ ...options, targetDatabaseUrl: sourceUrl.toString() }));
  const restored = await restoreSyntheticDatabase(options);
  assert.equal(restored.syntheticDatabaseRestored, true);
  assert.equal(restored.productionRecoveryValidated, false);
  assert.equal((await target.query("select count(*)::int as count from public.orders")).rows[0].count, 1);
  assert.equal((await target.query("select name from storage.objects")).rows[0].name, "catalog/test.bin");
  assert.equal((await target.query("select encrypted_password = extensions.crypt('Fixture-password-A9!',encrypted_password) as password_matches from auth.users")).rows[0].password_matches, true);
  assert.equal((await target.query("select extensions.pgp_sym_decrypt(secret,$1) as value from vault.secrets", [rootKey])).rows[0].value, "synthetic-provider-token");
  assert.equal((await target.query("select version from supabase_migrations.schema_migrations")).rows[0].version, "20261026210716");
  await target.query("begin");
  await target.query("set local role authenticated");
  await target.query("select set_config('request.jwt.claim.sub', $1, true)", ["11111111-1111-4111-8111-111111111111"]);
  assert.equal((await target.query("select count(*)::int as count from public.orders")).rows[0].count, 1);
  await target.query("select set_config('request.jwt.claim.sub', $1, true)", ["55555555-5555-4555-8555-555555555555"]);
  assert.equal((await target.query("select count(*)::int as count from public.orders")).rows[0].count, 0);
  await target.query("rollback");
  await assert.rejects(() => restoreSyntheticDatabase(options));

  // Binary-object packaging, corruption and wrong-key checks use real age.
  const binary = Buffer.from([0, 1, 2, 3, 255, 0, 128]);
  const objectPath = join(output, "object-fixture.age");
  const record = await encryptStream(Readable.from([binary]), objectPath, recipient);
  const decoded = [];
  const result = await decryptStream(objectPath, identity, new Writable({ write(chunk, _enc, next) { decoded.push(chunk); next(); } }));
  assert.deepEqual(Buffer.concat(decoded), binary);
  assert.equal(result.plaintextSha256, record.plaintextSha256);
  const corrupt = await readFile(objectPath); corrupt[corrupt.length - 1] ^= 1;
  await writeFile(join(output, "corrupt.age"), corrupt);
  await assert.rejects(() => decryptStream(join(output, "corrupt.age"), identity, new Writable({ write(_c, _e, next) { next(); } })));
  assert.equal(await hashFile(objectPath), record.ciphertextSha256);

  // Existing encrypted rows must never bypass escrow, even in this fixture.
  const withoutEscrow = { ...env };
  delete withoutEscrow.BACKUP_VAULT_ESCROW_RECEIPT;
  await assert.rejects(() => createEncryptedExport(exportConfiguration(withoutEscrow), withoutEscrow), /root-key escrow/);
  // A source without Vault/TCE data needs no unnecessary root-key export.
  // Only this disposable fixture is changed; the restored target is untouched.
  await source.query("delete from vault.secrets");
  const emptyVaultBundle = await createEncryptedExport(exportConfiguration(withoutEscrow), withoutEscrow);
  assert.equal(emptyVaultBundle.manifest.vaultSecrets, 0);
  assert.equal(emptyVaultBundle.manifest.encryptedColumnLabels, 0);
  assert.equal(emptyVaultBundle.manifest.vaultEscrow, null);
  changeObjectDuringDownload = true;
  await assert.rejects(() => createEncryptedExport(exportConfiguration(withoutEscrow), withoutEscrow), /Storage changed/);
  console.log(JSON.stringify({ laboratory: "native PostgreSQL + real age", sourceDataSynthetic: true, DockerDesktopRequired: false,
    encryptedDatabaseRestored: true, passwordHashPreserved: true, rlsIsolationVerified: true,
    binaryPackagingVerified: true, storageSdkLoopbackFixtureVerified: true, concurrentStorageChangeRejected: true, wrongKeyAndCorruptionRejected: true, conditionalRootEscrowVerified: true, elapsedMs: Date.now() - started,
    productionRecoveryValidated: false, providerAuthAndVaultRecoveryValidated: false, externalStorageTested: false }));
} finally {
  storageServer.closeAllConnections();
  await new Promise((accept) => storageServer.close(accept));
  await source.end(); await target.end(); await admin.end();
}
