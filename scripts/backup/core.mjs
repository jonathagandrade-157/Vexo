import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export const SUPABASE_CLI_VERSION = "2.115.0";
export const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function toolEnvironment() {
  return Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}

export function pgEnvironment(connectionString, rootCertificate, base = toolEnvironment()) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Expected a PostgreSQL connection.");
  const local = LOOPBACK.has(url.hostname);
  if (!local && url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
    throw new Error("Backup requires direct PostgreSQL or the session pooler, not transaction pooling.");
  }
  if (!local && !rootCertificate) throw new Error("Hosted PostgreSQL requires BACKUP_PGSSLROOTCERT_FILE.");
  // Connection secrets stay in the child's environment, never argv or a script.
  return {
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: local ? "disable" : "verify-full",
    ...(local ? {} : { PGSSLROOTCERT: rootCertificate }),
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "vexo-encrypted-backup",
  };
}

export function assertProjectBinding(databaseUrl, apiUrl, projectRef) {
  const db = new URL(databaseUrl);
  const api = new URL(apiUrl);
  if (LOOPBACK.has(db.hostname) && LOOPBACK.has(api.hostname) && projectRef === "local") return;
  if (!/^[a-z]{20}$/.test(projectRef) || api.origin !== `https://${projectRef}.supabase.co`) {
    throw new Error("Supabase API and approved project do not match.");
  }
  const direct = db.hostname === `db.${projectRef}.supabase.co`;
  const session = db.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(db.username).endsWith(`.${projectRef}`);
  if (!direct && !session) throw new Error("Database connection does not belong to the approved project.");
}

export function assertExecutionApproval(config, env) {
  assertProjectBinding(config.databaseUrl, config.apiUrl, config.projectRef);
  if (config.projectRef === "local") {
    if (env.BACKUP_SYNTHETIC_ONLY !== "1") throw new Error("Loopback execution requires an explicit synthetic fixture marker.");
    return;
  }
  if (env.BACKUP_APPROVED_PROJECT_REF !== config.projectRef || env.BACKUP_APPROVED_DESTINATION !== config.destination) {
    throw new Error("Real export requires specific project AND destination approval; plan mode performs no export.");
  }
  if (!env.BACKUP_APPROVAL_REFERENCE?.trim()) throw new Error("Record the specific human approval reference before export.");
}

export function assertSafeArtifactName(name) {
  if (!/^[a-z0-9][a-z0-9.-]{0,100}\.age$/.test(name) || name.includes("..")) throw new Error("Invalid encrypted artifact name.");
  return name;
}

export function assertEmptyRestoreTarget(source, target, counts, env) {
  const identity = (value) => {
    const url = new URL(value);
    return `${LOOPBACK.has(url.hostname) ? "loopback" : url.hostname}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
  };
  if (identity(source) === identity(target)) throw new Error("Restore must never target the source database.");
  if (!LOOPBACK.has(new URL(target).hostname)) throw new Error("Automated restore is limited to an isolated loopback database; hosted restore requires its own reviewed operation.");
  if (env.BACKUP_SYNTHETIC_ONLY !== "1" || env.BACKUP_RESTORE_ISOLATED !== "1") throw new Error("Isolated synthetic restore markers required.");
  if (Object.values(counts).some((value) => Number(value) !== 0)) throw new Error("Restore target contains business or Auth data.");
}

export function silentProcess(command, args, options = {}) {
  const child = spawn(command, args, { env: toolEnvironment(), timeout: 600_000, ...options, stdio: ["pipe", "pipe", "pipe"] });
  const done = new Promise((resolve, reject) => {
    child.on("error", () => reject(new Error(`Could not start ${command}; no credential-bearing diagnostics were logged.`)));
    // Drain, but never print provider/CLI errors: they may contain secrets.
    child.stderr.on("data", () => {});
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}); raw output withheld.`)));
  });
  // Pipelines can reject before the caller awaits process completion.
  done.catch(() => {});
  return { child, done };
}

export async function capture(command, args, options = {}) {
  const process = silentProcess(command, args, options);
  const chunks = [];
  let bytes = 0;
  process.child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 2_000_000) process.child.kill();
    else chunks.push(chunk);
  });
  process.child.stdin.end();
  await process.done;
  return Buffer.concat(chunks).toString("utf8");
}

export async function nativeDumpPlan(kind, cwd) {
  const version = (await capture("supabase", ["--version"], { cwd })).trim();
  if (version !== SUPABASE_CLI_VERSION) throw new Error(`Native dump plans are verified against Supabase CLI ${SUPABASE_CLI_VERSION}.`);
  const variants = {
    roles: ["--role-only"],
    schema: [],
    data: ["--data-only", "--use-copy", "--exclude", "storage.buckets_vectors,storage.vector_indexes"],
    "history-schema": ["--schema", "supabase_migrations"],
    "history-data": ["--schema", "supabase_migrations", "--data-only", "--use-copy"],
  };
  if (!(kind in variants)) throw new Error("Unknown dump component.");
  // A fixed dummy URL makes --dry-run entirely local, with no real secret
  // in arguments. Execute the official filters with native pg_dump later.
  const script = await capture("supabase", ["db", "dump", "--db-url", "postgresql://placeholder@127.0.0.1:54322/postgres", "--dry-run", ...variants[kind]], { cwd });
  return sanitizeDumpPlan(script);
}

export function sanitizeDumpPlan(script) {
  let result = script.replace(/^export PG(?:HOST|PORT|USER|PASSWORD|DATABASE)=.*\r?\n/gm, "");
  if (!result.startsWith("#!/usr/bin/env bash") || !/\bpg_dump(?:all)?\s/.test(result) || /^export PG/m.test(result)) {
    throw new Error("Unexpected Supabase dry-run plan; do not execute an unreviewed CLI format.");
  }
  // All pg_dump components share one exported read-only snapshot.
  result = result.replace(/\bpg_dump \\/, 'pg_dump --snapshot="$VEXO_PG_SNAPSHOT" \\');
  return result;
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function encryptStream(input, destination, recipient) {
  if (!/^age1[0-9a-z]+$/.test(recipient)) throw new Error("Use an age public recipient, never a private identity in the export job.");
  const age = silentProcess("age", ["--encrypt", "--recipient", recipient, "--output", destination]);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback(null, chunk);
  } });
  age.child.stdout.resume();
  try {
    await pipeline(input, meter, createGzip(), age.child.stdin);
    await age.done;
  } catch (error) {
    age.child.kill();
    throw error;
  }
  return { plaintextBytes: bytes, plaintextSha256: hash.digest("hex"), ciphertextBytes: (await stat(destination)).size, ciphertextSha256: await hashFile(destination) };
}

export async function decryptStream(source, identityPath, destination, { end = true } = {}) {
  const age = silentProcess("age", ["--decrypt", "--identity", identityPath, source]);
  age.child.stdin.end();
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback(null, chunk);
  } });
  try {
    await pipeline(age.child.stdout, createGunzip(), meter, destination, { end });
    await age.done;
  } catch (error) {
    age.child.kill();
    throw error;
  }
  return { plaintextBytes: bytes, plaintextSha256: hash.digest("hex") };
}
