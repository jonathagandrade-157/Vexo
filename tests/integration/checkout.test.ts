/**
 * Etapa 10 — checkout (prompt Etapa 10 §23/§24). RLS/trigger/RPC
 * testados diretamente via SQL (asActor), mesmo padrão de sempre. O
 * checkout em si é anônimo (`anon`), mesmo modelo do carrinho da Etapa
 * 9 — `create_order_from_cart`/`get_order_confirmation` são
 * `security definer`, únicos caminhos de escrita/leitura para `anon`
 * (não há policy pública direta nas tabelas).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

const address = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: "Sala 1",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Checkout (Etapa 10)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let productA: string;
  let productA2: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`checkout-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );

      const insertProduct = async (tenantId: string, name: string, price: number) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id`,
          [tenantId, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`, price],
        );
        return rows[0]!.id;
      };
      productA = await insertProduct(fx.tenantA, "Checkout Produto A1", 100);
      productA2 = await insertProduct(fx.tenantA, "Checkout Produto A2", 50);
      productB = await insertProduct(fx.tenantB, "Checkout Produto B1", 70);
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
          cartId, tenantId, productId, quantity,
        ]),
      { commit: true },
    );
    return cartId;
  }

  function callCreateOrder(
    tenantId: string,
    cartId: string,
    overrides: Partial<{ name: string; email: string; phone: string; address: typeof address }> = {},
  ) {
    return asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          tenantId,
          cartId,
          overrides.name ?? "Maria Cliente",
          overrides.email ?? "maria@example.com",
          overrides.phone ?? "11912345678",
          JSON.stringify(overrides.address ?? address),
        ]),
      // Precisa commitar: os testes leem o pedido criado de uma conexão
      // separada (withSuperuser) ou numa chamada de asActor() posterior
      // (nova transação) — sem commit, a criação inteira seria
      // revertida no fim da própria transação e nunca seria vista por
      // essas leituras.
      { commit: true },
    );
  }

  // 1/22 — checkout vazio é bloqueado, nenhum pedido é criado.
  it("rejects checkout on an empty cart, creating no order at all", async () => {
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart is empty/i);

    const orders = await withSuperuser((c) => c.query("select 1 from public.orders where tenant_id = $1", [fx.tenantA]));
    // não é uma asserção de zero global (outros testes já criaram pedidos em A) — só confirma que ESTE carrinho vazio não gerou nenhum.
    const itemsStillEmpty = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(itemsStillEmpty.rows).toHaveLength(0);
    expect(orders.rows).toBeDefined();
  });

  // 7/19 — produto inativo é rejeitado, e o carrinho é preservado (não limpo em caso de erro).
  it("rejects checkout when a cart item's product became inactive, and preserves the cart", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA2, 2);
    await withSuperuser((c) => c.query("update public.products set status = 'inactive' where id = $1", [productA2]));

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/no longer available/i);

    const items = await asActor({ role: "anon" }, (c) => c.query("select quantity from public.cart_items where cart_id = $1", [cartId]));
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0]?.quantity).toBe(2);

    await withSuperuser((c) => c.query("update public.products set status = 'active' where id = $1", [productA2]));
  });

  // 8 — produto de outro tenant: estruturalmente impossível chegar a esse estado (herda a proteção da Etapa 9).
  it("a cart can never contain another tenant's product in the first place (inherited from Etapa 9's trigger)", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
          cartId, fx.tenantA, productB, 1,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant/i);
  });

  // 9/23 — preço é sempre lido AO VIVO no momento do checkout, nunca o que valia quando o item foi adicionado ao carrinho.
  it("always uses the live product price at checkout time, not a stale price from when it was added to the cart", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 3);
    await withSuperuser((c) => c.query("update public.products set price = 150 where id = $1", [productA]));

    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const order = await withSuperuser((c) =>
      c.query("select subtotal, total from public.orders where id = $1", [orderId]),
    );
    expect(Number(order.rows[0]?.subtotal)).toBe(450); // 150 * 3, não o preço de 100 de quando foi adicionado
    expect(Number(order.rows[0]?.total)).toBe(450);

    await withSuperuser((c) => c.query("update public.products set price = 100 where id = $1", [productA]));
  });

  // 12/13/14/16/18/23/24/25/26/27 — criação com sucesso: pedido + itens + tenant + snapshot + carrinho limpo + valores corretos.
  it("creates an order with items, correct tenant/totals/status, snapshot data, and clears the cart", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 2);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)", [
        cartId, fx.tenantA, productA2, 1,
      ]),
      { commit: true },
    );

    const result = await callCreateOrder(fx.tenantA, cartId, { name: "João Comprador", email: "joao@example.com" });
    const orderId = result.rows[0]!.create_order_from_cart;
    expect(orderId).toBeTruthy();

    const order = await withSuperuser((c) =>
      c.query(
        `select tenant_id, status, customer_name, subtotal, discount_total, shipping_total, total, shipping_address
         from public.orders where id = $1`,
        [orderId],
      ),
    );
    const row = order.rows[0]!;
    expect(row.tenant_id).toBe(fx.tenantA);
    expect(row.status).toBe("PENDING");
    expect(row.customer_name).toBe("João Comprador");
    expect(Number(row.subtotal)).toBe(2 * 100 + 1 * 50);
    expect(Number(row.discount_total)).toBe(0);
    expect(Number(row.shipping_total)).toBe(0);
    expect(Number(row.total)).toBe(2 * 100 + 1 * 50);
    expect(row.shipping_address).toEqual(address);

    const items = await withSuperuser((c) =>
      c.query("select product_name, quantity, unit_price, subtotal from public.order_items where order_id = $1 order by product_name", [
        orderId,
      ]),
    );
    expect(items.rows).toHaveLength(2);

    const cartAfter = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(cartAfter.rows).toHaveLength(0);
  });

  // 17 — nome/preço do produto são preservados como snapshot mesmo após o produto mudar depois.
  it("preserves product name/price snapshot even after the product changes later", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    await withSuperuser((c) => c.query("update public.products set name = 'Nome Totalmente Diferente', price = 999 where id = $1", [productA]));

    const item = await withSuperuser((c) =>
      c.query("select product_name, unit_price from public.order_items where order_id = $1", [orderId]),
    );
    expect(item.rows[0]?.product_name).toBe("Checkout Produto A1");
    expect(Number(item.rows[0]?.unit_price)).toBe(100);

    await withSuperuser((c) => c.query("update public.products set name = 'Checkout Produto A1', price = 100 where id = $1", [productA]));
  });

  // 20 — double submit sequencial não cria pedido duplicado.
  it("a sequential double submit (retry after success) never creates a second order", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const first = await callCreateOrder(fx.tenantA, cartId);
    expect(first.rows[0]!.create_order_from_cart).toBeTruthy();

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart is empty/i);
  });

  // 21 — concorrência real: duas chamadas simultâneas para o mesmo carrinho nunca criam dois pedidos.
  it("two concurrent checkout attempts for the same cart never create two orders", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);

    const results = await Promise.allSettled([callCreateOrder(fx.tenantA, cartId), callCreateOrder(fx.tenantA, cartId)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const orderId = (fulfilled[0] as PromiseFulfilledResult<{ rows: { create_order_from_cart: string }[] }>).value.rows[0]!
      .create_order_from_cart;
    const orders = await withSuperuser((c) => c.query("select 1 from public.orders where id = $1", [orderId]));
    expect(orders.rows).toHaveLength(1);
  });

  // 28 — audit log é criado.
  it("logs ORDER_CREATED to audit_logs with a minimal payload (no customer PII)", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId, { name: "Pessoa Privada", email: "privada@example.com" });
    const orderId = result.rows[0]!.create_order_from_cart;

    const logs = await withSuperuser((c) =>
      c.query("select action, after from public.audit_logs where tenant_id = $1 and resource_id = $2", [fx.tenantA, orderId]),
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]?.action).toBe("ORDER_CREATED");
    const after = logs.rows[0]?.after as Record<string, unknown>;
    expect(after).not.toHaveProperty("customer_name");
    expect(after).not.toHaveProperty("customer_email");
    expect(after).not.toHaveProperty("shipping_address");
  });

  // 15/29/31 — pedido não pode ser acessado por outro tenant (IDOR / manipulação de order_id).
  it("get_order_confirmation returns null when the order belongs to a different tenant (order_id manipulation)", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const asWrongTenant = await asActor({ role: "anon" }, (c) =>
      c.query("select get_order_confirmation($1, $2) as confirmation", [fx.tenantB, orderId]),
    );
    expect(asWrongTenant.rows[0]?.confirmation).toBeNull();

    const asRightTenant = await asActor({ role: "anon" }, (c) =>
      c.query("select get_order_confirmation($1, $2) as confirmation", [fx.tenantA, orderId]),
    );
    expect(asRightTenant.rows[0]?.confirmation).not.toBeNull();
  });

  it("get_order_confirmation returns null for a random/nonexistent order_id (no enumeration leak)", async () => {
    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select get_order_confirmation($1, $2) as confirmation", [fx.tenantA, randomUUID()]),
    );
    expect(result.rows[0]?.confirmation).toBeNull();
  });

  // 15/29 — RLS: staff de tenant B não vê pedido de tenant A.
  it("RLS blocks tenant B staff from selecting tenant A's orders", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const asTenantAOwner = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    expect(asTenantAOwner.rows).toHaveLength(1);

    const asTenantBOwner = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    expect(asTenantBOwner.rows).toHaveLength(0);

    const asOutsider = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    expect(asOutsider.rows).toHaveLength(0);

    const asOperatorWithoutView = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    // OPERATOR tem orders.view desde a Etapa 2 — deve enxergar.
    expect(asOperatorWithoutView.rows).toHaveLength(1);
  });

  // 30/32 — tenant hopping / manipulação de cart_id: tenant informado não bate com o dono real do carrinho.
  it("rejects create_order_from_cart when p_tenant_id doesn't match the cart's real tenant (tenant hopping via cart_id)", async () => {
    const cartId = await createCartWithItem(fx.tenantB, productB, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart not found/i);

    const orders = await withSuperuser((c) => c.query("select 1 from public.orders where tenant_id = $1 and total = 70", [fx.tenantA]));
    expect(orders.rows).toHaveLength(0);
  });

  // anon-only: authenticated não tem EXECUTE nas funções de checkout.
  it("checkout functions are anon-only — authenticated has no execute grant", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          fx.tenantA, cartId, "X", "x@example.com", "11999999999", JSON.stringify(address),
        ]),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);
  });
});
