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
  try {
    const appTables = (await database.query("select count(*) as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public','private')")).rows[0].count;
    const counts = { appTables };
    for (const table of ["auth.users", "storage.objects", "storage.buckets", "vault.secrets"]) {
      const exists = (await database.query("select to_regclass($1) as name", [table])).rows[0].name;
      counts[table] = exists ? (await database.query(`select count(*) as count from ${table}`)).rows[0].count : 0;
    }
    assertEmptyRestoreTarget(sourceDatabaseUrl, targetDatabaseUrl, counts, env);
  } finally { await database.end(); }

  const ordered = ["roles", "schema", "history-schema", "vault-data", "data", "history-data"];
  const components = ordered.map((kind) => {
    const records = manifest.components.filter((entry) => entry.kind === kind);
    if (records.length !== 1) throw new Error("Incomplete or ambiguous database bundle.");
    const record = records[0];
    assertSafeArtifactName(record.filename);
    return record;
  });
  for (const record of components) {
    if (await hashFile(join(directory, record.filename)) !== record.ciphertextSha256) throw new Error("Encrypted component hash mismatch; restore not started.");
  }
  const psql = silentProcess("psql", ["--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file", "-"], {
    env: pgEnvironment(targetDatabaseUrl),
  });
  psql.child.stdout.resume();
  try {
    for (const record of components) {
      const verified = await decryptStream(join(directory, record.filename), identity, psql.child.stdin, { end: false });
      if (verified.plaintextSha256 !== record.plaintextSha256 || verified.plaintextBytes !== record.plaintextBytes) {
        throw new Error("Decrypted component differs from the trusted manifest; transaction will roll back.");
      }
      psql.child.stdin.write("\n");
    }
    psql.child.stdin.end();
    await psql.done;
  } catch (error) { psql.child.kill(); throw error; }
  return { runId: manifest.runId, syntheticDatabaseRestored: true, productionRecoveryValidated: false,
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
  main().catch(() => { console.error("Isolated restore failed; sensitive output withheld. Do not promote a release on this result."); process.exitCode = 1; });
}
