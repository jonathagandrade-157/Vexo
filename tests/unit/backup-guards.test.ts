import { describe, expect, it } from "vitest";

// Runtime scripts are also imported by the Linux recovery laboratory.
// @ts-expect-error Operational Node entrypoints deliberately use .mjs.
import { assertEmptyRestoreTarget, assertExecutionApproval, assertProjectBinding, assertSafeArtifactName, pgEnvironment, sanitizeDumpPlan } from "../../scripts/backup/core.mjs";
// @ts-expect-error Operational Node entrypoints deliberately use .mjs.
import { validateRootKey } from "../../scripts/backup/vault-escrow.mjs";

const ref = "vqbiurnfqkjkrenigxzv";
const databaseUrl = `postgresql://postgres:fixture@db.${ref}.supabase.co:5432/postgres`;
const apiUrl = `https://${ref}.supabase.co`;
const destination = "s3://private-fixture/vexo";

describe("backup execution boundaries", () => {
  it("requires explicit source and destination approval for real exports", () => {
    const config = { projectRef: ref, databaseUrl, apiUrl, destination };
    expect(() => assertExecutionApproval(config, {})).toThrow(/specific project AND destination approval/);
    expect(() => assertExecutionApproval(config, { BACKUP_APPROVED_PROJECT_REF: ref, BACKUP_APPROVED_DESTINATION: "s3://another/prefix" })).toThrow();
    expect(() => assertExecutionApproval(config, { BACKUP_APPROVED_PROJECT_REF: ref, BACKUP_APPROVED_DESTINATION: destination })).toThrow(/reference/);
    expect(() => assertExecutionApproval(config, { BACKUP_APPROVED_PROJECT_REF: ref, BACKUP_APPROVED_DESTINATION: destination, BACKUP_APPROVAL_REFERENCE: "fixture approval, not real authorization" })).not.toThrow();
  });

  it("does not treat a hosted source as a synthetic local database", () => {
    expect(() => assertExecutionApproval({ projectRef: "local", databaseUrl, apiUrl, destination }, { BACKUP_SYNTHETIC_ONLY: "1" })).toThrow();
    expect(() => assertExecutionApproval({ projectRef: "local", databaseUrl: "postgres://test@localhost/source", apiUrl: "http://127.0.0.1:54321", destination }, {})).toThrow(/synthetic/);
  });

  it("binds both the API and database to the approved Supabase project", () => {
    expect(() => assertProjectBinding(databaseUrl, `https://${ref}.supabase.co.evil.example`, ref)).toThrow();
    expect(() => assertProjectBinding("postgres://postgres:fixture@evil.example/db", apiUrl, ref)).toThrow();
    expect(() => assertProjectBinding(`postgres://postgres.${ref}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, apiUrl, ref)).not.toThrow();
  });

  it("uses environment variables instead of putting database credentials into argv", () => {
    const env = pgEnvironment("postgres://owner:p%24ss%26word@localhost:5432/source", undefined, {});
    expect(env).toMatchObject({ PGUSER: "owner", PGPASSWORD: "p$ss&word", PGDATABASE: "source", PGSSLMODE: "disable" });
    expect(() => pgEnvironment(databaseUrl, undefined, {})).toThrow(/rootcert/i);
    expect(pgEnvironment(databaseUrl, "/approved/ca.crt", {}).PGSSLMODE).toBe("verify-full");
    expect(() => pgEnvironment(`postgres://postgres.${ref}:fixture@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, "/ca.crt", {})).toThrow(/transaction pooling/);
  });

  it("removes every dummy connection export from the native CLI plan", () => {
    const plan = sanitizeDumpPlan('#!/usr/bin/env bash\nset -euo pipefail\nexport PGHOST="127.0.0.1"\nexport PGPORT="54322"\nexport PGUSER="placeholder"\nexport PGPASSWORD="dummy"\nexport PGDATABASE="postgres"\npg_dump \\\n --schema-only\n');
    expect(plan).not.toContain("dummy");
    expect(plan).not.toContain("export PG");
    expect(plan).toContain('--snapshot="$VEXO_PG_SNAPSHOT"');
    expect(() => sanitizeDumpPlan("echo unexpected-format")).toThrow();
    expect(() => sanitizeDumpPlan('#!/usr/bin/env bash\nexport PGSERVICE="unexpected"\npg_dump --schema-only\n')).toThrow();
  });

  it("rejects source aliases, nonempty targets and hosted automatic restores", () => {
    const markers = { BACKUP_SYNTHETIC_ONLY: "1", BACKUP_RESTORE_ISOLATED: "1" };
    expect(() => assertEmptyRestoreTarget("postgres://user@localhost/source", "postgres://other@127.0.0.1:5432/source", {}, markers)).toThrow(/source database/);
    expect(() => assertEmptyRestoreTarget("postgres://user@localhost/source", databaseUrl, {}, markers)).toThrow(/loopback/);
    expect(() => assertEmptyRestoreTarget("postgres://user@localhost/source", "postgres://user@localhost/target", { users: 1 }, markers)).toThrow(/contains/);
    expect(() => assertEmptyRestoreTarget("postgres://user@localhost/source", "postgres://user@localhost/target", {}, {})).toThrow(/markers/);
    expect(() => assertEmptyRestoreTarget("postgres://user@localhost/source", "postgres://user@localhost/target", { users: 0 }, markers)).not.toThrow();
  });

  it("rejects path traversal and plaintext artifacts", () => {
    for (const value of ["../data.age", "/tmp/data.age", "data.sql", "a..b.age", "object/secret.age"]) expect(() => assertSafeArtifactName(value)).toThrow();
    expect(assertSafeArtifactName("manifest.json.age")).toBe("manifest.json.age");
  });

  it("validates root-key format without logging provider values", () => {
    expect(validateRootKey("A".repeat(64))).toBe("a".repeat(64));
    expect(() => validateRootKey({ secret: "fixture" })).toThrow(/format/);
    expect(() => validateRootKey("provider-sensitive-error")).toThrow("Unexpected project root-key format; raw response withheld.");
  });
});
