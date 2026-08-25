/**
 * Etapa 20.2.6 — RPCs `set_billing_gateway_identifiers`/`create_billing_invoice`
 * (migration 20260817220073). Mesmo padrão de toda a suíte: RLS/RPC
 * testados diretamente via SQL (asActor/withSuperuser), nunca através da
 * Server Action/orquestração TypeScript (fora do alcance deste harness).
 *
 * Escopo: só o que estas duas RPCs fazem — nunca ativam assinatura, nunca
 * convertem trial, nunca marcam invoice como PAID (nem têm parâmetro para
 * isso), nunca tocam tenant_id/plan_id/status/billing_cycle/trial/período.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Billing — início da 1ª assinatura (Etapa 20.2.6)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;
  let basicPlanId: string;
  let proPlanId: string;
  let subscriptionA: string;
  let subscriptionB: string;

  async function insertSubscription(tenantId: string, planId: string): Promise<string> {
    return withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.subscriptions (tenant_id, plan_id, status) values ($1, $2, 'trialing')
         on conflict (tenant_id) do update set plan_id = excluded.plan_id
         returning id`,
        [tenantId, planId],
      );
      return rows[0]!.id;
    });
  }

  function setIdentifiers(
    userId: string,
    tenantId: string,
    args: { gateway?: string; customerId?: string; subscriptionId?: string | null; paymentMethod?: string },
    commit = true,
  ) {
    return asActor(
      { role: "authenticated", userId },
      (c) =>
        c.query("select set_billing_gateway_identifiers($1, $2, $3, $4, $5)", [
          tenantId,
          args.gateway ?? "asaas",
          args.customerId ?? "cus_test",
          args.subscriptionId ?? "sub_test",
          args.paymentMethod ?? "pix",
        ]),
      { commit },
    );
  }

  function createInvoice(
    userId: string,
    tenantId: string,
    args: { planId: string; gatewayInvoiceId?: string | null; amount?: number; cycle?: string; paymentMethod?: string },
    commit = true,
  ) {
    const periodStart = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const dueAt = periodStart;
    return asActor(
      { role: "authenticated", userId },
      (c) =>
        c.query<{
          id: string;
          tenant_id: string;
          subscription_id: string;
          gateway: string;
          gateway_invoice_id: string | null;
          plan_id: string;
          plan_name_snapshot: string;
          amount: string;
          billing_cycle: string;
          status: string;
          payment_method: string;
        }>(
          `select * from create_billing_invoice($1, 'asaas', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tenantId,
            args.gatewayInvoiceId ?? null,
            args.planId,
            args.amount ?? 49.9,
            args.cycle ?? "monthly",
            args.paymentMethod ?? "pix",
            periodStart,
            periodEnd,
            dueAt,
          ],
        ),
      { commit },
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-billing-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);
    });

    const { rows: planRows } = await withSuperuser((c) =>
      c.query<{ id: string; slug: string }>("select id, slug from public.plans where slug in ('basic', 'pro')"),
    );
    basicPlanId = planRows.find((p) => p.slug === "basic")!.id;
    proPlanId = planRows.find((p) => p.slug === "pro")!.id;

    subscriptionA = await insertSubscription(fx.tenantA, basicPlanId);
    subscriptionB = await insertSubscription(fx.tenantB, basicPlanId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("1) OWNER consegue executar o fluxo no próprio tenant", async () => {
    await setIdentifiers(fx.userAOwner, fx.tenantA, { customerId: "cus_owner_ok", subscriptionId: "sub_owner_ok" });
    const result = await createInvoice(fx.userAOwner, fx.tenantA, { planId: basicPlanId });
    expect(result.rows[0]).toMatchObject({ tenant_id: fx.tenantA, status: "PENDING" });
  });

  it("2) OWNER não consegue executar set_billing_gateway_identifiers em tenant de outro usuário", async () => {
    const err = await expectPgError(setIdentifiers(fx.userAOwner, fx.tenantB, {}, false));
    expect(err.message).toMatch(/not a member of this tenant/i);
  });

  it("3) usuário sem billing.manage (MANAGER) é bloqueado nas duas RPCs", async () => {
    const err1 = await expectPgError(setIdentifiers(fx.userAManager, fx.tenantA, {}, false));
    expect(err1.message).toMatch(/missing billing\.manage permission/i);

    const err2 = await expectPgError(createInvoice(fx.userAManager, fx.tenantA, { planId: basicPlanId }, false));
    expect(err2.message).toMatch(/missing billing\.manage permission/i);
  });

  it("4) SUPPORT_AGENT é bloqueado para escrita (não é membro do tenant)", async () => {
    const err = await expectPgError(setIdentifiers(userSupportAgent, fx.tenantA, {}, false));
    expect(err.message).toMatch(/not a member of this tenant/i);
  });

  it("5) MASTER não recebe acesso indevido — mesmo padrão de autorização (tenant-scoped, sem bypass)", async () => {
    const err = await expectPgError(setIdentifiers(fx.userMaster, fx.tenantA, {}, false));
    expect(err.message).toMatch(/not a member of this tenant/i);
  });

  it("6/7/8/9) set_billing_gateway_identifiers altera SOMENTE os 4 campos permitidos — plan_id/status/trial intocados", async () => {
    const before = await withSuperuser((c) =>
      c.query(
        "select tenant_id, plan_id, status, billing_cycle, trial_start, trial_end, current_period_start, current_period_end, cancelled_at from public.subscriptions where id = $1",
        [subscriptionA],
      ),
    );

    await setIdentifiers(fx.userAOwner, fx.tenantA, {
      gateway: "asaas",
      customerId: "cus_snapshot_check",
      subscriptionId: "sub_snapshot_check",
      paymentMethod: "card",
    });

    const after = await withSuperuser((c) =>
      c.query(
        "select tenant_id, plan_id, status, billing_cycle, trial_start, trial_end, current_period_start, current_period_end, cancelled_at, gateway, gateway_customer_id, gateway_subscription_id, payment_method from public.subscriptions where id = $1",
        [subscriptionA],
      ),
    );

    expect(after.rows[0]).toMatchObject(before.rows[0]!);
    expect(after.rows[0]).toMatchObject({
      gateway: "asaas",
      gateway_customer_id: "cus_snapshot_check",
      gateway_subscription_id: "sub_snapshot_check",
      payment_method: "card",
    });
  });

  it("10/11/12) create_billing_invoice cria PENDING, plan_name_snapshot vem do banco, amount é preservado", async () => {
    const { rows: planRows } = await withSuperuser((c) => c.query<{ name: string }>("select name from public.plans where id = $1", [proPlanId]));
    const result = await createInvoice(fx.userAOwner, fx.tenantA, { planId: proPlanId, amount: 199.9 });
    expect(result.rows[0]).toMatchObject({
      status: "PENDING",
      plan_name_snapshot: planRows[0]!.name,
      amount: "199.90",
    });
  });

  it("13) tenant A não consegue criar invoice para tenant B", async () => {
    const err = await expectPgError(createInvoice(fx.userAOwner, fx.tenantB, { planId: basicPlanId }, false));
    expect(err.message).toMatch(/not a member of this tenant/i);
  });

  it("14) invoice não pode ser criada sem uma subscription para o tenant", async () => {
    const noSubTenant = await withSuperuser(async (c) => {
      const slug = `loja-sem-sub-${runId}`;
      const { rows } = await c.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [`Loja ${slug}`, slug, fx.userAOwner],
      );
      const tenantId = rows[0]!.id;
      await c.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        tenantId,
        fx.userAOwner,
        fx.roleIds.OWNER,
      ]);
      return tenantId;
    });

    const err = await expectPgError(createInvoice(fx.userAOwner, noSubTenant, { planId: basicPlanId }, false));
    expect(err.message).toMatch(/no subscription row for this tenant/i);
  });

  it("15) respeita UNIQUE(gateway, gateway_invoice_id) — duas invoices com o mesmo gateway_invoice_id colidem", async () => {
    const sharedGatewayInvoiceId = `inv-shared-${runId}`;
    await createInvoice(fx.userAOwner, fx.tenantA, { planId: basicPlanId, gatewayInvoiceId: sharedGatewayInvoiceId });

    const err = await expectPgError(
      createInvoice(fx.userBOwner, fx.tenantB, { planId: basicPlanId, gatewayInvoiceId: sharedGatewayInvoiceId }, false),
    );
    expect((err as unknown as { code?: string }).code).toBe("23505");
  });

  it("16/17/18/19) nenhuma alteração em trial_records, tenant_access_status, tenant_has_feature, tenant_plan_limit", async () => {
    const trialBefore = await withSuperuser((c) => c.query("select * from public.trial_records where tenant_id = $1", [fx.tenantA]));
    const statusBefore = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select public.tenant_access_status($1)", [fx.tenantA]),
    );
    const featureBefore = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [fx.tenantA]),
    );
    const limitBefore = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_plan_limit: number }>("select public.tenant_plan_limit($1, 'products_limit')", [fx.tenantA]),
    );

    await setIdentifiers(fx.userAOwner, fx.tenantA, { customerId: "cus_side_effect_check", subscriptionId: "sub_side_effect_check" });
    await createInvoice(fx.userAOwner, fx.tenantA, { planId: basicPlanId });

    const trialAfter = await withSuperuser((c) => c.query("select * from public.trial_records where tenant_id = $1", [fx.tenantA]));
    const statusAfter = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_access_status: string }>("select public.tenant_access_status($1)", [fx.tenantA]),
    );
    const featureAfter = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [fx.tenantA]),
    );
    const limitAfter = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query<{ tenant_plan_limit: number }>("select public.tenant_plan_limit($1, 'products_limit')", [fx.tenantA]),
    );

    expect(trialAfter.rows).toEqual(trialBefore.rows);
    expect(statusAfter.rows[0]!.tenant_access_status).toBe(statusBefore.rows[0]!.tenant_access_status);
    expect(featureAfter.rows[0]!.tenant_has_feature).toBe(featureBefore.rows[0]!.tenant_has_feature);
    expect(limitAfter.rows[0]!.tenant_plan_limit).toBe(limitBefore.rows[0]!.tenant_plan_limit);
  });

  it("nem service_role nem anon têm EXECUTE nas duas RPCs (chamada exclusivamente por authenticated)", async () => {
    for (const actor of [{ role: "anon" as const }, { role: "service_role" as const }]) {
      const err1 = await expectPgError(
        asActor(actor, (c) => c.query("select set_billing_gateway_identifiers($1, 'asaas', 'cus', 'sub', 'pix')", [fx.tenantA])),
      );
      expect(err1.message).toMatch(/permission denied for function/i);

      const err2 = await expectPgError(
        asActor(actor, (c) =>
          c.query("select * from create_billing_invoice($1, 'asaas', null, $2, 10, 'monthly', 'pix', now(), now(), now())", [fx.tenantA, basicPlanId]),
        ),
      );
      expect(err2.message).toMatch(/permission denied for function/i);
    }
  });
});
