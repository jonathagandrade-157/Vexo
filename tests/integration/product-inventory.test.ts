/**
 * D19.1.3 — testes de integração do controle de estoque (D19.1.2:
 * supabase/migrations/20260817220109_product_inventory.sql). Mesmo
 * princípio de toda a suíte (ver tests/integration/checkout.test.ts): SQL
 * direto via asActor/withSuperuser, nunca chamando features/products/
 * actions.ts ou features/checkout/actions.ts diretamente — dependem de
 * next/headers/SupabaseClient de sessão real, indisponíveis neste harness.
 *
 * Concorrência real (Promise.allSettled com duas chamadas asActor
 * independentes — cada uma abre sua PRÓPRIA conexão `pg`, mesmo padrão já
 * usado em checkout.test.ts "two concurrent checkout attempts") é o único
 * jeito de exercitar de verdade a garantia do D19.1.1 §6. Diferente
 * daquele teste (mesmo cart_id, testa o lock de `carts`), aqui os dois
 * checkouts usam CARRINHOS DIFERENTES — o lock que importa é o de
 * `product_inventory`, disputado por dois clientes distintos comprando o
 * mesmo produto ao mesmo tempo.
 *
 * D19.1.3.1 — acrescenta os testes obrigatórios da correção de H1
 * (restauração de estoque ao cancelar, migration 20260817220110) e M1
 * (ordem determinística de lock, mesma migration).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

const address = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Estoque — product_inventory (D19.1.2)", () => {
  let fx: Fixtures;
  /** tenantA, stock_quantity = 1 — usado no teste de concorrência real. */
  let productLimited: string;
  /** tenantA, stock_quantity = 0 — usado no teste de rollback por estoque insuficiente. */
  let productNoStock: string;
  /** tenantA, SEM linha em product_inventory, de propósito — comportamento legado. */
  let productLegacy: string;
  /** tenantB, stock_quantity = 10 já cadastrado em beforeAll — usado nos testes de isolamento entre tenants. */
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const insertProduct = async (tenantId: string, name: string) => {
        const { rows } = await client.query<{ id: string }>(
          "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, 100) returning id",
          [tenantId, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`],
        );
        return rows[0]!.id;
      };

      productLimited = await insertProduct(fx.tenantA, "Estoque Limitado");
      productNoStock = await insertProduct(fx.tenantA, "Sem Estoque");
      productLegacy = await insertProduct(fx.tenantA, "Legado Sem Controle");
      productB = await insertProduct(fx.tenantB, "Produto B");

      await client.query(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 1)",
        [fx.tenantA, productLimited],
      );
      await client.query(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 0)",
        [fx.tenantA, productNoStock],
      );
      await client.query(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 10)",
        [fx.tenantB, productB],
      );
      // productLegacy: nenhuma linha em product_inventory — comportamento legado (D19.1.1 §8).
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createCartWithItem(tenantId: string, productId: string, quantity = 1): Promise<string> {
    const cartId = randomUUID();
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, tenantId]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId,
          tenantId,
          productId,
          quantity,
        ]),
      { commit: true },
    );
    return cartId;
  }

  function callCreateOrder(tenantId: string, cartId: string) {
    return asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          tenantId,
          cartId,
          "Cliente Teste",
          "cliente@example.com",
          "11999999999",
          JSON.stringify(address),
        ]),
      // Precisa commitar: os testes leem o resultado (pedido/estoque) de uma
      // conexão separada (withSuperuser) — mesmo motivo de checkout.test.ts.
      { commit: true },
    );
  }

  async function stockOf(productId: string): Promise<number> {
    const { rows } = await withSuperuser((c) =>
      c.query<{ stock_quantity: number }>("select stock_quantity from public.product_inventory where product_id = $1", [
        productId,
      ]),
    );
    return rows[0]!.stock_quantity;
  }

  /** D19.1.3.1 (H1) — mesma chamada que features/orders/actions.ts::updateOrderStatusAction faz via RPC, aqui direto via SQL (staff autenticado com orders.update). */
  function cancelOrder(tenantId: string, orderId: string, actorUserId: string) {
    return asActor(
      { role: "authenticated", userId: actorUserId },
      (c) => c.query("select update_order_status($1, $2, 'CANCELLED', null)", [tenantId, orderId]),
      { commit: true },
    );
  }

  async function orderStatus(orderId: string): Promise<string> {
    const { rows } = await withSuperuser((c) => c.query<{ status: string }>("select status from public.orders where id = $1", [orderId]));
    return rows[0]!.status;
  }

  it("concorrência real: dois checkouts simultâneos (carrinhos DIFERENTES) para o mesmo produto com estoque = 1 — exatamente um sucede, o outro falha com estoque insuficiente, estoque final = 0, nunca negativo", async () => {
    const cartX = await createCartWithItem(fx.tenantA, productLimited, 1);
    const cartY = await createCartWithItem(fx.tenantA, productLimited, 1);

    const results = await Promise.allSettled([callCreateOrder(fx.tenantA, cartX), callCreateOrder(fx.tenantA, cartY)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/insufficient stock/i);

    const orderId = (fulfilled[0] as PromiseFulfilledResult<{ rows: { create_order_from_cart: string }[] }>).value.rows[0]!
      .create_order_from_cart;
    const orders = await withSuperuser((c) =>
      c.query("select 1 from public.orders where id = $1 and tenant_id = $2", [orderId, fx.tenantA]),
    );
    expect(orders.rows).toHaveLength(1);

    expect(await stockOf(productLimited)).toBe(0);
  });

  it("rollback por estoque insuficiente: pedido para um produto com estoque zerado é revertido por completo — nenhum order/order_items criado, estoque intacto, carrinho não esvaziado", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productNoStock, 1);
    const before = await stockOf(productNoStock);

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/insufficient stock for product/i);

    const items = await withSuperuser((c) =>
      c.query("select 1 from public.order_items where product_id = $1", [productNoStock]),
    );
    expect(items.rows).toHaveLength(0);

    expect(await stockOf(productNoStock)).toBe(before);

    // A transação inteira foi desfeita, inclusive o DELETE de cart_items no
    // fim de create_order_from_cart (nunca alcançado) — o item continua no carrinho.
    const cartItems = await withSuperuser((c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(cartItems.rows).toHaveLength(1);
  });

  it("produto legado (sem linha em product_inventory) continua vendendo normalmente, sem checagem e sem criar linha nenhuma", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productLegacy, 50);
    const result = await callCreateOrder(fx.tenantA, cartId);
    expect(result.rows[0]!.create_order_from_cart).toBeTruthy();

    const inv = await withSuperuser((c) =>
      c.query("select 1 from public.product_inventory where product_id = $1", [productLegacy]),
    );
    expect(inv.rows).toHaveLength(0);
  });

  it("isolamento entre tenants (RLS): staff do tenant A não enxerga nem consegue alterar o estoque do tenant B", async () => {
    const readAsA = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.product_inventory where product_id = $1", [productB]),
    );
    expect(readAsA.rows).toHaveLength(0);

    const writeAsA = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update public.product_inventory set stock_quantity = 999 where product_id = $1", [productB]),
    );
    expect(writeAsA.rowCount).toBe(0);

    expect(await stockOf(productB)).toBe(10);
  });

  it("isolamento entre tenants (checkout): p_tenant_id de A contra um carrinho de B é rejeitado antes do loop de estoque — o estoque de B nunca é tocado", async () => {
    const cartId = await createCartWithItem(fx.tenantB, productB, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart not found/i);
    expect(await stockOf(productB)).toBe(10);
  });

  it("ajuste manual de estoque (staff autenticado) grava PRODUCT_STOCK_ADJUSTED em audit_logs, com before/after corretos", async () => {
    const invId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "select id from public.product_inventory where product_id = $1",
        [productNoStock],
      );
      return rows[0]!.id;
    });

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.product_inventory set stock_quantity = 25 where product_id = $1", [productNoStock]),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query(
        "select action, before, after from public.audit_logs where resource_type = 'product_inventory' and resource_id = $1 and action = 'PRODUCT_STOCK_ADJUSTED'",
        [invId],
      ),
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]?.before).toMatchObject({ stock_quantity: 0 });
    expect(logs.rows[0]?.after).toMatchObject({ stock_quantity: 25 });

    // Devolve o estado para não afetar a ordem de execução de outros testes deste arquivo.
    await withSuperuser((c) => c.query("update public.product_inventory set stock_quantity = 0 where product_id = $1", [productNoStock]));
  });

  it("o decremento automático do checkout (anon) NÃO gera PRODUCT_STOCK_ADJUSTED em audit_logs, mesmo decrementando o estoque de verdade", async () => {
    const stockProductId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'Estoque Auditoria', $2, 100) returning id",
        [fx.tenantA, `estoque-auditoria-${runId}`],
      );
      return rows[0]!.id;
    });
    const invId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 5) returning id",
        [fx.tenantA, stockProductId],
      );
      return rows[0]!.id;
    });

    const cartId = await createCartWithItem(fx.tenantA, stockProductId, 2);
    await callCreateOrder(fx.tenantA, cartId);

    // O decremento aconteceu de verdade — não é que o trigger simplesmente nunca dispara.
    expect(await stockOf(stockProductId)).toBe(3);

    const adjustedLogs = await withSuperuser((c) =>
      c.query(
        "select 1 from public.audit_logs where resource_type = 'product_inventory' and resource_id = $1 and action = 'PRODUCT_STOCK_ADJUSTED'",
        [invId],
      ),
    );
    expect(adjustedLogs.rows).toHaveLength(0);
  });

  it("contraste com o teste acima: criar (INSERT) e remover (DELETE via cascade do produto) uma linha de estoque SÃO auditados normalmente — a exclusão do evento é específica do decremento anon, não um bug de auditoria geral", async () => {
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'Produto Ciclo Estoque', $2, 10) returning id",
        [fx.tenantA, `ciclo-estoque-${runId}`],
      );
      return rows[0]!.id;
    });

    const { rows: invRows } = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query<{ id: string }>(
          "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 7) returning id",
          [fx.tenantA, productId],
        ),
      { commit: true },
    );
    const invId = invRows[0]!.id;

    const definedLog = await withSuperuser((c) =>
      c.query(
        "select 1 from public.audit_logs where resource_type = 'product_inventory' and resource_id = $1 and action = 'PRODUCT_STOCK_DEFINED'",
        [invId],
      ),
    );
    expect(definedLog.rows).toHaveLength(1);

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("delete from public.products where id = $1", [productId]),
      { commit: true },
    );

    const removedLog = await withSuperuser((c) =>
      c.query(
        "select 1 from public.audit_logs where resource_type = 'product_inventory' and resource_id = $1 and action = 'PRODUCT_STOCK_REMOVED'",
        [invId],
      ),
    );
    expect(removedLog.rows).toHaveLength(1);
  });

  // -----------------------------------------------------------------
  // D19.1.3.1 — H1: restauração de estoque ao cancelar (migration 20260817220110).
  // -----------------------------------------------------------------

  it("H1: cancelar um pedido PENDING restaura exatamente a quantidade decrementada na criação", async () => {
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Restauracao Simples', $2, 50) returning id",
        [fx.tenantA, `h1-restauracao-simples-${runId}`],
      );
      return rows[0]!.id;
    });
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 10)", [
        fx.tenantA,
        productId,
      ]),
    );

    const cartId = await createCartWithItem(fx.tenantA, productId, 3);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    expect(await stockOf(productId)).toBe(7); // 10 - 3

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);

    expect(await orderStatus(orderId)).toBe("CANCELLED");
    expect(await stockOf(productId)).toBe(10); // restaurado por completo
  });

  it("H1: repetir o cancelamento do mesmo pedido é rejeitado pela máquina de estados e NUNCA restaura duas vezes", async () => {
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Sem Double Restore', $2, 50) returning id",
        [fx.tenantA, `h1-sem-double-restore-${runId}`],
      );
      return rows[0]!.id;
    });
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 5)", [
        fx.tenantA,
        productId,
      ]),
    );

    const cartId = await createCartWithItem(fx.tenantA, productId, 2);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);
    expect(await stockOf(productId)).toBe(5); // restaurado uma vez (5 - 2 + 2)

    // Repetir a mesma operação: CANCELLED é terminal na máquina de
    // estados — nenhuma transição de CANCELLED para CANCELLED é válida.
    const err = await expectPgError(cancelOrder(fx.tenantA, orderId, fx.userAOwner));
    expect(err.message).toMatch(/invalid order status transition/i);

    expect(await stockOf(productId)).toBe(5); // continua 5, nunca 7 — sem double-restoration
  });

  it("H1: pedido com múltiplos itens (quantidades diferentes) — cancelar restaura cada item pela sua própria quantidade", async () => {
    const [productX, productY] = await withSuperuser(async (c) => {
      const { rows: rx } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Multi X', $2, 10) returning id",
        [fx.tenantA, `h1-multi-x-${runId}`],
      );
      const { rows: ry } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Multi Y', $2, 20) returning id",
        [fx.tenantA, `h1-multi-y-${runId}`],
      );
      return [rx[0]!.id, ry[0]!.id];
    });
    await withSuperuser(async (c) => {
      await c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 8)", [
        fx.tenantA,
        productX,
      ]);
      await c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 20)", [
        fx.tenantA,
        productY,
      ]);
    });

    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 3), ($1, $2, $4, 7)", [
          cartId,
          fx.tenantA,
          productX,
          productY,
        ]),
      { commit: true },
    );

    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    expect(await stockOf(productX)).toBe(5); // 8 - 3
    expect(await stockOf(productY)).toBe(13); // 20 - 7

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);

    expect(await stockOf(productX)).toBe(8);
    expect(await stockOf(productY)).toBe(20);
  });

  it("H1: pedido misto (produto controlado + produto legado) — cancelar restaura SÓ o controlado", async () => {
    const productControlled = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Misto Controlado', $2, 10) returning id",
        [fx.tenantA, `h1-misto-controlado-${runId}`],
      );
      return rows[0]!.id;
    });
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 10)", [
        fx.tenantA,
        productControlled,
      ]),
    );
    // productLegacy (do beforeAll) nunca teve linha em product_inventory.

    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 2), ($1, $2, $4, 5)", [
          cartId,
          fx.tenantA,
          productControlled,
          productLegacy,
        ]),
      { commit: true },
    );

    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    expect(await stockOf(productControlled)).toBe(8); // 10 - 2

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);

    expect(await stockOf(productControlled)).toBe(10); // restaurado
    // productLegacy nunca ganhou uma linha em product_inventory — nem na criação, nem no cancelamento.
    const legacyInv = await withSuperuser((c) =>
      c.query("select 1 from public.product_inventory where product_id = $1", [productLegacy]),
    );
    expect(legacyInv.rows).toHaveLength(0);
  });

  it("H1: pedido antigo (order_items pré-existente, sem a coluna stock_reserved marcada) nunca ganha estoque artificial ao ser cancelado", async () => {
    // Simula um pedido "de antes do D19.1.2/D19.1.3.1": insere order_items
    // diretamente via SQL sem passar por create_order_from_cart — a coluna
    // stock_reserved usa seu DEFAULT (false), exatamente como qualquer
    // order_item que já existia antes desta migration ser aplicada.
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Pedido Antigo', $2, 10) returning id",
        [fx.tenantA, `h1-pedido-antigo-${runId}`],
      );
      return rows[0]!.id;
    });
    // O lojista SÓ define controle de estoque para este produto DEPOIS do pedido antigo já existir.
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 4)", [
        fx.tenantA,
        productId,
      ]),
    );

    const orderId = await withSuperuser(async (c) => {
      const address2 = JSON.stringify(address);
      const { rows } = await c.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, status)
         values ($1, $2, 'Cliente Antigo', 'antigo@example.com', '11999999999', $3, 10, 10, 'PENDING')
         returning id`,
        [fx.tenantA, `PED-ANTIGO-${runId}`, address2],
      );
      const oid = rows[0]!.id;
      // stock_reserved omitido de propósito — usa o DEFAULT (false), como todo order_item pré-D19.1.3.1.
      await c.query(
        "insert into public.order_items (order_id, tenant_id, product_id, product_name, product_slug, quantity, unit_price, subtotal) values ($1, $2, $3, 'H1 Pedido Antigo', 'produto-antigo', 1, 10, 10)",
        [oid, fx.tenantA, productId],
      );
      return oid;
    });

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);

    // Estoque continua 4 — o pedido antigo nunca decrementou nada de
    // verdade, então cancelá-lo não pode "inventar" 1 unidade a mais.
    expect(await stockOf(productId)).toBe(4);
  });

  it("H1: isolamento entre tenants — staff do tenant B não consegue cancelar/restaurar um pedido do tenant A", async () => {
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Isolamento', $2, 10) returning id",
        [fx.tenantA, `h1-isolamento-${runId}`],
      );
      return rows[0]!.id;
    });
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 6)", [
        fx.tenantA,
        productId,
      ]),
    );

    const cartId = await createCartWithItem(fx.tenantA, productId, 2);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;
    expect(await stockOf(productId)).toBe(4);

    // userBOwner tenta cancelar um pedido de A passando tenantB — a função já rejeita por "order not found for this store".
    const err = await expectPgError(cancelOrder(fx.tenantB, orderId, fx.userBOwner));
    expect(err.message).toMatch(/order not found/i);

    expect(await orderStatus(orderId)).toBe("PENDING");
    expect(await stockOf(productId)).toBe(4); // nada foi restaurado
  });

  it("H1: dois cancelamentos concorrentes do MESMO pedido — exatamente um sucede, estoque restaurado uma única vez", async () => {
    const productId = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'H1 Cancel Concorrente', $2, 10) returning id",
        [fx.tenantA, `h1-cancel-concorrente-${runId}`],
      );
      return rows[0]!.id;
    });
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 9)", [
        fx.tenantA,
        productId,
      ]),
    );

    const cartId = await createCartWithItem(fx.tenantA, productId, 4);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;
    expect(await stockOf(productId)).toBe(5); // 9 - 4

    const results = await Promise.allSettled([
      cancelOrder(fx.tenantA, orderId, fx.userAOwner),
      cancelOrder(fx.tenantA, orderId, fx.userAOwner),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // A perdedora falha por compare-and-swap (concorrência real) OU por transição inválida
    // (se já viu CANCELLED ao reler o pedido) — as duas são resultados corretos e esperados.
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /order status changed concurrently|invalid order status transition/i,
    );

    expect(await orderStatus(orderId)).toBe("CANCELLED");
    expect(await stockOf(productId)).toBe(9); // restaurado exatamente uma vez, nunca 13
  });

  // -----------------------------------------------------------------
  // D19.1.3.1 — M1: ordem determinística de lock (migration 20260817220110).
  // -----------------------------------------------------------------

  it("M1: dois carrinhos multi-item, disputando os MESMOS 2 produtos em ordem cruzada, finalizados simultaneamente — sem deadlock (40P01), sem overselling, estoque final correto", async () => {
    const [productM, productN] = await withSuperuser(async (c) => {
      const { rows: rm } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'M1 Produto M', $2, 10) returning id",
        [fx.tenantA, `m1-produto-m-${runId}`],
      );
      const { rows: rn } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, 'M1 Produto N', $2, 10) returning id",
        [fx.tenantA, `m1-produto-n-${runId}`],
      );
      return [rm[0]!.id, rn[0]!.id];
    });
    await withSuperuser(async (c) => {
      await c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 5)", [
        fx.tenantA,
        productM,
      ]);
      await c.query("insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 5)", [
        fx.tenantA,
        productN,
      ]);
    });

    // Estoque suficiente para os dois checkouts (o que está sob teste é
    // ausência de deadlock por ordem de lock cruzada, não escassez) — cada
    // carrinho monta os dois itens em ordem RELATIVA oposta ao outro
    // (cart_items.created_at difere entre os dois INSERTs sequenciais),
    // exatamente o cenário que motivou o achado M1 antes de
    // `order by ci.product_id` existir no loop de create_order_from_cart.
    const cartX = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartX, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [cartX, fx.tenantA, productM]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [cartX, fx.tenantA, productN]),
      { commit: true },
    );

    const cartY = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartY, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [cartY, fx.tenantA, productN]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [cartY, fx.tenantA, productM]),
      { commit: true },
    );

    const results = await Promise.allSettled([callCreateOrder(fx.tenantA, cartX), callCreateOrder(fx.tenantA, cartY)]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of rejected) {
      expect((r.reason as Error).message).not.toMatch(/deadlock/i);
      expect((r.reason as Error).message).not.toMatch(/40P01/i);
    }

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2); // estoque era suficiente para os dois — os dois devem ter sucedido

    expect(await stockOf(productM)).toBe(3); // 5 - 1 - 1
    expect(await stockOf(productN)).toBe(3); // 5 - 1 - 1

    const itemsM = await withSuperuser((c) => c.query("select quantity from public.order_items where product_id = $1", [productM]));
    const itemsN = await withSuperuser((c) => c.query("select quantity from public.order_items where product_id = $1", [productN]));
    expect(itemsM.rows).toHaveLength(2);
    expect(itemsN.rows).toHaveLength(2);
  });
});
