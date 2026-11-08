#!/usr/bin/env node
/**
 * Fronteira entre as migrations que a produção JÁ tem e as que o release
 * aplicará. A linha de base foi conferida somente leitura em
 * supabase_migrations.schema_migrations do projeto de produção
 * (vqbiurnfqkjkrenigxzv) em 2026-11-07 e 2026-11-08: 123 registros, último
 * `20261026210716`. Reconfirme antes do GO (runbook controlled-release.md):
 * se a produção tiver mudado, este valor e o roteiro precisam ser revistos.
 *
 * Uso:
 *   node scripts/operations/release-migrations.mjs list
 *   node scripts/operations/release-migrations.mjs stage-production <dir>
 *     move as pendentes para <dir>, deixando supabase/migrations no estado
 *     exato da produção (usado pela homologação de rollout)
 *   node scripts/operations/release-migrations.mjs restore <dir>
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_LAST_APPLIED = "20261026210716";
export const PRODUCTION_APPLIED_COUNT = 123;

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

export function migrationFiles(dir = migrationsDir) {
  return readdirSync(dir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
}

export function splitMigrations(files = migrationFiles()) {
  const applied = files.filter((name) => name.slice(0, 14) <= PRODUCTION_LAST_APPLIED);
  const pending = files.filter((name) => name.slice(0, 14) > PRODUCTION_LAST_APPLIED);
  return { applied, pending };
}

function main() {
  const [command, target] = process.argv.slice(2);
  const { applied, pending } = splitMigrations();
  if (applied.length !== PRODUCTION_APPLIED_COUNT) {
    throw new Error(`Expected ${PRODUCTION_APPLIED_COUNT} migrations already in production, found ${applied.length} locally.`);
  }
  if (command === "list") {
    console.log(`Production baseline: ${applied.length} migrations, last ${PRODUCTION_LAST_APPLIED}.`);
    console.log(`Pending, in apply order (${pending.length}):`);
    for (const name of pending) console.log(`  ${name}`);
    return;
  }
  if (!target) throw new Error("A staging directory is required.");
  if (command === "stage-production") {
    mkdirSync(target, { recursive: true });
    for (const name of pending) renameSync(join(migrationsDir, name), join(target, name));
    console.log(`Staged ${pending.length} pending migrations; supabase/migrations now matches production (${applied.length}).`);
    return;
  }
  if (command === "restore") {
    const staged = migrationFiles(target);
    for (const name of staged) renameSync(join(target, name), join(migrationsDir, name));
    console.log(`Restored ${staged.length} pending migrations.`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
