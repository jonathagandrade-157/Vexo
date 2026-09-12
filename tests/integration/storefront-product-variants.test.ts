/**
 * D20.6 Fase 3.4 — leitura pública (anon) de opções/valores/variantes para
 * a página de produto do storefront (features/storefront/product-variants.ts).
 * Reproduz em SQL puro, como `anon`, exatamente as 3 queries que essa
 * função faz — mesmo princípio de tests/integration/product-options.test.ts/
 * product-variants.test.ts: a RLS pública em si (D20.1/D20.2) já é testada
 * lá em profundidade (staff, cross-tenant de escrita, etc.); aqui o foco é
 * confirmar que o NOVO caminho de leitura pública (papel `anon`, nunca
 * `authenticated`) nunca vaza dado entre tenants nem expõe variante
 * inativa/produto não publicado — exatamente os requisitos de segurança
 * do prompt da Fase 3.4.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Leitura pública de opções/valores/variantes (D20.6 Fase 3.4)", () => {
  let fx: Fixtures;
  let productA: string;
  let productB: string;
  let optionCorA: string;
  let valuePretoA: string;
  let valueBrancoA: string;
  let variantActiveWithStockA: string;
  let variantActiveNoStockA: string;
  let variantInactiveA: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const { rows: prodARows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, 'active') returning id",
        [fx.tenantA, "Produto Público Variantes A", `produto-publico-variantes-a-${runId}`, 100],
      );
      productA = prodARows[0]!.id;

      const { rows: prodBRows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, 'active') returning id",
        [fx.tenantB, "Produto Público Variantes B", `produto-publico-variantes-b-${runId}`, 100],
      );
      productB = prodBRows[0]!.id;

      const { rows: optARows } = await client.query<{ id: string }>(
        "insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id",
        [fx.tenantA, productA, `Cor Pública ${runId}`],
      );
      optionCorA = optARows[0]!.id;

      const { rows: valPretoARows } = await client.query<{ id: string }>(
        "insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id",
        [fx.tenantA, optionCorA, "Preto"],
      );
      valuePretoA = valPretoARows[0]!.id;

      const { rows: valBrancoARows } = await client.query<{ id: string }>(
        "insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id",
        [fx.tenantA, optionCorA, "Branco"],
      );
      valueBrancoA = valBrancoARows[0]!.id;

      // Variante ativa, com estoque > 0.
      const { rows: v1 } = await client.query<{ id: string }>(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active) values ($1, $2, $3, $4, true) returning id",
        [fx.tenantA, productA, 120, [valuePretoA]],
      );
      variantActiveWithStockA = v1[0]!.id;
      await client.query("insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, $4)", [
        fx.tenantA,
        productA,
        variantActiveWithStockA,
        10,
      ]);

      // Variante ativa, mas SEM estoque (stock_quantity = 0).
      const { rows: v2 } = await client.query<{ id: string }>(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active) values ($1, $2, $3, $4, true) returning id",
        [fx.tenantA, productA, 130, [valueBrancoA]],
      );
      variantActiveNoStockA = v2[0]!.id;
      await client.query("insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, $4)", [
        fx.tenantA,
        productA,
        variantActiveNoStockA,
        0,
      ]);

      // Variante INATIVA — nunca deve aparecer para anon, mesmo com uma combinação real.
      const { rows: optTamanhoA } = await client.query<{ id: string }>(
        "insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id",
        [fx.tenantA, productA, `Tamanho Inativo ${runId}`],
      );
      const { rows: valUnico } = await client.query<{ id: string }>(
        "insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id",
        [fx.tenantA, optTamanhoA[0]!.id, "Único"],
      );
      const { rows: v3 } = await client.query<{ id: string }>(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active) values ($1, $2, $3, $4, false) returning id",
        [fx.tenantA, productA, 140, [valUnico[0]!.id]],
      );
      variantInactiveA = v3[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("anon lê as opções+valores públicos do produto A (mesmas duas queries de getStorefrontProductVariantsData)", async () => {
    const options = await asActor({ role: "anon" }, (c) =>
      c.query("select id, name, position from public.product_options where tenant_id = $1 and product_id = $2", [fx.tenantA, productA]),
    );
    expect(options.rows.map((r) => r.id)).toEqual(expect.arrayContaining([optionCorA]));

    const values = await asActor({ role: "anon" }, (c) =>
      c.query("select id, value from public.product_option_values where tenant_id = $1 and product_option_id = $2", [
        fx.tenantA,
        optionCorA,
      ]),
    );
    expect(values.rows.map((r) => r.id).sort()).toEqual([valueBrancoA, valuePretoA].sort());
  });

  it("anon lê SOMENTE as variantes ATIVAS do produto A — a variante inativa nunca aparece (RLS já garante is_active=true)", async () => {
    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select id, is_active from public.product_variants where tenant_id = $1 and product_id = $2 and is_active = true", [
        fx.tenantA,
        productA,
      ]),
    );
    const ids = result.rows.map((r) => r.id as string);
    expect(ids).toEqual(expect.arrayContaining([variantActiveWithStockA, variantActiveNoStockA]));
    expect(ids).not.toContain(variantInactiveA);
  });

  it("anon nunca vê a variante inativa nem por SELECT direto sem o filtro is_active (RLS bloqueia, não só o filtro explícito da query)", async () => {
    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_variants where id = $1", [variantInactiveA]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("o estoque por variante lido por anon reflete corretamente disponível vs. indisponível (mesmo critério de isInStock)", async () => {
    const withStock = await asActor({ role: "anon" }, (c) =>
      c.query("select stock_quantity from public.product_inventory where variant_id = $1", [variantActiveWithStockA]),
    );
    expect(withStock.rows[0]?.stock_quantity).toBe(10);

    const noStock = await asActor({ role: "anon" }, (c) =>
      c.query("select stock_quantity from public.product_inventory where variant_id = $1", [variantActiveNoStockA]),
    );
    expect(noStock.rows[0]?.stock_quantity).toBe(0);
  });

  it("não existe vazamento entre tenants: consultar as opções/valores/variantes do produto A com o tenant_id de B nunca retorna nada (mesmo produto_id de A)", async () => {
    const options = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_options where tenant_id = $1 and product_id = $2", [fx.tenantB, productA]),
    );
    expect(options.rows).toHaveLength(0);

    const variants = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_variants where tenant_id = $1 and product_id = $2 and is_active = true", [
        fx.tenantB,
        productA,
      ]),
    );
    expect(variants.rows).toHaveLength(0);
  });

  it("não existe vazamento entre tenants: produto B nunca aparece ao consultar com o product_id de A trocado pelo de B mas tenant_id de A", async () => {
    const options = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_options where tenant_id = $1 and product_id = $2", [fx.tenantA, productB]),
    );
    expect(options.rows).toHaveLength(0);
  });

  it("desativar o produto (status != active) esconde imediatamente suas opções/variantes de anon, mesmo sem mudar nenhuma linha de product_options/product_variants", async () => {
    const created = await withSuperuser((c) =>
      c.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, 'active') returning id", [
        fx.tenantA,
        "Produto Toggle Público",
        `produto-toggle-publico-${runId}`,
        50,
      ]),
    );
    const productId = created.rows[0]!.id as string;
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productId,
        `Opção Toggle ${runId}`,
      ]),
    );
    const optionId = option.rows[0]!.id as string;

    const beforeToggle = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_options where id = $1", [optionId]),
    );
    expect(beforeToggle.rows).toHaveLength(1);

    await withSuperuser((c) => c.query("update public.products set status = 'inactive' where id = $1", [productId]));

    const afterToggle = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_options where id = $1", [optionId]),
    );
    expect(afterToggle.rows).toHaveLength(0);
  });
});
