/**
 * Etapa 16 — enforcement real de planos/limites. Complementa
 * commercial-foundation.test.ts (Etapa 14, que testa a fundação — CRUD de
 * plans/features/plan_features, RLS de subscriptions/plan_limits): aqui o
 * foco é a aplicação de verdade, no servidor, de feature gating e limites
 * numéricos sobre produtos/categorias (prompt Etapa 16 §19).
 *
 * Mesmo padrão de todo o projeto: RLS/trigger/RPC testados diretamente via
 * SQL (asActor/withSuperuser), nunca chamando a Server Action do Next.js —
 * é exatamente essa camada (SQL puro, sem passar pela UI) que precisa
 * ficar bloqueada por si só, para provar que uma chamada direta não
 * consegue burlar limite/feature (prompt §19: "chamada direta à Server
 * Action não consegue burlar o limite").
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Enforcement de planos e limites (Etapa 16)", () => {
  let fx: Fixtures;
  let basicPlanId: string;
  let intermediatePlanId: string;
  let proPlanId: string;

  let tenantBasic: string;
  let tenantIntermediate: string;
  let tenantPro: string;
  let userBasicOwner: string;
  let userIntermediateOwner: string;
  let userProOwner: string;

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

  async function setSubscription(tenantId: string, planId: string): Promise<void> {
    await withSuperuser((c) =>
      c.query(
        `insert into public.subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')
         on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = excluded.status`,
        [tenantId, planId],
      ),
    );
  }

  /** Insere N produtos de uma vez (generate_series), na MESMA transação/statement — o trigger de limite roda uma vez por linha, sequencialmente, então isto continua testando o enforcement de verdade, só sem N round-trips do test runner. */
  async function bulkInsertProducts(tenantId: string, count: number, offset = 0): Promise<void> {
    await withSuperuser((c) =>
      c.query(
        `insert into public.products (tenant_id, name, slug, price)
         select $1, 'Produto ' || gs, 'produto-' || gs || '-' || $2 || '-' || $3, 10
         from generate_series($4::int, $4::int + $5::int - 1) as gs`,
        [tenantId, runId, randomUUID().slice(0, 6), offset + 1, count],
      ),
    );
  }

  async function bulkInsertCategories(tenantId: string, count: number, offset = 0): Promise<void> {
    await withSuperuser((c) =>
      c.query(
        `insert into public.categories (tenant_id, name, slug)
         select $1, 'Categoria ' || gs, 'categoria-' || gs || '-' || $2 || '-' || $3
         from generate_series($4::int, $4::int + $5::int - 1) as gs`,
        [tenantId, runId, randomUUID().slice(0, 6), offset + 1, count],
      ),
    );
  }

  async function insertOneProduct(tenantId: string, label: string): Promise<void> {
    await withSuperuser((c) =>
      c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, 10)", [
        tenantId,
        `Produto ${label}`,
        `produto-${label}-${runId}`,
      ]),
    );
  }

  async function insertOneCategory(tenantId: string, label: string): Promise<void> {
    await withSuperuser((c) =>
      c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3)", [
        tenantId,
        `Categoria ${label}`,
        `categoria-${label}-${runId}`,
      ]),
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    const { rows: planRows } = await withSuperuser((c) =>
      c.query<{ id: string; slug: string }>("select id, slug from public.plans where slug in ('basic', 'intermediate', 'pro')"),
    );
    basicPlanId = planRows.find((p) => p.slug === "basic")!.id;
    intermediatePlanId = planRows.find((p) => p.slug === "intermediate")!.id;
    proPlanId = planRows.find((p) => p.slug === "pro")!.id;

    const basic = await createOwnedTenant("basic");
    tenantBasic = basic.tenantId;
    userBasicOwner = basic.userId;
    await setSubscription(tenantBasic, basicPlanId);

    const intermediate = await createOwnedTenant("intermediate");
    tenantIntermediate = intermediate.tenantId;
    userIntermediateOwner = intermediate.userId;
    await setSubscription(tenantIntermediate, intermediatePlanId);

    const pro = await createOwnedTenant("pro");
    tenantPro = pro.tenantId;
    userProOwner = pro.userId;
    await setSubscription(tenantPro, proPlanId);
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Feature gating -------------------------------------------------

  it("feature liberada pelo plano → tenant_has_feature retorna true", async () => {
    // 'shipping' está incluído a partir do INTERMEDIATE (seed Etapa 14).
    const result = await asActor({ role: "authenticated", userId: userIntermediateOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantIntermediate]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(true);
  });

  it("feature não incluída no plano → tenant_has_feature retorna false (acesso negado)", async () => {
    // 'shipping' NÃO está no BASIC.
    const result = await asActor({ role: "authenticated", userId: userBasicOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantBasic]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
  });

  it("usuário sem permissão não consegue burlar feature mesmo com plano incluindo o recurso", async () => {
    // fx.userOutsider não é membro de tenantIntermediate — is_tenant_member
    // falha primeiro, antes mesmo de chegar na checagem de feature.
    const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantIntermediate]),
    );
    expect(result.rows[0]!.tenant_has_feature).toBe(false);
  });

  // --- Limite de produtos ----------------------------------------------

  it("BASIC: até 50 produtos é permitido", async () => {
    await bulkInsertProducts(tenantBasic, 50);
    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.products where tenant_id = $1", [tenantBasic]),
    );
    expect(Number(count.rows[0]!.count)).toBe(50);
  });

  it("BASIC: o 51º produto é negado pelo servidor (VX011)", async () => {
    const err = await expectPgError(insertOneProduct(tenantBasic, "51"));
    expect((err as unknown as { code?: string }).code).toBe("VX011");

    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.products where tenant_id = $1", [tenantBasic]),
    );
    expect(Number(count.rows[0]!.count)).toBe(50);
  });

  it("INTERMEDIATE: até 500 produtos é permitido", async () => {
    await bulkInsertProducts(tenantIntermediate, 500);
    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.products where tenant_id = $1", [tenantIntermediate]),
    );
    expect(Number(count.rows[0]!.count)).toBe(500);
  }, 30000);

  it("INTERMEDIATE: o 501º produto é negado pelo servidor (VX011)", async () => {
    const err = await expectPgError(insertOneProduct(tenantIntermediate, "501"));
    expect((err as unknown as { code?: string }).code).toBe("VX011");
  });

  it("PRO: produtos são ilimitados (mais de 500 é permitido)", async () => {
    await bulkInsertProducts(tenantPro, 501);
    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.products where tenant_id = $1", [tenantPro]),
    );
    expect(Number(count.rows[0]!.count)).toBe(501);
  }, 30000);

  // --- Limite de categorias --------------------------------------------

  it("BASIC: até 10 categorias é permitido, a 11ª é negada", async () => {
    await bulkInsertCategories(tenantBasic, 10);
    const err = await expectPgError(insertOneCategory(tenantBasic, "11"));
    expect((err as unknown as { code?: string }).code).toBe("VX011");

    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.categories where tenant_id = $1", [tenantBasic]),
    );
    expect(Number(count.rows[0]!.count)).toBe(10);
  });

  it("INTERMEDIATE: até 50 categorias é permitido, a 51ª é negada", async () => {
    await bulkInsertCategories(tenantIntermediate, 50);
    const err = await expectPgError(insertOneCategory(tenantIntermediate, "51"));
    expect((err as unknown as { code?: string }).code).toBe("VX011");
  });

  it("PRO: categorias são ilimitadas (mais de 50 é permitido)", async () => {
    await bulkInsertCategories(tenantPro, 51);
    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.categories where tenant_id = $1", [tenantPro]),
    );
    expect(Number(count.rows[0]!.count)).toBe(51);
  });

  // --- Isolamento entre tenants -----------------------------------------

  it("o limite/uso de um tenant nunca é afetado pelo de outro tenant", async () => {
    // tenantBasic já está no teto (50/50) e tenantIntermediate também já
    // está no teto de categorias (50/50) desde os testes acima — usar um
    // tenant dedicado, recém-criado no INTERMEDIATE e ainda sem nenhuma
    // categoria, prova isolamento de verdade: o teto alheio saturado não
    // impede este de inserir a sua primeira.
    const isolated = await createOwnedTenant("isolamento");
    await setSubscription(isolated.tenantId, intermediatePlanId);

    await insertOneCategory(isolated.tenantId, "isolamento");
    const isolatedCount = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.categories where tenant_id = $1", [isolated.tenantId]),
    );
    expect(Number(isolatedCount.rows[0]!.count)).toBe(1);

    const basicLimit = await asActor({ role: "authenticated", userId: userBasicOwner }, (c) =>
      c.query<{ tenant_plan_limit: number }>("select public.tenant_plan_limit($1, 'categories_limit')", [tenantBasic]),
    );
    expect(basicLimit.rows[0]!.tenant_plan_limit).toBe(10);
  });

  // --- Concorrência -------------------------------------------------------

  it("tentativas simultâneas de criação não ultrapassam o limite", async () => {
    // Tenant dedicado no BASIC, já com 49/50 categorias — 5 requisições
    // concorrentes disputam a última vaga; exatamente 1 deve ganhar.
    const concurrent = await createOwnedTenant("concurrency");
    await setSubscription(concurrent.tenantId, basicPlanId);
    await bulkInsertCategories(concurrent.tenantId, 9); // 9/10

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        asActor(
          { role: "authenticated", userId: concurrent.userId },
          (c) =>
            c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3)", [
              concurrent.tenantId,
              `Categoria concorrente ${i}`,
              `categoria-concorrente-${i}-${runId}`,
            ]),
          { commit: true },
        ),
      ),
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(4);

    const finalCount = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.categories where tenant_id = $1", [concurrent.tenantId]),
    );
    expect(Number(finalCount.rows[0]!.count)).toBe(10); // nunca 11
  });

  // --- MASTER controla features/limites em tempo real ---------------------

  it("MASTER remove uma feature do plano → tenant perde acesso imediatamente", async () => {
    const { rows: featureRows } = await withSuperuser((c) =>
      c.query<{ id: string }>("select id from public.features where key = 'shipping'"),
    );
    const shippingFeatureId = featureRows[0]!.id;

    const before = await asActor({ role: "authenticated", userId: userIntermediateOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantIntermediate]),
    );
    expect(before.rows[0]!.tenant_has_feature).toBe(true);

    await withSuperuser((c) =>
      c.query("delete from public.plan_features where plan_id = $1 and feature_id = $2", [intermediatePlanId, shippingFeatureId]),
    );

    const after = await asActor({ role: "authenticated", userId: userIntermediateOwner }, (c) =>
      c.query<{ tenant_has_feature: boolean }>("select public.tenant_has_feature($1, 'shipping')", [tenantIntermediate]),
    );
    expect(after.rows[0]!.tenant_has_feature).toBe(false);

    // Restaura para não afetar a ordem de outros testes deste arquivo.
    await withSuperuser((c) =>
      c.query("insert into public.plan_features (plan_id, feature_id) values ($1, $2)", [intermediatePlanId, shippingFeatureId]),
    );
  });

  it("MASTER aumenta um limite → tenant passa a poder criar mais imediatamente", async () => {
    const raised = await createOwnedTenant("raised-limit");
    await setSubscription(raised.tenantId, basicPlanId);
    await bulkInsertCategories(raised.tenantId, 10); // no teto do BASIC (10)

    const deniedBefore = await expectPgError(insertOneCategory(raised.tenantId, "antes-do-aumento"));
    expect((deniedBefore as unknown as { code?: string }).code).toBe("VX011");

    await withSuperuser((c) =>
      c.query("update public.plan_limits set limit_value = 11 where plan_id = $1 and limit_key = 'categories_limit'", [basicPlanId]),
    );

    await insertOneCategory(raised.tenantId, "depois-do-aumento");
    const count = await withSuperuser((c) =>
      c.query<{ count: string }>("select count(*) from public.categories where tenant_id = $1", [raised.tenantId]),
    );
    expect(Number(count.rows[0]!.count)).toBe(11);

    // Restaura o valor original (10) para não afetar os testes anteriores
    // deste arquivo caso a suíte seja re-executada / rode em outra ordem.
    await withSuperuser((c) =>
      c.query("update public.plan_limits set limit_value = 10 where plan_id = $1 and limit_key = 'categories_limit'", [basicPlanId]),
    );
  });
});
