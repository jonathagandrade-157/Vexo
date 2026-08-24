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
      ["cart_id", "created_at", "id", "product_id", "quantity", "tenant_id", "updated_at"].sort(),
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
});
