/**
 * Etapa 9 — carrinho (prompt Etapa 9 §17). RLS/trigger/RPC testados
 * diretamente via SQL (asActor com role "anon" — o carrinho é sempre
 * anônimo nesta etapa), mesmo padrão de sempre.
 *
 * Nota sobre o modelo de segurança (documentada também no relatório
 * final): a RLS de `carts`/`cart_items` não é "por dono de linha" (não
 * há identidade de sessão para um visitante anônimo checar contra) — ela
 * garante só que o tenant referenciado é um tenant publicado de
 * verdade. A posse real do carrinho é o cookie httpOnly + o `cart_id`
 * ser um UUID não adivinhável (mesmo modelo de um token de sessão). O
 * que os testes abaixo garantem na camada de banco é: (a) um
 * cart_item nunca pode misturar tenant/produto/carrinho de tenants
 * diferentes (trigger prevent_cross_tenant_cart_item), e (b) preço nunca
 * é armazenado no carrinho (não há coluna para manipular).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Carrinho (Etapa 9)", () => {
  let fx: Fixtures;
  let productA: string;
  let productA2: string;
  let inactiveProductA: string;
  let productB: string;

  // D20.4 — fixtures de produto com variante.
  let productWithVariantsA: string; // tenant A, 2 variantes ativas + 1 inativa
  let variantActiveA: string;
  let variantActiveA2: string;
  let variantInactiveA: string;
  let otherProductWithVariantA: string; // tenant A, produto DIFERENTE, sua própria variante
  let otherProductOwnVariant: string;
  let productWithVariantB: string; // tenant B, para teste cross-tenant
  let variantB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      // Etapa 16: os produtos abaixo são criados fora do enforcement de
      // plano (não é isso que este arquivo testa) — plano PRO evita que o
      // trigger de limite bloqueie os inserts de fixture.
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const insertProduct = async (tenantId: string, name: string, price: number, status = "active") => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, $5) returning id`,
          [tenantId, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`, price, status],
        );
        return rows[0]!.id;
      };

      productA = await insertProduct(fx.tenantA, "Produto A1", 50);
      productA2 = await insertProduct(fx.tenantA, "Produto A2", 30);
      inactiveProductA = await insertProduct(fx.tenantA, "Produto A Inativo", 20, "inactive");
      productB = await insertProduct(fx.tenantB, "Produto B1", 40);

      // D20.4 — produto A com 2 opções de valor (Preto/Branco/Azul), 2
      // variantes ativas + 1 inativa.
      productWithVariantsA = await insertProduct(fx.tenantA, "Camiseta Variantes A", 49.9);
      const { rows: optRows } = await client.query<{ id: string }>(
        `insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id`,
        [fx.tenantA, productWithVariantsA],
      );
      const optionId = optRows[0]!.id;
      const { rows: valRows } = await client.query<{ id: string }>(
        `insert into public.product_option_values (tenant_id, product_option_id, value, position)
         values ($1, $2, 'Preto', 0), ($1, $2, 'Branco', 1), ($1, $2, 'Azul', 2)
         returning id`,
        [fx.tenantA, optionId],
      );
      const [blackId, whiteId, blueId] = valRows.map((r) => r.id) as [string, string, string];
      const { rows: variantRows } = await client.query<{ id: string }>(
        `insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active)
         values
           ($1, $2, 49.9, array[$3]::uuid[], true),
           ($1, $2, 55.9, array[$4]::uuid[], true),
           ($1, $2, 49.9, array[$5]::uuid[], false)
         returning id`,
        [fx.tenantA, productWithVariantsA, blackId, whiteId, blueId],
      );
      [variantActiveA, variantActiveA2, variantInactiveA] = variantRows.map((r) => r.id) as [string, string, string];

      // D20.4 — segundo produto do tenant A, com sua PRÓPRIA variante
      // (para o teste "variante de outro produto").
      otherProductWithVariantA = await insertProduct(fx.tenantA, "Tenis Variantes A", 99.9);
      const { rows: opt2 } = await client.query<{ id: string }>(
        `insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id`,
        [fx.tenantA, otherProductWithVariantA],
      );
      const { rows: val2 } = await client.query<{ id: string }>(
        `insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, 'Preto', 0) returning id`,
        [fx.tenantA, opt2[0]!.id],
      );
      const { rows: variant2 } = await client.query<{ id: string }>(
        `insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, 99.9, array[$3]::uuid[]) returning id`,
        [fx.tenantA, otherProductWithVariantA, val2[0]!.id],
      );
      otherProductOwnVariant = variant2[0]!.id;

      // D20.4 — produto do tenant B, com sua própria variante (teste cross-tenant).
      productWithVariantB = await insertProduct(fx.tenantB, "Produto Variantes B", 40);
      const { rows: optB } = await client.query<{ id: string }>(
        `insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id`,
        [fx.tenantB, productWithVariantB],
      );
      const { rows: valB } = await client.query<{ id: string }>(
        `insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, 'Preto', 0) returning id`,
        [fx.tenantB, optB[0]!.id],
      );
      const { rows: variantBRows } = await client.query<{ id: string }>(
        `insert into public.product_variants (tenant_id, product_id, price, option_value_ids) values ($1, $2, 40, array[$3]::uuid[]) returning id`,
        [fx.tenantB, productWithVariantB, valB[0]!.id],
      );
      variantB = variantBRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createCart(tenantId: string): Promise<string> {
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, tenantId]), {
      commit: true,
    });
    return cartId;
  }

  // 1 — adicionar produto válido.
  it("anon can add a valid, active, same-tenant product to a cart", async () => {
    const cartId = await createCart(fx.tenantA);
    const result = await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4) returning id", [
        cartId, fx.tenantA, productA, 2,
      ]),
    );
    expect(result.rows).toHaveLength(1);
  });

  // 2 — adicionar produto inexistente.
  it("rejects a product_id that doesn't exist", async () => {
    const cartId = await createCart(fx.tenantA);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId, fx.tenantA, randomUUID(), 1,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant/i);
  });

  // 3/13/19 — adicionar produto de outro tenant (isolamento real entre tenants).
  it("rejects a product from a different tenant, even inside that tenant's own cart", async () => {
    const cartId = await createCart(fx.tenantA);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId, fx.tenantA, productB, 1,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant/i);
  });

  it("rejects a cart_items row whose tenant_id doesn't match the parent cart's tenant", async () => {
    const cartId = await createCart(fx.tenantA);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId, fx.tenantB, productB, 1,
        ]),
      ),
    );
    expect(err.message).toMatch(/must match the parent cart/i);
  });

  // 4 — adicionar produto inativo.
  it("rejects adding an inactive product to the cart", async () => {
    const cartId = await createCart(fx.tenantA);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId, fx.tenantA, inactiveProductA, 1,
        ]),
      ),
    );
    expect(err.message).toMatch(/inactive product/i);
  });

  // 5/16 — RPC add_to_cart soma quantidade em vez de duplicar linha.
  it("add_to_cart increments quantity on the same product instead of creating a duplicate row", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 2]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 3]),
      { commit: true },
    );

    const rows = await asActor({ role: "anon" }, (c) =>
      c.query("select quantity from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.quantity).toBe(5);
  });

  // RPC respeita o teto de 99 mesmo somando.
  it("add_to_cart clamps the accumulated quantity at 99", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 90]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 90]),
      { commit: true },
    );

    const rows = await asActor({ role: "anon" }, (c) =>
      c.query("select quantity from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
    );
    expect(rows.rows[0]?.quantity).toBe(99);
  });

  // 17 — double submit / concorrência: duas chamadas simultâneas nunca criam duas linhas nem perdem incremento.
  it("two concurrent add_to_cart calls for the same product never duplicate the row", async () => {
    const cartId = await createCart(fx.tenantA);
    const results = await Promise.allSettled([
      asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 1]), {
        commit: true,
      }),
      asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 1]), {
        commit: true,
      }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const rows = await asActor({ role: "anon" }, (c) =>
      c.query("select quantity from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.quantity).toBe(2);
  });

  // 6/12 — quantidade: diminuir funciona, valores inválidos são rejeitados.
  it("quantity can be decreased, and invalid quantities (0, negative, over 99) are rejected", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
        cartId, fx.tenantA, productA, 5,
      ]),
      { commit: true },
    );

    await asActor(
      { role: "anon" },
      (c) => c.query("update public.cart_items set quantity = 1 where cart_id = $1 and product_id = $2", [cartId, productA]),
      { commit: true },
    );
    const afterDecrease = await asActor({ role: "anon" }, (c) =>
      c.query("select quantity from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
    );
    expect(afterDecrease.rows[0]?.quantity).toBe(1);

    for (const invalid of [0, -1, 100]) {
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("update public.cart_items set quantity = $3 where cart_id = $1 and product_id = $2", [cartId, productA, invalid]),
        ),
      );
      expect(err.message).toMatch(/check constraint|cart_items_quantity_check/i);
    }
  });

  // 7 — remover produto.
  it("an item can be removed from the cart", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
        cartId, fx.tenantA, productA, 1,
      ]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("delete from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
      { commit: true },
    );
    const rows = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(rows.rows).toHaveLength(0);
  });

  // 8/15 — múltiplos produtos, e limpar carrinho remove todos de uma vez.
  it("multiple products can coexist in a cart, and clearing removes all of them", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) =>
        c.query(
          `insert into public.cart_items (cart_id, tenant_id, product_id, quantity)
           values ($1, $2, $3, 1), ($1, $2, $4, 2)`,
          [cartId, fx.tenantA, productA, productA2],
        ),
      { commit: true },
    );
    const beforeClear = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(beforeClear.rows).toHaveLength(2);

    await asActor({ role: "anon" }, (c) => c.query("delete from public.cart_items where cart_id = $1", [cartId]), { commit: true });
    const afterClear = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(afterClear.rows).toHaveLength(0);
  });

  // 9 — carrinho vazio (recém-criado, sem itens).
  it("a freshly created cart starts empty", async () => {
    const cartId = await createCart(fx.tenantA);
    const rows = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(rows.rows).toHaveLength(0);
  });

  // 11 — preço não pode ser manipulado: não existe coluna de preço em cart_items (garantia estrutural, não só de aplicação).
  it("cart_items has no price column at all — nothing for a client-supplied price to overwrite", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'cart_items'",
      ),
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("price");
    expect(columns).not.toContain("unit_price");
    expect(columns.sort()).toEqual(
      ["cart_id", "created_at", "id", "product_id", "quantity", "tenant_id", "updated_at", "variant_id"].sort(),
    );
  });

  // 14 — refresh preserva carrinho: dado commitado é lido de novo numa conexão/ator separado (persistência real, não estado de React).
  it("a committed cart item is still there in a completely separate later read (survives 'refresh')", async () => {
    const cartId = await createCart(fx.tenantA);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
        cartId, fx.tenantA, productA, 4,
      ]),
      { commit: true },
    );

    const laterRead = await asActor({ role: "anon" }, (c) =>
      c.query("select quantity from public.cart_items where cart_id = $1 and product_id = $2", [cartId, productA]),
    );
    expect(laterRead.rows[0]?.quantity).toBe(4);
  });

  // 18 — só anon consegue usar o carrinho de fato (add_to_cart não é chamável por authenticated/service_role).
  it("add_to_cart is anon-only — authenticated has no execute grant on it", async () => {
    const cartId = await createCart(fx.tenantA);
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 1]),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);
  });

  // 19 — carrinhos de lojas diferentes não se misturam: cada um funciona isoladamente, sem interferência.
  it("carts of different tenants operate independently without mixing", async () => {
    const cartA = await createCart(fx.tenantA);
    const cartB = await createCart(fx.tenantB);

    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartA, productA, 1]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantB, cartB, productB, 2]),
      { commit: true },
    );

    const itemsA = await asActor({ role: "anon" }, (c) => c.query("select product_id from public.cart_items where cart_id = $1", [cartA]));
    const itemsB = await asActor({ role: "anon" }, (c) => c.query("select product_id from public.cart_items where cart_id = $1", [cartB]));
    expect(itemsA.rows).toEqual([{ product_id: productA }]);
    expect(itemsB.rows).toEqual([{ product_id: productB }]);
  });

  // ---------------------------------------------------------------------
  // D20.4 — cart_items com product_variants.
  // ---------------------------------------------------------------------
  describe("D20.4 — variantes", () => {
    it("anon can add a valid, active, same-product/tenant variant via add_to_cart", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor(
        { role: "anon" },
        (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 2, variantActiveA]),
        { commit: true },
      );
      const rows = await asActor({ role: "anon" }, (c) =>
        c.query("select variant_id, quantity from public.cart_items where cart_id = $1", [cartId]),
      );
      expect(rows.rows).toEqual([{ variant_id: variantActiveA, quantity: 2 }]);
    });

    it("add_to_cart with the same variant increments quantity instead of creating a duplicate row", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 2, variantActiveA]), { commit: true });
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 3, variantActiveA]), { commit: true });
      const rows = await asActor({ role: "anon" }, (c) =>
        c.query("select quantity from public.cart_items where cart_id = $1 and variant_id = $2", [cartId, variantActiveA]),
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.quantity).toBe(5);
    });

    it("two concurrent add_to_cart calls for the same variant never duplicate the row", async () => {
      const cartId = await createCart(fx.tenantA);
      const results = await Promise.allSettled([
        asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 1, variantActiveA]), { commit: true }),
        asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 1, variantActiveA]), { commit: true }),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const rows = await asActor({ role: "anon" }, (c) =>
        c.query("select quantity from public.cart_items where cart_id = $1 and variant_id = $2", [cartId, variantActiveA]),
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.quantity).toBe(2);
    });

    it("two different variants of the same product coexist as independent rows", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 1, variantActiveA]), { commit: true });
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 4, variantActiveA2]), { commit: true });
      const rows = await asActor({ role: "anon" }, (c) =>
        c.query("select variant_id, quantity from public.cart_items where cart_id = $1 order by variant_id", [cartId]),
      );
      expect(rows.rows).toEqual(
        [
          { variant_id: variantActiveA, quantity: 1 },
          { variant_id: variantActiveA2, quantity: 4 },
        ].sort((a, b) => (a.variant_id < b.variant_id ? -1 : 1)),
      );
    });

    it("a simple product and a variant of a product-with-variants coexist independently in the same cart", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 1]), { commit: true });
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartId, productWithVariantsA, 2, variantActiveA]), { commit: true });
      const rows = await asActor({ role: "anon" }, (c) => c.query("select product_id, variant_id from public.cart_items where cart_id = $1", [cartId]));
      expect(rows.rows).toHaveLength(2);
    });

    it("rejects duplicating the same variant in the same cart via direct INSERT (partial unique index)", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor(
        { role: "anon" },
        (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
          cartId, fx.tenantA, productWithVariantsA, variantActiveA, 1,
        ]),
        { commit: true },
      );
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
            cartId, fx.tenantA, productWithVariantsA, variantActiveA, 1,
          ]),
        ),
      );
      expect(err.message).toMatch(/cart_items_cart_variant_unique/i);
    });

    it("rejects a variant that belongs to a DIFFERENT product (same tenant)", async () => {
      const cartId = await createCart(fx.tenantA);
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
            cartId, fx.tenantA, productWithVariantsA, otherProductOwnVariant, 1,
          ]),
        ),
      );
      expect(err.message).toMatch(/variant_id must belong to the same product_id and tenant_id/i);
    });

    it("rejects a variant that belongs to a DIFFERENT tenant", async () => {
      const cartId = await createCart(fx.tenantA);
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
            cartId, fx.tenantA, productWithVariantsA, variantB, 1,
          ]),
        ),
      );
      expect(err.message).toMatch(/variant_id must belong to the same product_id and tenant_id/i);
    });

    it("rejects adding an INACTIVE variant to the cart", async () => {
      const cartId = await createCart(fx.tenantA);
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
            cartId, fx.tenantA, productWithVariantsA, variantInactiveA, 1,
          ]),
        ),
      );
      expect(err.message).toMatch(/inactive variant/i);
    });

    it("rejects adding a product-with-variants to the cart WITHOUT choosing a variant", async () => {
      const cartId = await createCart(fx.tenantA);
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
            cartId, fx.tenantA, productWithVariantsA, 1,
          ]),
        ),
      );
      expect(err.message).toMatch(/requires selecting a variant/i);
    });

    it("a variant already in the cart can still have its quantity reduced even if it becomes inactive afterwards (INSERT-only active check)", async () => {
      const cartId = await createCart(fx.tenantA);
      // otherProductOwnVariant está ativa no momento do insert; desativada
      // DEPOIS, por fora — não deve travar um UPDATE de quantidade
      // (mesmo raciocínio já testado para "produto inativo", agora para
      // variante: item já no carrinho não é retroativamente invalidado).
      await asActor(
        { role: "anon" },
        (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
          cartId, fx.tenantA, otherProductWithVariantA, otherProductOwnVariant, 3,
        ]),
        { commit: true },
      );
      await withSuperuser((c) => c.query("update public.product_variants set is_active = false where id = $1", [otherProductOwnVariant]));
      try {
        await asActor(
          { role: "anon" },
          (c) => c.query("update public.cart_items set quantity = 1 where cart_id = $1 and variant_id = $2", [cartId, otherProductOwnVariant]),
          { commit: true },
        );
        const rows = await asActor({ role: "anon" }, (c) => c.query("select quantity from public.cart_items where cart_id = $1 and variant_id = $2", [cartId, otherProductOwnVariant]));
        expect(rows.rows[0]?.quantity).toBe(1);
      } finally {
        await withSuperuser((c) => c.query("update public.product_variants set is_active = true where id = $1", [otherProductOwnVariant]));
      }
    });

    it("rejects a cart_items row whose variant tenant_id doesn't match via UPDATE too (not just INSERT)", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor(
        { role: "anon" },
        (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
          cartId, fx.tenantA, productWithVariantsA, variantActiveA, 1,
        ]),
        { commit: true },
      );
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) =>
          c.query("update public.cart_items set variant_id = $2 where cart_id = $1", [cartId, variantB]),
        ),
      );
      expect(err.message).toMatch(/variant_id must belong to the same product_id and tenant_id/i);
    });

    it("add_to_cart without p_variant_id still works exactly as before (4-argument call, simple product)", async () => {
      const cartId = await createCart(fx.tenantA);
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4)", [fx.tenantA, cartId, productA, 2]), { commit: true });
      const rows = await asActor({ role: "anon" }, (c) => c.query("select variant_id, quantity from public.cart_items where cart_id = $1", [cartId]));
      expect(rows.rows).toEqual([{ variant_id: null, quantity: 2 }]);
    });

    it("carts of different tenants with variants operate independently", async () => {
      const cartA = await createCart(fx.tenantA);
      const cartB = await createCart(fx.tenantB);
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantA, cartA, productWithVariantsA, 1, variantActiveA]), { commit: true });
      await asActor({ role: "anon" }, (c) => c.query("select add_to_cart($1, $2, $3, $4, $5)", [fx.tenantB, cartB, productWithVariantB, 2, variantB]), { commit: true });
      const itemsA = await asActor({ role: "anon" }, (c) => c.query("select variant_id from public.cart_items where cart_id = $1", [cartA]));
      const itemsB = await asActor({ role: "anon" }, (c) => c.query("select variant_id from public.cart_items where cart_id = $1", [cartB]));
      expect(itemsA.rows).toEqual([{ variant_id: variantActiveA }]);
      expect(itemsB.rows).toEqual([{ variant_id: variantB }]);
    });
  });
});
