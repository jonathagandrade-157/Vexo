/**
 * Etapa 20.1 — Alteração de plano de uma loja pelo Master.
 *
 * `updateTenantPlanAction` (features/master/tenants-actions.ts) é uma
 * camada fina de validação amigável (tenant existe, plano existe/está
 * ativo, subscription existe) por cima de um único
 * `update(subscriptions).set({plan_id})` — sem RPC nova, porque a
 * auditoria da Fase 1/Etapa 20 já confirmou que `subscriptions` tem
 * policy de UPDATE restrita a `private.is_platform_master()` (migration
 * 20260817220054). Mesmo padrão de todo o resto da suíte: o que importa
 * testar é a autorização real (RLS/trigger), sempre via SQL direto
 * (asActor/withSuperuser) — a pré-checagem em TypeScript da Action não é
 * alcançável por este harness (Server Actions não rodam fora do Next.js),
 * mesma limitação já documentada nos demais arquivos de integração.
 *
 * `commercial-foundation.test.ts` já cobre que MASTER consegue fazer
 * `update(subscriptions).plan_id` e que isso gera `TENANT_PLAN_CHANGED`
 * — este arquivo cobre especificamente o que a Etapa 20.1 pediu e ainda
 * não tinha teste: SUPPORT_AGENT/OWNER não conseguem alterar, os demais
 * campos da subscription não mudam, produtos/categorias não são
 * apagados numa troca para um plano com limite menor, e features/limites
 * refletem o novo plano imediatamente.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Master — Alteração de plano da loja (Etapa 20.1)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;
  let basicPlanId: string;
  let intermediatePlanId: string;
  let proPlanId: string;

  async function createOwnedTenant(label: string): Promise<{ tenantId: string; userId: string }> {
    return withSuperuser(async (client) => {
      const { rows: userRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`${label}-${runId}@fixtures.test`],
      );
      const userId = userRows[0]!.id;

      const { rows: tenantRows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [`Tenant ${label}`, `tenant-${label}-${runId}`, userId],
      );
      const tenantId = tenantRows[0]!.id;

      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [tenantId, userId, fx.roleIds.OWNER],
      );

      return { tenantId, userId };
    });
  }

  async function setSubscription(tenantId: string, planId: string): Promise<string> {
    return withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')
         on conflict (tenant_id) do update set plan_id = excluded.plan_id
         returning id`,
        [tenantId, planId],
      );
      return rows[0]!.id;
    });
  }

  function changePlan(userId: string, tenantId: string, planId: string, commit = true) {
    return asActor(
      { role: "authenticated", userId },
      (c) => c.query("update public.subscriptions set plan_id = $1 where tenant_id = $2", [planId, tenantId]),
      { commit },
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-plan-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);
    });

    const { rows: planRows } = await withSuperuser((c) =>
      c.query<{ id: string; slug: string }>("select id, slug from public.plans where slug in ('basic', 'intermediate', 'pro')"),
    );
    basicPlanId = planRows.find((p) => p.slug === "basic")!.id;
    intermediatePlanId = planRows.find((p) => p.slug === "intermediate")!.id;
    proPlanId = planRows.find((p) => p.slug === "pro")!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("MASTER walks the full chain BASIC → INTERMEDIATE → PRO → BASIC", async () => {
    const { tenantId } = await createOwnedTenant("chain");
    await setSubscription(tenantId, basicPlanId);

    await changePlan(fx.userMaster, tenantId, intermediatePlanId);
    let row = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]));
    expect(row.rows[0]!.plan_id).toBe(intermediatePlanId);

    await changePlan(fx.userMaster, tenantId, proPlanId);
    row = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]));
    expect(row.rows[0]!.plan_id).toBe(proPlanId);

    await changePlan(fx.userMaster, tenantId, basicPlanId);
    row = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]));
    expect(row.rows[0]!.plan_id).toBe(basicPlanId);
  });

  it("SUPPORT_AGENT can read the subscription but cannot change its plan_id", async () => {
    const { tenantId } = await createOwnedTenant("support-blocked");
    await setSubscription(tenantId, basicPlanId);

    const read = await asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
      c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]),
    );
    expect(read.rows).toHaveLength(1);

    const result = await changePlan(userSupportAgent, tenantId, intermediatePlanId, false);
    expect(result.rowCount).toBe(0);

    const row = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]));
    expect(row.rows[0]!.plan_id).toBe(basicPlanId);
  });

  it("the tenant's own OWNER cannot change its subscription's plan_id", async () => {
    const { tenantId, userId } = await createOwnedTenant("owner-blocked");
    await setSubscription(tenantId, basicPlanId);

    const result = await changePlan(userId, tenantId, intermediatePlanId, false);
    expect(result.rowCount).toBe(0);

    const row = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [tenantId]));
    expect(row.rows[0]!.plan_id).toBe(basicPlanId);
  });

  it("changing plan_id never touches tenant_id, status, or trial dates", async () => {
    const { tenantId } = await createOwnedTenant("fields-untouched");
    const subscriptionId = await setSubscription(tenantId, basicPlanId);
    const before = await withSuperuser((c) =>
      c.query(
        "select tenant_id, status, trial_start, trial_end, current_period_start, current_period_end from public.subscriptions where id = $1",
        [subscriptionId],
      ),
    );

    await changePlan(fx.userMaster, tenantId, intermediatePlanId);

    const after = await withSuperuser((c) =>
      c.query(
        "select tenant_id, status, trial_start, trial_end, current_period_start, current_period_end from public.subscriptions where id = $1",
        [subscriptionId],
      ),
    );
    expect(after.rows[0]).toMatchObject(before.rows[0]!);
  });

  it("a UPDATE that also tries to move tenant_id is rejected — plan_id alone is always the only writable column via this path", async () => {
    const { tenantId } = await createOwnedTenant("tenant-id-guard");
    await setSubscription(tenantId, basicPlanId);
    const other = await createOwnedTenant("tenant-id-guard-other");

    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userMaster },
        (c) => c.query("update public.subscriptions set plan_id = $1, tenant_id = $2 where tenant_id = $3", [intermediatePlanId, other.tenantId, tenantId]),
        { commit: false },
      ),
    );
    expect(err.message).toMatch(/tenant_id is immutable/i);
  });

  it("downgrading to a plan with a lower limit never deletes existing products/categories — it only blocks future inserts beyond the new ceiling", async () => {
    const { tenantId, userId } = await createOwnedTenant("downgrade");
    await setSubscription(tenantId, intermediatePlanId); // limite de categorias: 50

    await withSuperuser((c) =>
      c.query(
        `insert into public.categories (tenant_id, name, slug)
         select $1, 'Categoria ' || gs, 'categoria-' || gs || '-' || $2
         from generate_series(1, 12) as gs`,
        [tenantId, runId],
      ),
    );
    const beforeCount = await withSuperuser((c) => c.query("select count(*)::int as n from public.categories where tenant_id = $1", [tenantId]));
    expect(beforeCount.rows[0]!.n).toBe(12);

    // BASIC's categories_limit is 10 — below the 12 already created.
    await changePlan(fx.userMaster, tenantId, basicPlanId);

    const afterCount = await withSuperuser((c) => c.query("select count(*)::int as n from public.categories where tenant_id = $1", [tenantId]));
    expect(afterCount.rows[0]!.n).toBe(12); // nothing was deleted

    const err = await expectPgError(
      asActor({ role: "authenticated", userId }, (c) =>
        c.query("insert into public.categories (tenant_id, name, slug) values ($1, 'Nova', $2)", [tenantId, `categoria-nova-${runId}`]),
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("VX011");

    const finalCount = await withSuperuser((c) => c.query("select count(*)::int as n from public.categories where tenant_id = $1", [tenantId]));
    expect(finalCount.rows[0]!.n).toBe(12); // still no deletion, insert just blocked
  });

  it("features and limits reflect the new plan immediately after the change — no cache, no copy", async () => {
    const { tenantId, userId } = await createOwnedTenant("live-reflect");
    await setSubscription(tenantId, basicPlanId); // 'shipping' not included; products_limit 50

    const beforeFeature = await asActor({ role: "authenticated", userId }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantId]),
    );
    expect(beforeFeature.rows[0]!.tenant_has_feature).toBe(false);
    const beforeLimit = await asActor({ role: "authenticated", userId }, (c) =>
      c.query<{ tenant_plan_limit: number }>("select public.tenant_plan_limit($1, 'products_limit')", [tenantId]),
    );
    expect(beforeLimit.rows[0]!.tenant_plan_limit).toBe(50);

    await changePlan(fx.userMaster, tenantId, intermediatePlanId); // 'shipping' included; products_limit 500

    const afterFeature = await asActor({ role: "authenticated", userId }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantId]),
    );
    expect(afterFeature.rows[0]!.tenant_has_feature).toBe(true);
    const afterLimit = await asActor({ role: "authenticated", userId }, (c) =>
      c.query<{ tenant_plan_limit: number }>("select public.tenant_plan_limit($1, 'products_limit')", [tenantId]),
    );
    expect(afterLimit.rows[0]!.tenant_plan_limit).toBe(500);
  });

  it("exactly one TENANT_PLAN_CHANGED audit row is recorded per plan change", async () => {
    const { tenantId } = await createOwnedTenant("audit-once");
    const subscriptionId = await setSubscription(tenantId, basicPlanId);

    const beforeCount = await withSuperuser((c) =>
      c.query<{ n: string }>("select count(*)::int as n from public.audit_logs where resource_id = $1 and action = 'TENANT_PLAN_CHANGED'", [subscriptionId]),
    );

    await changePlan(fx.userMaster, tenantId, intermediatePlanId);

    const afterCount = await withSuperuser((c) =>
      c.query<{ n: string }>("select count(*)::int as n from public.audit_logs where resource_id = $1 and action = 'TENANT_PLAN_CHANGED'", [subscriptionId]),
    );
    expect(Number(afterCount.rows[0]!.n)).toBe(Number(beforeCount.rows[0]!.n) + 1);

    const latest = await withSuperuser((c) =>
      c.query(
        "select before, after from public.audit_logs where resource_id = $1 and action = 'TENANT_PLAN_CHANGED' order by created_at desc limit 1",
        [subscriptionId],
      ),
    );
    expect(latest.rows[0]).toMatchObject({
      before: { plan_id: basicPlanId },
      after: { plan_id: intermediatePlanId },
    });
  });
});
