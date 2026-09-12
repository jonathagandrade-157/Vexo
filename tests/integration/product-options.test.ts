/**
 * D20.6 Fase 3.1 — opções e valores de produto: `product_options`/
 * `product_option_values` (D20.1, migration 20260817220114). Mesmo
 * princípio de tests/integration/product-gallery.test.ts: RLS/constraints
 * testadas diretamente via SQL (asActor/withSuperuser), nunca invocando as
 * Server Actions do Next.js — as Actions de
 * features/products/variants-actions.ts fazem exatamente os mesmos
 * INSERT/UPDATE/DELETE reproduzidos abaixo (a tradução de erro em mensagem
 * amigável é testada separadamente, com o Supabase client mockado, em
 * tests/unit/product-variants-actions.test.ts; a validação pura de reorder
 * — isValidGalleryReorder — em tests/unit/product-gallery-logic.test.ts).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Opções e valores de produto (D20.6 Fase 3.1 / D20.1)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`options-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        fx.tenantA,
        userAOperator,
        fx.roleIds.OPERATOR,
      ]);

      const { rows: prodARows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, "Produto Opções A", `produto-opcoes-a-${runId}`, 10],
      );
      productA = prodARows[0]!.id;

      const { rows: prodBRows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantB, "Produto Opções B", `produto-opcoes-b-${runId}`, 10],
      );
      productB = prodBRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // ============================================================
  // product_options — RLS
  // ============================================================

  it("OWNER with products.update can insert an option for their own tenant's product", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
          fx.tenantA,
          productA,
          "Cor",
        ]),
      { commit: true },
    );
    expect(result.rows).toHaveLength(1);
  });

  it("anon cannot insert into product_options", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          "Tamanho",
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a member without products.update (OPERATOR) cannot insert an option", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          "Tamanho",
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a tenant A member cannot insert an option under tenant B's product (cross-tenant)", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [
          fx.tenantB,
          productB,
          "Cor",
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("private.prevent_cross_tenant_product_option rejects a tenant_id that doesn't match the product's real tenant, even as superuser", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [
          fx.tenantA, // tenant_id de A
          productB, // mas product_id é de B
          "Cor Cruzada",
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant/i);
  });

  it("a member of tenant B cannot read tenant A's options", async () => {
    const inserted = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Isolamento ${runId}`,
      ]),
    );
    const optionId = inserted.rows[0]?.id as string;

    const read = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.product_options where id = $1", [optionId]),
    );
    expect(read.rows).toHaveLength(0);
  });

  it("a tenant A member cannot update or delete tenant B's options (RLS via USING — 0 linhas afetadas, sem erro)", async () => {
    const inserted = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantB,
        productB,
        `Opção B Update ${runId}`,
      ]),
    );
    const optionId = inserted.rows[0]?.id as string;

    const updateResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update public.product_options set position = 5 where id = $1", [optionId]),
    );
    expect(updateResult.rowCount).toBe(0);

    const deleteResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("delete from public.product_options where id = $1", [optionId]),
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  it("inserting the same name twice (case-insensitive) for the same product is rejected (23505 — mesma constraint usada por createProductOptionAction)", async () => {
    const name = `Cor Dup ${runId}`;
    await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [fx.tenantA, productA, name]),
    );
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          name.toUpperCase(),
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  it("the same name is allowed again for a DIFFERENT product (uniqueness is per-product, not global)", async () => {
    const name = `Cor Compartilhada ${runId}`;
    await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3)", [fx.tenantA, productA, name]),
    );
    const result = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantB,
        productB,
        name,
      ]),
    );
    expect(result.rows).toHaveLength(1);
  });

  // ============================================================
  // product_option_values — mesmo padrão, um nível mais fundo
  // ============================================================

  it("OWNER with products.update can insert a value for an option of their own tenant", async () => {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Valores ${runId}`,
      ]),
    );
    const optionId = option.rows[0]?.id as string;

    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        fx.tenantA,
        optionId,
        "Preto",
      ]),
      { commit: true },
    );
    expect(result.rows).toHaveLength(1);
  });

  it("anon cannot insert into product_option_values", async () => {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Anon ${runId}`,
      ]),
    );
    const optionId = option.rows[0]?.id as string;

    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3)", [
          fx.tenantA,
          optionId,
          "Branco",
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a tenant A member cannot insert a value under tenant B's option (cross-tenant)", async () => {
    const optionB = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantB,
        productB,
        `Opção B Cross ${runId}`,
      ]),
    );
    const optionBId = optionB.rows[0]?.id as string;

    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3)", [
          fx.tenantB,
          optionBId,
          "Preto",
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("inserting the same value twice (case-insensitive) for the same option is rejected (23505)", async () => {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Dup Valor ${runId}`,
      ]),
    );
    const optionId = option.rows[0]?.id as string;
    await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3)", [
        fx.tenantA,
        optionId,
        "GG",
      ]),
    );
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3)", [
          fx.tenantA,
          optionId,
          "gg",
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  // ============================================================
  // Exclusão — cascade (option → values) e RESTRICT (value → variante em uso)
  // ============================================================

  it("deleting an option cascades to delete its values (ON DELETE CASCADE)", async () => {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Cascade ${runId}`,
      ]),
    );
    const optionId = option.rows[0]?.id as string;
    const value = await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        fx.tenantA,
        optionId,
        "Único",
      ]),
    );
    const valueId = value.rows[0]?.id as string;

    await withSuperuser((c) => c.query("delete from public.product_options where id = $1", [optionId]));

    const remaining = await withSuperuser((c) => c.query("select id from public.product_option_values where id = $1", [valueId]));
    expect(remaining.rows).toHaveLength(0);
  });

  it("deleting a value in use by a product_variant is rejected (23503 — ON DELETE RESTRICT de product_variant_options, D20.2), the same as deleteProductOptionValueAction must translate to a friendly message", async () => {
    const option = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name) values ($1, $2, $3) returning id", [
        fx.tenantA,
        productA,
        `Opção Em Uso ${runId}`,
      ]),
    );
    const optionId = option.rows[0]?.id as string;
    const value = await withSuperuser((c) =>
      c.query("insert into public.product_option_values (tenant_id, product_option_id, value) values ($1, $2, $3) returning id", [
        fx.tenantA,
        optionId,
        "M",
      ]),
    );
    const valueId = value.rows[0]?.id as string;

    // Criar a variante popula product_variant_options automaticamente via
    // trigger sync_product_variant_options (D20.2) — nunca escrito à mão.
    const variant = await withSuperuser((c) =>
      c.query(
        "insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, productA, 10, [valueId]],
      ),
    );
    const variantId = variant.rows[0]?.id as string;

    const err = await expectPgError(
      withSuperuser((c) => c.query("delete from public.product_option_values where id = $1", [valueId])),
    );
    expect(err.message).toMatch(/violates foreign key constraint/i);

    // Removida a variante que usava o valor, a exclusão do valor volta a funcionar.
    await withSuperuser((c) => c.query("delete from public.product_variants where id = $1", [variantId]));
    const result = await withSuperuser((c) => c.query("delete from public.product_option_values where id = $1", [valueId]));
    expect(result.rowCount).toBe(1);
  });

  // ============================================================
  // Reorder — o mesmo UPDATE escopado que reorderProductOptionsAction/
  // reorderProductOptionValuesAction fazem (posição = índice do array,
  // sempre escopado por tenant_id + parent id como defesa em profundidade).
  // ============================================================

  it("reordering options writes `position` scoped by tenant_id + product_id — never touches a row from another product", async () => {
    const optA1 = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, $3, 0) returning id", [
        fx.tenantA,
        productA,
        `Reorder A1 ${runId}`,
      ]),
    );
    const optA2 = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, $3, 1) returning id", [
        fx.tenantA,
        productA,
        `Reorder A2 ${runId}`,
      ]),
    );
    const optB1 = await withSuperuser((c) =>
      c.query("insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, $3, 0) returning id", [
        fx.tenantB,
        productB,
        `Reorder B1 ${runId}`,
      ]),
    );
    const idA1 = optA1.rows[0]?.id as string;
    const idA2 = optA2.rows[0]?.id as string;
    const idB1 = optB1.rows[0]?.id as string;

    // Inverte A1/A2 (mesmo par de UPDATEs que applyGalleryOrder/reorderProductOptionsAction fazem).
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      async (c) => {
        await c.query("update public.product_options set position = 0 where id = $1 and tenant_id = $2 and product_id = $3", [
          idA2,
          fx.tenantA,
          productA,
        ]);
        await c.query("update public.product_options set position = 1 where id = $1 and tenant_id = $2 and product_id = $3", [
          idA1,
          fx.tenantA,
          productA,
        ]);
      },
      { commit: true },
    );

    const after = await withSuperuser((c) =>
      c.query("select id, position from public.product_options where id in ($1, $2, $3) order by id", [idA1, idA2, idB1]),
    );
    const positions = Object.fromEntries(after.rows.map((r) => [r.id as string, r.position as number]));
    expect(positions[idA1]).toBe(1);
    expect(positions[idA2]).toBe(0);
    expect(positions[idB1]).toBe(0); // opção de outro tenant/produto nunca é tocada
  });
});
