/**
 * JON-17 — `is_storefront_blocked` (migration 20260817220119). Testa
 * diretamente a função pública via RPC, no mesmo padrão de
 * billing-webhook-event.test.ts: SQL puro via asActor/withSuperuser, sem
 * Route Handler.
 *
 * Escopo: o limiar de 10 dias de carência (269h ainda não bloqueia, 240h+
 * bloqueia), status diferente de `past_due` nunca bloqueia mesmo com
 * `past_due_since` antigo (defensivo — nunca deveria acontecer, mas a
 * função não confia só em `past_due_since`), reativação limpa o bloqueio,
 * tenant sem nenhuma subscription nunca bloqueia, e os grants (anon e
 * authenticated — ao contrário de `tenant_access_status`, que nunca pode
 * ser chamada por um visitante anônimo da loja).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Billing — is_storefront_blocked (JON-17)", () => {
  let fx: Fixtures;
  let basicPlanId: string;

  async function createTenant(label: string): Promise<string> {
    const tag = `${label}-${runId}`;
    return withSuperuser(async (client) => {
      const { rows: userRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`${tag}@fixtures.test`],
      );
      const userId = userRows[0]!.id;

      const { rows: tenantRows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [`Tenant ${tag}`, `tenant-${tag}`, userId],
      );
      const tenantId = tenantRows[0]!.id;

      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        tenantId,
        userId,
        fx.roleIds.OWNER,
      ]);

      return tenantId;
    });
  }

  async function setSubscription(
    tenantId: string,
    status: string,
    pastDueSince: string | null,
  ): Promise<void> {
    await withSuperuser((client) =>
      client.query(
        `insert into public.subscriptions (tenant_id, plan_id, status, past_due_since)
         values ($1, $2, $3, $4)
         on conflict (tenant_id) do update set status = excluded.status, past_due_since = excluded.past_due_since`,
        [tenantId, basicPlanId, status, pastDueSince],
      ),
    );
  }

  function isBlocked(actor: Parameters<typeof asActor>[0], tenantId: string) {
    return asActor(actor, (c) =>
      c.query<{ is_storefront_blocked: boolean }>("select public.is_storefront_blocked($1) as is_storefront_blocked", [
        tenantId,
      ]),
    ).then((r) => r.rows[0]!.is_storefront_blocked);
  }

  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  }

  beforeAll(async () => {
    fx = await buildFixtures();
    const { rows } = await withSuperuser((c) => c.query<{ id: string }>("select id from public.plans where slug = 'basic'"));
    basicPlanId = rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("1) tenant sem nenhuma subscription nunca bloqueia", async () => {
    const tenantId = await createTenant("no-sub");
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(false);
  });

  it("2) subscription active nunca bloqueia", async () => {
    const tenantId = await createTenant("active");
    await setSubscription(tenantId, "active", null);
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(false);
  });

  it("3) past_due com menos de 10 dias de carência (dia 9) ainda não bloqueia a loja", async () => {
    const tenantId = await createTenant("grace-9d");
    await setSubscription(tenantId, "past_due", hoursAgo(9 * 24));
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(false);
  });

  it("4) past_due com exatamente 10 dias de carência já bloqueia a loja", async () => {
    const tenantId = await createTenant("grace-10d");
    await setSubscription(tenantId, "past_due", hoursAgo(10 * 24));
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(true);
  });

  it("5) past_due com mais de 10 dias de carência bloqueia a loja", async () => {
    const tenantId = await createTenant("grace-15d");
    await setSubscription(tenantId, "past_due", hoursAgo(15 * 24));
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(true);
  });

  it("6) past_due_since antigo mas status já não é 'past_due' (reativado) nunca bloqueia — defensivo, não confia só na data", async () => {
    const tenantId = await createTenant("stale-flag");
    await setSubscription(tenantId, "active", hoursAgo(30 * 24));
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(false);
  });

  it("7) reativação (past_due_since limpo) desbloqueia a loja imediatamente", async () => {
    const tenantId = await createTenant("recovered");
    await setSubscription(tenantId, "past_due", hoursAgo(20 * 24));
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(true);

    await setSubscription(tenantId, "active", null);
    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(false);
  });

  it("8) grants — anon, authenticated e service_role têm EXECUTE (ao contrário de tenant_access_status, que nunca pode ser chamada por um visitante anônimo)", async () => {
    const tenantId = await createTenant("grants-check");
    await setSubscription(tenantId, "past_due", hoursAgo(15 * 24));

    expect(await isBlocked({ role: "anon" }, tenantId)).toBe(true);
    expect(await isBlocked({ role: "authenticated", userId: fx.userOutsider }, tenantId)).toBe(true);
    expect(await isBlocked({ role: "service_role" }, tenantId)).toBe(true);
  });
});
