/**
 * D20.6 Fase 3.2 — geração e gerenciamento de variantes: tabela
 * `public.product_variants`/`public.product_variant_options` (D20.2,
 * migration 20260817220115). Mesmo princípio de
 * tests/integration/product-options.test.ts: RLS/constraints testadas
 * diretamente via SQL (asActor/withSuperuser) — as Server Actions de
 * features/products/variants-actions.ts fazem exatamente os mesmos
 * INSERT/UPDATE reproduzidos abaixo (a tradução de erro em mensagem
 * amigável, o cálculo do produto cartesiano e os limites de geração são
 * testados separadamente, sem banco, em
 * tests/unit/variant-combinations.test.ts e com o Supabase client
 * mockado em tests/unit/product-variant-actions.test.ts).
 *
 * Cada teste que efetivamente PERSISTE uma linha (via `withSuperuser`, que
 * nunca faz rollback, ou via `asActor(..., { commit: true })`) cria sua
 * própria opção/valor dedicados — nunca reaproveita a combinação de outro
 * teste — para nunca colidir com `product_variants_product_combination_unique`
 * entre testes (mesmo cuidado já usado em product-options.test.ts/
 * product-gallery.test.ts). Os testes puramente negativos (RLS/validação
 * que sempre resulta em erro, nunca em linha persistida) podem reaproveitar
 * a fixture compartilhada do `beforeAll` livremente.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Variantes de produto (D20.6 Fase 3.2 / D20.2)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let productA: string;
  let productB: string;
  let optionCorA: string;
  let valuePretoA: string;
  let valueBrancoA: string;
  let optionCorB: string;
  let valuePretoB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`variants-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        fx.tenantA,
        userAOperator,
        fx.roleIds.OPERATOR,
      ]);

      const { rows: prodARows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, "Produto Variantes A", `produto-variantes-a-${runId}`, 100],
      );
      productA = prodARows[0]!.id;

      const { rows: prodBRows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantB, "Produto Variantes B", `produto-variantes-b-${runId}`, 100],
      );
      productB = prodBRows[0]!.id;

      const { rows: optARows } = await client.query<{ id: string }>(
        "insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id",
        [fx.tenantA, productA, `Cor A ${runId}`],
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

      const { rows: optBRows } = await client.query<{ id: string }>(
        "insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id",
        [fx.tenantB, productB, `Cor B ${runId}`],
      );
      optionCorB = optBRows[0]!.id;

      const { rows: valPretoBRows } = await client.query<{ id: string }>(
        "insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id",
        [fx.tenantB, optionCorB, "Preto"],
      );
      valuePretoB = valPretoBRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Cria uma opção nova com UM valor novo, dedicados a um único teste — nunca reaproveita a fixture compartilhada quando o teste vai persistir uma linha (evita colidir com product_variants_product_combination_unique entre testes). */
  async function createDedicatedOptionValue(tenantId: string, productId: string, label: string): Promise<string> {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        tenantId,
        productId,
        `${label} ${randomUUID().slice(0, 8)}`,
      ]),
    );
    const optionId = option.rows[0]!.id as string;
    const value = await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        tenantId,
        optionId,
        "V1",
      ]),
    );
    return value.rows[0]!.id as string;
  }

  // ============================================================
  // RLS / posse — nenhum destes testes deixa uma linha persistida (erro ou rollback padrão).
  // ============================================================

  it("OWNER with products.update can insert a variant for their own tenant's product, referencing a real option value", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, productA, 100, [valuePretoA]],
      ),
    ); // sem commit:true — só confirma que a policy permite, não deixa estado para outros testes
    expect(result.rows).toHaveLength(1);
  });

  it("anon cannot insert into product_variants", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valuePretoA],
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a member without products.update (OPERATOR) cannot insert a variant", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valuePretoA],
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a tenant A member cannot insert a variant under tenant B's product (cross-tenant)", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantB,
          productB,
          100,
          [valuePretoB],
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a member of tenant B cannot read tenant A's variants", async () => {
    const dedicatedValue = await createDedicatedOptionValue(fx.tenantA, productA, "Leitura Cross");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, productA, 100, [dedicatedValue]],
      ),
    );
    const variantId = inserted.rows[0]?.id as string;

    const read = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.product_variants where id = $1", [variantId]),
    );
    expect(read.rows).toHaveLength(0);
  });

  it("a tenant A member cannot update tenant B's variant (RLS via USING — 0 linhas afetadas, sem erro)", async () => {
    const dedicatedValue = await createDedicatedOptionValue(fx.tenantB, productB, "Update Cross");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantB, productB, 50, [dedicatedValue]],
      ),
    );
    const variantId = inserted.rows[0]?.id as string;

    const updateResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update public.product_variants set price = 999 where id = $1", [variantId]),
    );
    expect(updateResult.rowCount).toBe(0);
  });

  // ============================================================
  // Validação da combinação (private.validate_product_variant_option_values,
  // D20.2) — a mesma barreira que garante que o app nunca pode gravar
  // option_value_ids com um valor de outra opção/outro produto/outro
  // tenant, mesmo bypassando a Server Action. Todos negativos, nada persiste.
  // ============================================================

  it("rejects option_value_ids referencing a value that belongs to ANOTHER product (cross-product contamination)", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valuePretoB], // valor pertence ao produto/tenant B, não a productA
        ]),
      ),
    );
    expect(err.message).toMatch(/does not exist, or does not belong to the same product\/tenant/i);
  });

  it("rejects option_value_ids referencing a value id that doesn't exist at all", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [randomUUID()],
        ]),
      ),
    );
    expect(err.message).toMatch(/does not exist, or does not belong to the same product\/tenant/i);
  });

  it("rejects option_value_ids with two values from the same product_option (duplicate axis in one combination)", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valuePretoA, valueBrancoA], // ambos são valores da MESMA opção "Cor"
        ]),
      ),
    );
    expect(err.message).toMatch(/cannot contain two values from the same product_option/i);
  });

  it("rejects an empty option_value_ids array (combinação incompleta)", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [],
        ]),
      ),
    );
    expect(err.message).toMatch(/violates check constraint/i);
  });

  it("rejects more than 3 values in option_value_ids, even when all 4 are real values of 4 distinct options of the same product (arquitetura D20 §N, enforced por CHECK)", async () => {
    const v1 = await createDedicatedOptionValue(fx.tenantA, productA, "Limite Opt 1");
    const v2 = await createDedicatedOptionValue(fx.tenantA, productA, "Limite Opt 2");
    const v3 = await createDedicatedOptionValue(fx.tenantA, productA, "Limite Opt 3");
    const v4 = await createDedicatedOptionValue(fx.tenantA, productA, "Limite Opt 4");

    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [v1, v2, v3, v4],
        ]),
      ),
    );
    expect(err.message).toMatch(/violates check constraint/i);
  });

  // ============================================================
  // Duplicidade / corrida — cada teste usa sua própria combinação dedicada.
  // ============================================================

  it("inserting the same combination twice for the same product is rejected (23505 — mesma constraint que a Action trata como 'já existe, pular')", async () => {
    const dedicatedValue = await createDedicatedOptionValue(fx.tenantA, productA, "Combo Dup");
    await withSuperuser((c) =>
      c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
        fx.tenantA,
        productA,
        100,
        [dedicatedValue],
      ]),
    );
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          150, // preço diferente não importa — a combinação é a mesma
          [dedicatedValue],
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  it("duplicate SKU within the same tenant is rejected (23505 — product_variants_tenant_sku_unique), even for two DIFFERENT combinations", async () => {
    const valueOne = await createDedicatedOptionValue(fx.tenantA, productA, "SKU Dup 1");
    const valueTwo = await createDedicatedOptionValue(fx.tenantA, productA, "SKU Dup 2");
    const sku = `CAM-DUP-${runId}`;
    await withSuperuser((c) =>
      c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids, sku) values ($1, $2, $3, $4, $5)", [
        fx.tenantA,
        productA,
        100,
        [valueOne],
        sku,
      ]),
    );
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query(
          "insert into public.product_variants (tenant_id, product_id, price, option_value_ids, sku) values ($1, $2, $3, $4, $5)",
          [fx.tenantA, productA, 100, [valueTwo], sku],
        ),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  it("the same SKU is allowed again for a DIFFERENT tenant (uniqueness is per-tenant, not global)", async () => {
    const valueA = await createDedicatedOptionValue(fx.tenantA, productA, "SKU Shared A");
    const valueB = await createDedicatedOptionValue(fx.tenantB, productB, "SKU Shared B");
    const sku = `CAM-SHARED-${runId}`;
    await withSuperuser((c) =>
      c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids, sku) values ($1, $2, $3, $4, $5)", [
        fx.tenantA,
        productA,
        100,
        [valueA],
        sku,
      ]),
    );
    const result = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids, sku) values ($1, $2, $3, $4, $5) returning id",
        [fx.tenantB, productB, 100, [valueB], sku],
      ),
    );
    expect(result.rows).toHaveLength(1);
  });

  // ============================================================
  // Sincronização derivada (product_variant_options) e desativação.
  // ============================================================

  it("creating a variant automatically populates product_variant_options via sync_product_variant_options (never written directly)", async () => {
    const dedicatedValue = await createDedicatedOptionValue(fx.tenantA, productA, "Sync Check");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, productA, 100, [dedicatedValue]],
      ),
    );
    const variantId = inserted.rows[0]?.id as string;

    const options = await withSuperuser((c) =>
      c.query("select product_option_value_id from public.product_variant_options where variant_id = $1", [variantId]),
    );
    expect(options.rows.map((r) => r.product_option_value_id)).toEqual([dedicatedValue]);
  });

  it("deactivating a variant (is_active = false) never removes its product_variant_options / never deletes the row", async () => {
    const dedicatedValue = await createDedicatedOptionValue(fx.tenantA, productA, "Deactivate Check");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, productA, 100, [dedicatedValue]],
      ),
    );
    const variantId = inserted.rows[0]?.id as string;

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.product_variants set is_active = false where id = $1", [variantId]),
      { commit: true },
    );

    const after = await withSuperuser((c) => c.query("select is_active from public.product_variants where id = $1", [variantId]));
    expect(after.rows[0]?.is_active).toBe(false);
    const options = await withSuperuser((c) =>
      c.query("select 1 from public.product_variant_options where variant_id = $1", [variantId]),
    );
    expect(options.rows).toHaveLength(1); // nunca removido por uma simples desativação
  });

  // ============================================================
  // Geração end-to-end (o mesmo fluxo de generateProductVariantsAction,
  // reproduzido em SQL puro): opções+valores reais → produto cartesiano →
  // diff contra o que já existe → só cria o que falta.
  // ============================================================

  it("generating combinations for a product with 2 values in one option creates exactly 2 variants, and running it again creates none new", async () => {
    const { rows: optRows } = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Tamanho E2E ${runId}`,
      ]),
    );
    const optionId = optRows[0]!.id as string;
    const { rows: valPRows } = await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        fx.tenantA,
        optionId,
        "P",
      ]),
    );
    const { rows: valMRows } = await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        fx.tenantA,
        optionId,
        "M",
      ]),
    );
    const valueP = valPRows[0]!.id as string;
    const valueM = valMRows[0]!.id as string;

    // 1ª "geração": nenhuma variante existe ainda para esta combinação → cria as 2.
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      async (c) => {
        await c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valueP],
        ]);
        await c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valueM],
        ]);
      },
      { commit: true },
    );

    const afterFirst = await withSuperuser((c) =>
      c.query(
        "select option_value_ids from public.product_variants where product_id = $1 and option_value_ids && array[$2, $3]::uuid[]",
        [productA, valueP, valueM],
      ),
    );
    expect(afterFirst.rows).toHaveLength(2);

    // "geração repetida": inserir de novo a MESMA combinação é bloqueado
    // pela constraint — exatamente o que diffVariantCombinations() evita
    // tentar fazer, e o que a Action trata como 23505/skip quando ainda
    // assim acontece (corrida entre dois cliques simultâneos).
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4)", [
          fx.tenantA,
          productA,
          100,
          [valueP],
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });
});
