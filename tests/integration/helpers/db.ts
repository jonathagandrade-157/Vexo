import { Pool, type PoolClient } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vexo_test";

export const pool = new Pool({ connectionString: DATABASE_URL });

export type SimulatedActor =
  | { role: "anon" }
  | { role: "authenticated"; userId: string }
  | { role: "service_role" };

function claimsFor(actor: SimulatedActor): string {
  if (actor.role === "authenticated") {
    return JSON.stringify({ role: "authenticated", sub: actor.userId });
  }
  return JSON.stringify({ role: actor.role });
}

/**
 * Runs `fn` inside a transaction impersonating `actor`, mirroring exactly
 * what PostgREST does per request in a real Supabase project: `SET ROLE`
 * to the JWT's role claim, and set the `request.jwt.claims` GUC that
 * auth.uid()/auth.role() (tests/integration/fixtures/supabase-stub.sql)
 * and every private.* helper function read.
 *
 * By default rolls back, so a test scenario's writes never leak into the
 * next one. Pass `{ commit: true }` for the (rarer) scenario under test
 * that needs its write to actually persist — e.g. to then assert on a
 * side effect (an audit_logs row, a trigger-created tenant_members row)
 * visible only to a *separate* later connection/transaction.
 */
export async function asActor<T>(
  actor: SimulatedActor,
  fn: (client: PoolClient) => Promise<T>,
  options: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${actor.role}`);
    await client.query(
      "select set_config('request.jwt.claims', $1, true)",
      [claimsFor(actor)],
    );
    const result = await fn(client);
    await client.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` as the connecting superuser (postgres) — bypasses RLS
 * unconditionally (stronger than BYPASSRLS: superusers are never subject
 * to RLS, with or without FORCE). Used only for building/inspecting test
 * fixtures, never to exercise the policies under test.
 */
export async function withSuperuser<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // private.log_audit()'s cross-tenant guard (0010) special-cases
    // auth.role() = 'service_role'; setting it here (session-level, not
    // `set local`) lets fixture setup call functions/triggers that log
    // audit events without needing its own transaction. asActor() below
    // always overrides this per-transaction via `set local`, so it never
    // leaks into an actual test scenario.
    await client.query(
      "select set_config('request.jwt.claims', $1, false)",
      [JSON.stringify({ role: "service_role" })],
    );
    return await fn(client);
  } finally {
    client.release();
  }
}

export function expectPgError(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected a Postgres error, but the query succeeded");
    },
    (err: unknown) => err as Error,
  );
}
