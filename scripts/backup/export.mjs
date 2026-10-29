import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { assertExecutionApproval, capture, encryptStream, hashFile, LOOPBACK, nativeDumpPlan, pgEnvironment, silentProcess, toolEnvironment } from "./core.mjs";

export const REQUIRED_EXPORT_ENV = [
  "BACKUP_SOURCE_PROJECT_REF", "BACKUP_SOURCE_DATABASE_URL", "BACKUP_SOURCE_API_URL", "BACKUP_SOURCE_SECRET_KEY",
  "BACKUP_OUTPUT_DIR", "BACKUP_AGE_RECIPIENT", "BACKUP_DESTINATION", "BACKUP_RELEASE_COMMIT", "BACKUP_VAULT_ESCROW_RECEIPT",
];

export function exportConfiguration(env) {
  const missing = REQUIRED_EXPORT_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing configuration names: ${missing.join(", ")}`);
  if (!env.BACKUP_SOURCE_SECRET_KEY.startsWith("sb_secret_")) throw new Error("Backup must use a modern server-side secret key.");
  if (!/^[a-f0-9]{40}$/.test(env.BACKUP_RELEASE_COMMIT)) throw new Error("Pin the deployed source commit for recovery.");
  const config = {
    projectRef: env.BACKUP_SOURCE_PROJECT_REF, databaseUrl: env.BACKUP_SOURCE_DATABASE_URL,
    apiUrl: env.BACKUP_SOURCE_API_URL, destination: env.BACKUP_DESTINATION,
    output: resolve(env.BACKUP_OUTPUT_DIR), recipient: env.BACKUP_AGE_RECIPIENT,
    releaseCommit: env.BACKUP_RELEASE_COMMIT, rootCertificate: env.BACKUP_PGSSLROOTCERT_FILE,
  };
  assertExecutionApproval(config, env);
  if (config.projectRef !== "local") {
    if (!/^s3:\/\/[a-z0-9][a-z0-9.-]+\/[a-zA-Z0-9/_-]+$/.test(config.destination)) throw new Error("Use an approved private bucket and prefix.");
    const inRepo = relative(resolve("."), config.output);
    if (!inRepo.startsWith("..") || /[\\/]onedrive[\\/]/i.test(config.output)) throw new Error("Real encrypted exports must be staged outside Git and synchronized workspaces.");
  }
  return config;
}

async function inventory(database) {
  const result = await database.query("select bucket_id, name, metadata from storage.objects order by bucket_id, name");
  return result.rows;
}

export async function connectDatabase(config) {
  const env = pgEnvironment(config.databaseUrl, config.rootCertificate);
  const database = new pg.Client({
    host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE,
    ssl: LOOPBACK.has(env.PGHOST) ? false : { rejectUnauthorized: true, ca: await readFile(config.rootCertificate, "utf8") },
    connectionTimeoutMillis: 20_000, application_name: "vexo-encrypted-backup",
  });
  try { await database.connect(); } catch { throw new Error("Could not connect to the approved database; connection details withheld."); }
  return { database, env };
}

export async function createEncryptedExport(config, env = process.env) {
  assertExecutionApproval(config, env);
  const receipt = JSON.parse(await readFile(env.BACKUP_VAULT_ESCROW_RECEIPT, "utf8"));
  const receiptFields = new Set(["projectRef", "rootKeySha256", "encryptedKeySha256", "encryptedKeyLocation", "createdAt", "recipient", "rootKeyEscrowVerified"]);
  if (Object.keys(receipt).some((key) => !receiptFields.has(key)) || receipt.projectRef !== config.projectRef ||
      !/^[a-f0-9]{64}$/.test(receipt.rootKeySha256 ?? "") || !receipt.encryptedKeyLocation ||
      !/^[a-f0-9]{64}$/.test(receipt.encryptedKeySha256 ?? "") || receipt.rootKeyEscrowVerified !== true || receipt.recipient === config.recipient) {
    throw new Error("A separately stored Vault root-key escrow receipt is required. A SQL dump alone is insufficient.");
  }
  const { database, env: pgEnv } = await connectDatabase(config);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const directory = join(config.output, runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = { formatVersion: 1, runId, projectRef: config.projectRef, releaseCommit: config.releaseCommit,
    startedAt: new Date().toISOString(), destination: config.destination, vaultEscrow: receipt,
    components: [], objects: [], exportComplete: false, restoreValidated: false,
    externalRecoveryRequired: ["Supabase Auth/SMTP/provider configuration", "JWT/session recovery strategy", "Vercel secrets in a separate vault", "DNS and approved integrations"],
  };
  async function seal(input, filename, detail = {}) {
    const result = await encryptStream(input, join(directory, filename), config.recipient);
    const entry = { filename, ...detail, ...result };
    manifest.components.push(entry);
    return entry;
  }
  try {
    await database.query("begin transaction isolation level repeatable read read only");
    const snapshot = (await database.query("select pg_export_snapshot() as id, current_setting('server_version_num') as version")).rows[0];
    if (!/^[a-f0-9-]+$/i.test(snapshot.id)) throw new Error("Unexpected exported snapshot identifier.");
    const pgVersion = await capture("pg_dump", ["--version"]);
    const clientMajor = Number(pgVersion.match(/(\d+)\./)?.[1]);
    if (clientMajor < Math.floor(Number(snapshot.version) / 10000)) throw new Error("Native pg_dump must be at least the source server major version.");
    manifest.databaseVersion = snapshot.version;
    manifest.nativeClient = pgVersion.trim();
    manifest.storageInventory = await inventory(database);
    manifest.migrations = (await database.query("select version from supabase_migrations.schema_migrations order by version")).rows.map((row) => row.version);
    manifest.vaultSecrets = Number((await database.query("select count(*) as count from vault.secrets")).rows[0].count);
    const nativeEnv = { ...pgEnv, VEXO_PG_SNAPSHOT: snapshot.id, PGOPTIONS: "-c default_transaction_read_only=on" };
    const cwd = fileURLToPath(new URL("../../", import.meta.url));
    for (const kind of ["roles", "schema", "data", "history-schema", "history-data"]) {
      const plan = await nativeDumpPlan(kind, cwd);
      const dump = silentProcess("bash", ["-c", plan], { cwd, env: nativeEnv });
      dump.child.stdin.end();
      try { await seal(dump.child.stdout, `${kind}.sql.age`, { kind }); await dump.done; }
      catch (error) { dump.child.kill(); throw error; }
    }
    // Default Supabase dumps EXCLUDE vault. Preserve ciphertext and IDs
    // separately, then restore with the escrowed original project root key.
    const vault = silentProcess("bash", ["-c", "set -euo pipefail; printf 'SET session_replication_role = replica;\\n'; pg_dump --data-only --quote-all-identifiers --schema=vault --table=vault.secrets --snapshot=\"$VEXO_PG_SNAPSHOT\"; printf '\\nRESET ALL;\\n'"], { env: nativeEnv });
    vault.child.stdin.end();
    try { await seal(vault.child.stdout, "vault-data.sql.age", { kind: "vault-data" }); await vault.done; }
    catch (error) { vault.child.kill(); throw error; }
    const archive = silentProcess("git", ["archive", "--format=tar", config.releaseCommit], { cwd });
    archive.child.stdin.end();
    try { await seal(archive.child.stdout, "release-source.tar.age", { kind: "release-source" }); await archive.done; }
    catch (error) { archive.child.kill(); throw error; }
    const storage = createClient(config.apiUrl, env.BACKUP_SOURCE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }) },
    });
    for (const object of manifest.storageInventory) {
      if (Number(object.metadata?.size ?? 0) > 64 * 1024 * 1024) throw new Error("Storage object exceeds the 64 MiB export memory bound; prepare a streamed export before proceeding.");
      const { data, error } = await storage.storage.from(object.bucket_id).download(object.name);
      if (error || !data) throw new Error("A Storage object could not be downloaded; no object path or provider diagnostic was logged.");
      const record = await seal(Readable.fromWeb(data.stream()), `object-${randomUUID()}.age`, { kind: "storage-object" });
      manifest.objects.push({ bucket: object.bucket_id, path: object.name, metadata: object.metadata, filename: record.filename });
    }
    await database.query("commit");
    if (JSON.stringify(await inventory(database)) !== JSON.stringify(manifest.storageInventory)) throw new Error("Storage changed during export. Retry in an approved quiet window; do not publish this bundle.");
    delete manifest.storageInventory;
    manifest.exportComplete = true;
    manifest.finishedAt = new Date().toISOString();
    // Manifest includes sensitive object names: it is encrypted as well.
    const sealedManifest = await encryptStream(Readable.from([JSON.stringify(manifest)]), join(directory, "manifest.json.age"), config.recipient);
    return { directory, manifest, sealedManifest };
  } finally {
    await database.query("rollback").catch(() => {});
    await database.end();
  }
}

export async function uploadAndVerifyExport(bundle, config, env = process.env) {
  if (config.projectRef === "local") throw new Error("Synthetic lab exports are never uploaded to external storage.");
  assertExecutionApproval(config, env);
  for (const name of ["BACKUP_S3_ENDPOINT", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_REGION"]) {
    if (!env[name]) throw new Error(`Missing configuration name: ${name}`);
  }
  if (new URL(env.BACKUP_S3_ENDPOINT).protocol !== "https:") throw new Error("External storage requires HTTPS.");
  const destination = new URL(config.destination);
  const bucket = destination.hostname;
  const basePrefix = destination.pathname.replace(/^\//, "");
  const awsEnv = { ...toolEnvironment(), AWS_ACCESS_KEY_ID: env.BACKUP_S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.BACKUP_S3_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION: env.BACKUP_S3_REGION, AWS_EC2_METADATA_DISABLED: "true" };
  const endpoint = ["--endpoint-url", env.BACKUP_S3_ENDPOINT];
  const acl = JSON.parse(await capture("aws", ["s3api", "get-bucket-acl", "--bucket", bucket, ...endpoint], { env: awsEnv }));
  if (!Array.isArray(acl.Grants) || acl.Grants.length === 0 || acl.Grants.some((grant) => grant.Grantee?.Type === "Group")) throw new Error("Destination privacy could not be verified.");
  const lock = JSON.parse(await capture("aws", ["s3api", "get-object-lock-configuration", "--bucket", bucket, ...endpoint], { env: awsEnv }));
  if (lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled" ||
      !["GOVERNANCE", "COMPLIANCE"].includes(lock.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode) ||
      !(Number(lock.ObjectLockConfiguration?.Rule?.DefaultRetention?.Days) >= 14)) throw new Error("Destination needs approved default Object Lock retention of at least 14 days.");
  // Unique names, no sync/prune/delete. Manifest is the last verified object.
  const filenames = [...bundle.manifest.components.map((entry) => entry.filename), "manifest.json.age"];
  for (const filename of filenames) {
    const source = join(bundle.directory, filename);
    const target = `s3://${bucket}/${basePrefix}/${bundle.manifest.runId}/${filename}`;
    await capture("aws", ["s3", "cp", source, target, "--only-show-errors", "--sse", "AES256", ...endpoint], { env: awsEnv });
    const download = silentProcess("aws", ["s3", "cp", target, "-", "--only-show-errors", ...endpoint], { env: awsEnv });
    download.child.stdin.end();
    const hash = createHash("sha256");
    for await (const chunk of download.child.stdout) hash.update(chunk);
    await download.done;
    if (hash.digest("hex") !== await hashFile(source)) throw new Error("Remote ciphertext verification failed. Backup is not usable.");
  }
  return { runId: bundle.manifest.runId, encryptedFiles: filenames.length, remoteCiphertextVerified: true, restoreValidated: false };
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ mode: "plan-only", noExport: true, requiredNames: REQUIRED_EXPORT_ENV,
      approvalRequired: ["exact source project", "private destination and cost", "Vault root-key escrow", "isolated restore target"],
      nativeDependencies: ["Supabase CLI 2.115.0 (dry-run only)", "PostgreSQL client >= source major", "bash", "age", "AWS CLI for approved upload"] }));
    return;
  }
  process.umask(0o077);
  const config = exportConfiguration(process.env);
  const bundle = await createEncryptedExport(config);
  const result = config.projectRef === "local" ? { runId: bundle.manifest.runId, synthetic: true, uploaded: false } : await uploadAndVerifyExport(bundle, config);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Backup failed; raw database, key and provider output withheld. No recovery approval has been granted."); process.exitCode = 1; });
}
