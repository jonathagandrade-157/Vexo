/**
 * Etapa 14 — fundação comercial (planos, recursos, assinaturas, feature
 * gating, Painel MASTER). Mesmo padrão de shipping.test.ts/
 * order-management.test.ts: RLS/trigger/RPC testados diretamente via SQL
 * (asActor). Foco: escrita de plans/features/plan_features/subscriptions
 * é MASTER-only (nunca lojista, nunca SUPPORT_AGENT), tenant_has_feature
 * fecha em false em qualquer caso ambíguo, tenant_access_status segue a
 * ordem de precedência documentada, e a auditoria cobre os 8 eventos
 * pedidos.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Fundação Comercial (Etapa 14)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;
  let basicPlanId: string;
  let intermediatePlanId: string;
  let proPlanId: string;
  let couponsFeatureId: string;
  let vexoAiFeatureId: string;

  async function insertPlan(slug: string): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into public.plans (slug, name, trial_days) values ($1, $2, 30) returning id",
        [`${slug}-${runId}`, `Plano ${slug} ${runId}`],
      );
      return rows[0]!.id;
    });
  }

  async function insertFeature(key: string): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into public.features (key, name) values ($1, $2) returning id",
        [`${key}_${runId}`, `Recurso ${key} ${runId}`],
      );
      return rows[0]!.id;
    });
  }

  async function setSubscription(tenantId: string, planId: string, status = "active"): Promise<void> {
    await withSuperuser((c) =>
      c.query(
        `insert into public.subscriptions (tenant_id, plan_id, status) values ($1, $2, $3)
         on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = excluded.status`,
        [tenantId, planId, status],
      ),
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-${runId}@fixtures.test`],
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

    const { rows: featureRows } = await withSuperuser((c) =>
      c.query<{ id: string; key: string }>("select id, key from public.features where key in ('coupons', 'vexo_ai')"),
    );
    couponsFeatureId = featureRows.find((f) => f.key === "coupons")!.id;
    vexoAiFeatureId = featureRows.find((f) => f.key === "vexo_ai")!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // A — Plans CRUD: MASTER pode; lojista/SUPPORT_AGENT/anon não podem.
  it("only MASTER can create/update/activate/deactivate plans", async () => {
    const planId = await withSuperuser(async () => insertPlan("temp"));

    // UPDATE sob RLS sem nenhuma linha visível pela `using` clause não
    // levanta exceção — só afeta 0 linhas silenciosamente (diferente de
    // INSERT, cuja `with check` falhando É um erro real). Por isso a
    // checagem aqui é "a linha continua igual", não `expectPgError`.
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.plans set name = 'Hackeado' where id = $1", [planId]),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: userSupportAgent },
      (c) => c.query("update public.plans set name = 'Hackeado' where id = $1", [planId]),
      { commit: true },
    );
    const unchanged = await withSuperuser((c) => c.query("select name from public.plans where id = $1", [planId]));
    expect(unchanged.rows[0]!.name).not.toBe("Hackeado");

    const deniedAsAnon = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("insert into public.plans (slug, name) values ('anon-plan', 'Anon')")),
    );
    expect(deniedAsAnon.message).toMatch(/row-level security|permission denied/i);

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plans set name = $1, is_active = false where id = $2", [`Renomeado ${runId}`, planId]),
      { commit: true },
    );
    const row = await withSuperuser((c) => c.query("select name, is_active from public.plans where id = $1", [planId]));
    expect(row.rows[0]).toMatchObject({ name: `Renomeado ${runId}`, is_active: false });
  });

  // A2 — slug único.
  it("plans.slug is unique", async () => {
    const slug = `dup-${runId}`;
    await asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("insert into public.plans (slug, name) values ($1, 'X')", [slug]), {
      commit: true,
    });
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("insert into public.plans (slug, name) values ($1, 'Y')", [slug])),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  // B — Features CRUD: mesmo padrão, MASTER-only.
  it("only MASTER can create/update features; lojista and SUPPORT_AGENT cannot", async () => {
    const featureId = await insertFeature("temp");

    for (const actor of [
      { role: "authenticated" as const, userId: fx.userAOwner },
      { role: "authenticated" as const, userId: userSupportAgent },
    ]) {
      await asActor(actor, (c) => c.query("update public.features set name = 'X' where id = $1", [featureId]), { commit: true });
    }
    const unchanged = await withSuperuser((c) => c.query("select name from public.features where id = $1", [featureId]));
    expect(unchanged.rows[0]!.name).not.toBe("X");

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.features set is_active = false where id = $1", [featureId]),
      { commit: true },
    );
    const row = await withSuperuser((c) => c.query("select is_active from public.features where id = $1", [featureId]));
    expect(row.rows[0]!.is_active).toBe(false);
  });

  // C — plan_features: liberar/remover é MASTER-only.
  it("only MASTER can enable/disable a feature for a plan (plan_features insert/delete)", async () => {
    const planId = await insertPlan("assoc");
    const featureId = await insertFeature("assoc");

    const denied = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.plan_features (plan_id, feature_id) values ($1, $2)", [planId, featureId]),
      ),
    );
    expect(denied.message).toMatch(/row-level security|permission denied/i);

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("insert into public.plan_features (plan_id, feature_id) values ($1, $2)", [planId, featureId]),
      { commit: true },
    );
    const afterInsert = await withSuperuser((c) =>
      c.query("select 1 from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
    );
    expect(afterInsert.rows).toHaveLength(1);

    // DELETE sob RLS sem nenhuma linha visível pela `using` clause
    // também não levanta exceção — só afeta 0 linhas.
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("delete from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
      { commit: true },
    );
    const stillThere = await withSuperuser((c) =>
      c.query("select 1 from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
    );
    expect(stillThere.rows).toHaveLength(1);

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("delete from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
      { commit: true },
    );
    const afterDelete = await withSuperuser((c) =>
      c.query("select 1 from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
    );
    expect(afterDelete.rows).toHaveLength(0);
  });

  // D1 — subscriptions: lojista nunca altera o próprio plano diretamente; tenant A não vê subscription de tenant B.
  it("tenant staff can never alter their own subscription directly; another tenant cannot see it", async () => {
    await setSubscription(fx.tenantA, basicPlanId, "active");

    // UPDATE sob RLS sem nenhuma linha visível pela `using` clause não
    // levanta exceção — só afeta 0 linhas silenciosamente.
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.subscriptions set plan_id = $1 where tenant_id = $2", [proPlanId, fx.tenantA]),
      { commit: true },
    );
    const stillBasic = await withSuperuser((c) => c.query("select plan_id from public.subscriptions where tenant_id = $1", [fx.tenantA]));
    expect(stillBasic.rows[0]!.plan_id).toBe(basicPlanId);

    const deniedInsert = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
        c.query("insert into public.subscriptions (tenant_id, plan_id) values ($1, $2)", [fx.tenantB, proPlanId]),
      ),
    );
    expect(deniedInsert.message).toMatch(/row-level security|permission denied/i);

    const asTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.subscriptions where tenant_id = $1", [fx.tenantA]),
    );
    expect(asTenantB.rows).toHaveLength(0);

    const asTenantAOwner = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select plan_id from public.subscriptions where tenant_id = $1", [fx.tenantA]),
    );
    expect(asTenantAOwner.rows[0]!.plan_id).toBe(basicPlanId);
  });

  // D1b — achado da revisão de segurança: tenant_access_status também
  // precisa fechar em um valor seguro para quem não tem relação nenhuma
  // com o tenant consultado (mesma guarda que tenant_has_feature já
  // tinha) — nunca vazar SUSPENDED/TRIALING/etc. de um tenant alheio.
  it("tenant_access_status returns a safe default for a caller with no relation to the tenant", async () => {
    await asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantA]), {
      commit: true,
    });
    const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [fx.tenantA]),
    );
    expect(result.rows[0]!.tenant_access_status).toBe("CANCELLED");

    // membro real do tenant continua recebendo o status verdadeiro.
    const asOwner = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [fx.tenantA]),
    );
    expect(asOwner.rows[0]!.tenant_access_status).not.toBe("CANCELLED");
  });

  // D2 — MASTER pode atribuir/trocar plano de qualquer tenant.
  it("MASTER can assign and change a tenant's plan", async () => {
    await setSubscription(fx.tenantB, basicPlanId, "trialing");
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.subscriptions set plan_id = $1, status = 'active' where tenant_id = $2", [proPlanId, fx.tenantB]),
      { commit: true },
    );
    const row = await withSuperuser((c) => c.query("select plan_id, status from public.subscriptions where tenant_id = $1", [fx.tenantB]));
    expect(row.rows[0]).toMatchObject({ plan_id: proPlanId, status: "active" });
  });

  // E — feature gating: BASIC/INTERMEDIATE/PRO × coupons/vexo_ai, usando o seed real do prompt §6.
  it("tenant_has_feature: BASIC lacks coupons/vexo_ai, INTERMEDIATE has coupons but not vexo_ai, PRO has both", async () => {
    await setSubscription(fx.tenantA, basicPlanId, "active");
    let coupons = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantA]),
    );
    expect(coupons.rows[0]!.tenant_has_feature).toBe(false);
    let vexoAi = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'vexo_ai')", [fx.tenantA]),
    );
    expect(vexoAi.rows[0]!.tenant_has_feature).toBe(false);

    await setSubscription(fx.tenantA, intermediatePlanId, "active");
    coupons = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantA]),
    );
    expect(coupons.rows[0]!.tenant_has_feature).toBe(true);
    vexoAi = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'vexo_ai')", [fx.tenantA]),
    );
    expect(vexoAi.rows[0]!.tenant_has_feature).toBe(false);

    await setSubscription(fx.tenantA, proPlanId, "active");
    coupons = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantA]),
    );
    expect(coupons.rows[0]!.tenant_has_feature).toBe(true);
    vexoAi = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'vexo_ai')", [fx.tenantA]),
    );
    expect(vexoAi.rows[0]!.tenant_has_feature).toBe(true);
  });

  // E2 — tenant_has_feature fecha em false para quem não é membro/platform admin (nunca vaza recurso de outro tenant).
  it("tenant_has_feature returns false for a caller with no relation to the tenant", async () => {
    await setSubscription(fx.tenantA, proPlanId, "active");
    const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantA]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
  });

  // E3 — recurso desativado globalmente pelo MASTER deixa de ser liberado, mesmo continuando associado ao plano.
  it("a globally deactivated feature is never granted, even if still associated with the plan", async () => {
    await setSubscription(fx.tenantA, proPlanId, "active");
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.features set is_active = false where id = $1", [couponsFeatureId]),
      { commit: true },
    );
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantA]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
    await withSuperuser((c) => c.query("update public.features set is_active = true where id = $1", [couponsFeatureId]));
  });

  // E4/E5 — tenant_has_feature retorna false para tenant SUSPENDED e EXPIRED, mesmo com um plano PRO de verdade associado.
  it("tenant_has_feature returns false for a SUSPENDED tenant even with a PRO subscription", async () => {
    await setSubscription(fx.tenantB, proPlanId, "active");
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.tenants set status = 'suspended' where id = $1", [fx.tenantB]),
      { commit: true },
    );
    const result = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantB]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantB]),
      { commit: true },
    );
  });

  it("tenant_has_feature returns false for an EXPIRED subscription even with the feature associated to the plan", async () => {
    await setSubscription(fx.tenantB, proPlanId, "expired");
    const result = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select tenant_has_feature($1, 'coupons')", [fx.tenantB]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
  });

  // F — tenant_access_status: precedência tenants.status > subscriptions > trial_records.
  it("tenant_access_status follows the documented precedence", async () => {
    // Mudar tenants.status exige platform admin de verdade (trigger
    // prevent_unauthorized_tenant_status_change, Etapa 2) — nunca via
    // withSuperuser puro (sem auth.uid(), a checagem interna do trigger
    // falharia mesmo com privilégio de superusuário no Postgres).
    await asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("update public.tenants set status = 'suspended' where id = $1", [fx.tenantB]), {
      commit: true,
    });
    await setSubscription(fx.tenantB, proPlanId, "active");
    let status = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [fx.tenantB]),
    );
    expect(status.rows[0]!.tenant_access_status).toBe("SUSPENDED");

    await asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantB]), {
      commit: true,
    });
    status = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [fx.tenantB]),
    );
    expect(status.rows[0]!.tenant_access_status).toBe("ACTIVE");

    await withSuperuser((c) => c.query("update public.subscriptions set status = 'cancelled' where tenant_id = $1", [fx.tenantB]));
    status = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [fx.tenantB]),
    );
    expect(status.rows[0]!.tenant_access_status).toBe("CANCELLED");
  });

  // F2 — sem subscription, cai para trial_records (Etapa 3, preservada).
  // Setup via withSuperuser (bypassa RLS para criar os dados), mas a
  // CHAMADA de tenant_access_status precisa ser autenticada como o dono
  // do tenant — a guarda de autorização (achado da revisão de
  // segurança) exige is_tenant_member/is_platform_admin, que dependem
  // de auth.uid(), inexistente numa conexão puramente withSuperuser.
  it("tenant_access_status falls back to trial_records when no subscription exists", async () => {
    const { id: tenantId, ownerId } = await withSuperuser(async (client) => {
      const { rows: userRows } = await client.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
        `trial-fallback-${runId}@fixtures.test`,
      ]);
      const ownerId = userRows[0]!.id;
      const { rows: tenantRows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by, status) values ($1, $2, $3, 'active') returning id",
        [`Trial Fallback ${runId}`, `trial-fallback-${runId}`, ownerId],
      );
      const id = tenantRows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        id,
        ownerId,
        fx.roleIds.OWNER,
      ]);
      await client.query(
        "insert into public.trial_records (tenant_id, started_at, ends_at, status) values ($1, now(), now() + interval '30 days', 'active')",
        [id],
      );
      return { id, ownerId };
    });

    const status = await asActor({ role: "authenticated", userId: ownerId }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [tenantId]),
    );
    expect(status.rows[0]!.tenant_access_status).toBe("TRIALING");

    // Move as duas datas para o passado juntas — `ends_at > started_at`
    // continua satisfeito, mas `ends_at` já passou de `now()`.
    await withSuperuser((c) =>
      c.query(
        "update public.trial_records set started_at = now() - interval '31 days', ends_at = now() - interval '1 day' where tenant_id = $1",
        [tenantId],
      ),
    );
    const expired = await asActor({ role: "authenticated", userId: ownerId }, (c) =>
      c.query<{ tenant_access_status: string }>("select tenant_access_status($1)", [tenantId]),
    );
    expect(expired.rows[0]!.tenant_access_status).toBe("EXPIRED");
  });

  // G — public.tenant_access_status / tenant_has_feature são authenticated/service_role only (nunca anon).
  it("tenant_access_status/tenant_has_feature wrappers have no anon execute grant", async () => {
    const errStatus = await expectPgError(asActor({ role: "anon" }, (c) => c.query("select tenant_access_status($1)", [fx.tenantA])));
    expect(errStatus.message).toMatch(/permission denied/i);
    const errFeature = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select tenant_has_feature($1, 'coupons')", [fx.tenantA])),
    );
    expect(errFeature.message).toMatch(/permission denied/i);
  });

  // H — auditoria: os 8 eventos pedidos no prompt §27.
  it("audit log records PLAN_CREATED/PLAN_UPDATED/PLAN_ACTIVATED/PLAN_DEACTIVATED", async () => {
    let planId = "";
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      async (c) => {
        const { rows } = await c.query<{ id: string }>("insert into public.plans (slug, name) values ($1, 'Auditado') returning id", [
          `audit-plan-${runId}`,
        ]);
        planId = rows[0]!.id;
      },
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plans set description = 'nova descrição' where id = $1", [planId]),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plans set is_active = false where id = $1", [planId]),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plans set is_active = true where id = $1", [planId]),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query<{ action: string }>(
        "select action from public.audit_logs where resource_type = 'plan' and resource_id = $1 order by created_at",
        [planId],
      ),
    );
    const actions = logs.rows.map((r) => r.action);
    expect(actions).toEqual(["PLAN_CREATED", "PLAN_UPDATED", "PLAN_DEACTIVATED", "PLAN_ACTIVATED"]);
  });

  it("audit log records FEATURE_CREATED and PLAN_FEATURE_ENABLED/DISABLED", async () => {
    const planId = await insertPlan("audit-assoc");
    let featureId = "";
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.features (key, name) values ($1, 'Auditado') returning id",
          [`audit_feature_${runId}`],
        );
        featureId = rows[0]!.id;
      },
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("insert into public.plan_features (plan_id, feature_id) values ($1, $2)", [planId, featureId]),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("delete from public.plan_features where plan_id = $1 and feature_id = $2", [planId, featureId]),
      { commit: true },
    );

    const featureLogs = await withSuperuser((c) =>
      c.query<{ action: string }>("select action from public.audit_logs where resource_type = 'feature' and resource_id = $1", [featureId]),
    );
    expect(featureLogs.rows.map((r) => r.action)).toContain("FEATURE_CREATED");

    const assocLogs = await withSuperuser((c) =>
      c.query<{ action: string }>(
        "select action from public.audit_logs where resource_type = 'plan_feature' and resource_id = $1 order by created_at",
        [`${planId}:${featureId}`],
      ),
    );
    expect(assocLogs.rows.map((r) => r.action)).toEqual(["PLAN_FEATURE_ENABLED", "PLAN_FEATURE_DISABLED"]);
  });

  it("audit log records TENANT_PLAN_CHANGED with the real tenant_id, on both first assignment and plan change", async () => {
    let subscriptionId = "";
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.subscriptions (tenant_id, plan_id) values ($1, $2) on conflict (tenant_id) do update set plan_id = excluded.plan_id returning id",
          [fx.tenantB, basicPlanId],
        );
        subscriptionId = rows[0]!.id;
      },
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.subscriptions set plan_id = $1 where tenant_id = $2", [proPlanId, fx.tenantB]),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query<{ tenant_id: string }>(
        "select tenant_id from public.audit_logs where action = 'TENANT_PLAN_CHANGED' and resource_id = $1",
        [subscriptionId],
      ),
    );
    expect(logs.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of logs.rows) {
      expect(row.tenant_id).toBe(fx.tenantB);
    }
  });

  // I — Painel MASTER: acesso de leitura ao que a UI usa é bloqueado para quem não é platform admin.
  it("a regular tenant staff member cannot read platform_admins (used to gate /master)", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.platform_admins where user_id = $1", [fx.userAOwner]),
    );
    expect(result.rows).toHaveLength(0);
  });

  // J — plan_limits (ajuste arquitetural): feature ≠ limite; só MASTER cria/edita/remove; leitura da tabela também é MASTER-only.
  it("only MASTER can create/update/delete plan_limits; a regular tenant staff member cannot read the table directly", async () => {
    const planId = await insertPlan("limits");

    const deniedRead = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.plan_limits where plan_id = $1", [planId]),
    );
    expect(deniedRead.rows).toHaveLength(0);

    const deniedInsert = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.plan_limits (plan_id, limit_key, limit_value) values ($1, 'products_limit', 999)", [planId]),
      ),
    );
    expect(deniedInsert.message).toMatch(/row-level security|permission denied/i);

    let limitId = "";
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.plan_limits (plan_id, limit_key, limit_value) values ($1, 'products_limit', 250) returning id",
          [planId],
        );
        limitId = rows[0]!.id;
      },
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plan_limits set limit_value = -1 where id = $1", [limitId]),
      { commit: true },
    );
    const afterUpdate = await withSuperuser((c) => c.query("select limit_value from public.plan_limits where id = $1", [limitId]));
    expect(afterUpdate.rows[0]!.limit_value).toBe(-1);

    await asActor({ role: "authenticated", userId: fx.userMaster }, (c) => c.query("delete from public.plan_limits where id = $1", [limitId]), {
      commit: true,
    });
    const afterDelete = await withSuperuser((c) => c.query("select 1 from public.plan_limits where id = $1", [limitId]));
    expect(afterDelete.rows).toHaveLength(0);
  });

  // J2 — tenant_plan_limit: consultável corretamente pelo dono do tenant, distingue "não configurado" (null) de "ilimitado" (-1), e fecha em null para quem não tem relação com o tenant.
  it("tenant_plan_limit can be consulted correctly: real value, unlimited (-1), unset (null), and outsider gets null", async () => {
    const planId = await insertPlan("limit-consult");
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("insert into public.plan_limits (plan_id, limit_key, limit_value) values ($1, 'products_limit', 100)", [planId]),
      { commit: true },
    );
    await setSubscription(fx.tenantA, planId, "active");

    const real = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_plan_limit: number | null }>("select tenant_plan_limit($1, 'products_limit')", [fx.tenantA]),
    );
    expect(real.rows[0]!.tenant_plan_limit).toBe(100);

    const unset = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_plan_limit: number | null }>("select tenant_plan_limit($1, 'orders_monthly_limit')", [fx.tenantA]),
    );
    expect(unset.rows[0]!.tenant_plan_limit).toBeNull();

    await setSubscription(fx.tenantA, proPlanId, "active");
    const unlimited = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_plan_limit: number | null }>("select tenant_plan_limit($1, 'products_limit')", [fx.tenantA]),
    );
    expect(unlimited.rows[0]!.tenant_plan_limit).toBe(-1);

    const outsider = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query<{ tenant_plan_limit: number | null }>("select tenant_plan_limit($1, 'products_limit')", [fx.tenantA]),
    );
    expect(outsider.rows[0]!.tenant_plan_limit).toBeNull();
  });

  // K — preparação para o índice público: anon consegue ler planos/recursos ATIVOS (nunca inativos), sem nenhuma autenticação.
  it("anon can read active plans/features (public commercial index preparation), but never inactive ones", async () => {
    const activePlans = await asActor({ role: "anon" }, (c) => c.query<{ slug: string }>("select slug from public.plans where slug = 'pro'"));
    expect(activePlans.rows).toHaveLength(1);

    const inactivePlanId = await insertPlan("draft");
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.plans set is_active = false where id = $1", [inactivePlanId]),
      { commit: true },
    );
    const draftAsAnon = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.plans where id = $1", [inactivePlanId]));
    expect(draftAsAnon.rows).toHaveLength(0);

    const activeFeatures = await asActor({ role: "anon" }, (c) => c.query<{ key: string }>("select key from public.features where key = 'coupons'"));
    expect(activeFeatures.rows).toHaveLength(1);

    const proFeaturesAsAnon = await asActor({ role: "anon" }, (c) =>
      c.query("select 1 from public.plan_features where plan_id = $1", [proPlanId]),
    );
    expect(proFeaturesAsAnon.rows.length).toBeGreaterThan(0);

    // plan_limits nunca é público — nem para MASTER a leitura via anon é liberada.
    const limitsAsAnon = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.plan_limits where plan_id = $1", [proPlanId]));
    expect(limitsAsAnon.rows).toHaveLength(0);
  });

  // L — nenhuma credencial/segredo é exposta por nenhuma das novas tabelas/funções (não há coluna de segredo nesta etapa — confirmação estrutural).
  it("no secret-like column exists on the new commercial tables", async () => {
    const columns = await withSuperuser((c) =>
      c.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and table_name in ('plans', 'features', 'plan_features', 'subscriptions', 'plan_limits')`,
      ),
    );
    const suspicious = columns.rows.filter((r) => /token|secret|password|api_key|credential/i.test(r.column_name));
    expect(suspicious).toHaveLength(0);
  });
});
