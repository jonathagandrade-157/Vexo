import { resolve, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { assertEmptyRestoreTarget, assertSafeArtifactName, decryptStream, hashFile, pgEnvironment, silentProcess } from "./core.mjs";
import { connectDatabase } from "./export.mjs";

export async function readEncryptedJson(path, identity, expectedCiphertextHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedCiphertextHash ?? "") || await hashFile(path) !== expectedCiphertextHash) {
    throw new Error("Encrypted manifest does not match the separately recorded trusted receipt.");
  }
  const chunks = [];
  let bytes = 0;
  await decryptStream(path, identity, new Writable({ write(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > 50 * 1024 * 1024) return callback(new Error("Manifest exceeds the reviewable size bound."));
    chunks.push(chunk); callback();
  } }));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function restoreSyntheticDatabase({ directory, identity, expectedManifestHash, sourceDatabaseUrl, targetDatabaseUrl, env = process.env }) {
  const manifest = await readEncryptedJson(join(directory, "manifest.json.age"), identity, expectedManifestHash);
  if (manifest.projectRef !== "local" || manifest.exportComplete !== true) {
    throw new Error("This laboratory restore refuses hosted-project data. Real recovery requires the separately approved target/key-copy procedure.");
  }
  // Reject source aliases and non-loopback targets BEFORE connecting.
  assertEmptyRestoreTarget(sourceDatabaseUrl, targetDatabaseUrl, {}, env);
  const { database } = await connectDatabase({ databaseUrl: targetDatabaseUrl });
  let targetHasMigrationHistory = false;
  try {
    const appTables = (await database.query("select count(*) as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public','private')")).rows[0].count;
    const counts = { appTables };
    for (const table of ["auth.users", "storage.objects", "storage.buckets", "vault.secrets", "supabase_migrations.schema_migrations"]) {
      const exists = (await database.query("select to_regclass($1) as name", [table])).rows[0].name;
      counts[table] = exists ? (await database.query(`select count(*) as count from ${table}`)).rows[0].count : 0;
      if (table === "supabase_migrations.schema_migrations") targetHasMigrationHistory = Boolean(exists);
    }
    const occupied = Object.entries(counts).filter(([, count]) => Number(count) !== 0);
    if (occupied.length) throw new Error(`Synthetic restore target preflight not empty: ${occupied.map(([name, count]) => `${name}=${count}`).join(",")}`);
    assertEmptyRestoreTarget(sourceDatabaseUrl, targetDatabaseUrl, counts, env);
  } finally { await database.end(); }

  const required = ["roles", "schema", "history-schema", "vault-data", "data", "history-data"];
  const allComponents = required.map((kind) => {
    const records = manifest.components.filter((entry) => entry.kind === kind);
    if (records.length !== 1) throw new Error("Incomplete or ambiguous database bundle.");
    const record = records[0];
    assertSafeArtifactName(record.filename);
    return record;
  });
  for (const record of allComponents) {
    if (await hashFile(join(directory, record.filename)) !== record.ciphertextSha256) throw new Error("Encrypted component hash mismatch; restore not started.");
  }
  // A Supabase stack initializes the migration table and protected roles.
  // Reuse those managed structures there; a raw PostgreSQL laboratory still
  // restores both components from the bundle.
  const components = allComponents.filter((record) => {
    if (!targetHasMigrationHistory) return true;
    return !["roles", "history-schema"].includes(record.kind);
  });
  const psql = silentProcess("psql", ["--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=sqlstate", "--single-transaction", "--file", "-"], {
    env: pgEnvironment(targetDatabaseUrl),
    reportSqlState: true,
  });
  let lastComponent = "preflight";
  psql.child.stdout.setEncoding("utf8");
  psql.child.stdout.on("data", (chunk) => {
    for (const match of chunk.matchAll(/VEXO_RESTORE_COMPONENT_([a-z-]+)/g)) lastComponent = match[1];
  });
  try {
    for (const record of components) {
      psql.child.stdin.write(`\\echo VEXO_RESTORE_COMPONENT_${record.kind}\n`);
      const verified = await decryptStream(join(directory, record.filename), identity, psql.child.stdin, { end: false });
      if (verified.plaintextSha256 !== record.plaintextSha256 || verified.plaintextBytes !== record.plaintextBytes) {
        throw new Error("Decrypted component differs from the trusted manifest; transaction will roll back.");
      }
      psql.child.stdin.write("\n");
    }
    psql.child.stdin.end();
    await psql.done;
  } catch (error) {
    const pipeClosed = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_PREMATURE_CLOSE"]).has(error.code);
    const cause = pipeClosed ? await psql.done.catch((processError) => processError) : error;
    if (!pipeClosed) psql.child.kill();
    throw new Error(`Synthetic restore failed in ${lastComponent}: ${cause.message}`);
  }
  return { runId: manifest.runId, syntheticDatabaseRestored: true, reusedManagedRoles: targetHasMigrationHistory,
    reusedMigrationHistorySchema: targetHasMigrationHistory, productionRecoveryValidated: false,
    limitations: ["Managed Auth/provider configuration", "Actual Supabase root-key transfer", "Storage service restore", "Real backup destination and retention"] };
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ mode: "plan-only", syntheticOnly: true, requiredNames: ["BACKUP_BUNDLE_DIR", "BACKUP_AGE_IDENTITY_FILE", "BACKUP_EXPECTED_MANIFEST_SHA256", "BACKUP_SOURCE_DATABASE_URL", "BACKUP_TARGET_DATABASE_URL", "BACKUP_SYNTHETIC_ONLY", "BACKUP_RESTORE_ISOLATED"] }));
    return;
  }
  const env = process.env;
  const result = await restoreSyntheticDatabase({ directory: env.BACKUP_BUNDLE_DIR, identity: env.BACKUP_AGE_IDENTITY_FILE,
    expectedManifestHash: env.BACKUP_EXPECTED_MANIFEST_SHA256, sourceDatabaseUrl: env.BACKUP_SOURCE_DATABASE_URL,
    targetDatabaseUrl: env.BACKUP_TARGET_DATABASE_URL, env });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = /^Synthetic restore failed in [a-z-]+: psql failed \(exit \d+; SQLSTATE [0-9A-Z,]+\); raw output withheld\.$/.test(error.message) ||
      /^Synthetic restore target preflight not empty: (?:[a-z._]+=[0-9]+,?)+$/.test(error.message);
    const frame = error.stack?.match(/restore-lab\.mjs:(\d+):\d+/);
    console.error(safe ? error.message : frame ? `Synthetic restore failed at restore-lab line ${frame[1]}; raw output withheld.` : "Isolated restore failed; sensitive output withheld. Do not promote a release on this result.");
    process.exitCode = 1;
  });
}
