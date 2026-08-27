/**
 * Fase D2-B (revisão final) — order_source/payment_channel/
 * payment_status=EXTERNAL/requested_payment_method/cash_change_for
 * (migrations 20260817220079-81). Mesmo padrão de
 * `tests/integration/checkout.test.ts` (RLS/RPC testados via SQL direta,
 * `anon`) — este arquivo cobre só o que é NOVO nesta fase, não repete a
 * cobertura já existente de recálculo de preço/lock do carrinho/
 * snapshot/duplicidade (essas garantias são as MESMAS para qualquer
 * valor de order_source, e continuam verdes, inalteradas, em
 * checkout.test.ts).
 *
 * Nota de escopo: a decisão de QUANDO usar cada order_source/
 * payment_channel/requested_payment_method é feita em TypeScript
 * (features/checkout/actions.ts::createOrderAction sempre usa os
 * defaults; whatsapp-actions.ts::createOrderForWhatsappAction sempre
 * passa 'whatsapp'/'external'/a preferência escolhida) — este arquivo
 * testa a RPC diretamente com cada combinação.
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
  complement: "Sala 1",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("order_source / payment_channel / EXTERNAL / troco (Fase D2-B)", () => {
  let fx: Fixtures;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const insertProduct = async (tenantId: string, name: string, price: number) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id`,
          [tenantId, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`, price],
        );
        return rows[0]!.id;
      };
      productA = await insertProduct(fx.tenantA, "WhatsApp Produto A1", 40);
      productB = await insertProduct(fx.tenantB, "WhatsApp Produto B1", 30);
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

  interface CreateOrderOverrides {
    orderSource?: string;
    paymentChannel?: string;
    requestedPaymentMethod?: string | null;
    cashChangeFor?: number | null;
  }

  function callCreateOrder(tenantId: string, cartId: string, overrides: CreateOrderOverrides = {}) {
    return asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>(
          "select create_order_from_cart($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [
            tenantId,
            cartId,
            "Cliente WhatsApp",
            "cliente@example.com",
            "11912345678",
            JSON.stringify(address),
            overrides.orderSource ?? "vexo_checkout",
            overrides.paymentChannel ?? "gateway",
            overrides.requestedPaymentMethod ?? null,
            overrides.cashChangeFor ?? null,
          ],
        ),
      { commit: true },
    );
  }

  it("chamando com só os 6 parâmetros originais (retrocompatibilidade), o pedido nasce vexo_checkout/gateway/PENDING", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          fx.tenantA,
          cartId,
          "Cliente Legado",
          "legado@example.com",
          "11912345678",
          JSON.stringify(address),
        ]),
      { commit: true },
    );
    const orderId = result.rows[0]!.create_order_from_cart;

    const order = await withSuperuser((c) =>
      c.query(
        "select order_source, payment_channel, payment_status, requested_payment_method, cash_change_for from public.orders where id = $1",
        [orderId],
      ),
    );
    expect(order.rows[0]).toMatchObject({
      order_source: "vexo_checkout",
      payment_channel: "gateway",
      payment_status: "PENDING",
      requested_payment_method: null,
      cash_change_for: null,
    });
  });

  it("chamando explicitamente com order_source='whatsapp'/payment_channel='external'/pix, o pedido nasce com payment_status='EXTERNAL' e a preferência gravada", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "pix",
    });
    const orderId = result.rows[0]!.create_order_from_cart;

    const order = await withSuperuser((c) =>
      c.query("select order_source, payment_channel, payment_status, requested_payment_method from public.orders where id = $1", [
        orderId,
      ]),
    );
    expect(order.rows[0]).toMatchObject({
      order_source: "whatsapp",
      payment_channel: "external",
      payment_status: "EXTERNAL",
      requested_payment_method: "pix",
    });
  });

  it("'arrange_with_store' não é mais um valor aceito (removido nesta revisão)", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(
      callCreateOrder(fx.tenantA, cartId, { orderSource: "whatsapp", paymentChannel: "external", requestedPaymentMethod: "arrange_with_store" }),
    );
    expect(err.message).toMatch(/invalid requested payment method/i);
  });

  it("seleção de forma de pagamento é OBRIGATÓRIA no caminho external — omitir é rejeitado", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId, { orderSource: "whatsapp", paymentChannel: "external" }));
    expect(err.message).toMatch(/required for external payment channel/i);
  });

  it("requested_payment_method é proibido no caminho gateway", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId, { requestedPaymentMethod: "pix" }));
    expect(err.message).toMatch(/required for external payment channel, and only for it/i);
  });

  it("dinheiro sem troco (cash_change_for null) é aceito", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "cash",
      cashChangeFor: null,
    });
    const orderId = result.rows[0]!.create_order_from_cart;
    const order = await withSuperuser((c) => c.query("select cash_change_for from public.orders where id = $1", [orderId]));
    expect(order.rows[0]!.cash_change_for).toBeNull();
  });

  it("dinheiro com troco cobrindo o subtotal é aceito e persistido", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1); // subtotal = 40
    const result = await callCreateOrder(fx.tenantA, cartId, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "cash",
      cashChangeFor: 50,
    });
    const orderId = result.rows[0]!.create_order_from_cart;
    const order = await withSuperuser((c) => c.query("select cash_change_for from public.orders where id = $1", [orderId]));
    expect(Number(order.rows[0]!.cash_change_for)).toBe(50);
  });

  it("troco menor que o subtotal é rejeitado pela RPC (defesa em profundidade — a checagem forte contra o total com frete é feita em TS antes de chamar)", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1); // subtotal = 40
    const err = await expectPgError(
      callCreateOrder(fx.tenantA, cartId, {
        orderSource: "whatsapp",
        paymentChannel: "external",
        requestedPaymentMethod: "cash",
        cashChangeFor: 10,
      }),
    );
    expect(err.message).toMatch(/less than the order subtotal/i);
  });

  it("troco só é aceito junto de requested_payment_method='cash' — rejeitado para pix/card", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(
      callCreateOrder(fx.tenantA, cartId, {
        orderSource: "whatsapp",
        paymentChannel: "external",
        requestedPaymentMethod: "pix",
        cashChangeFor: 100,
      }),
    );
    expect(err.message).toMatch(/cash_change_for only applies to cash/i);
  });

  it("um pedido whatsapp/external nunca ganha uma linha em payments — create_payment_for_order/webhook nunca são chamados para ele", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "card",
    });
    const orderId = result.rows[0]!.create_order_from_cart;

    const payments = await withSuperuser((c) => c.query("select 1 from public.payments where order_id = $1", [orderId]));
    expect(payments.rows).toHaveLength(0);
  });

  it("get_order_confirmation inclui orderSource/requestedPaymentMethod/cashChangeFor para um pedido whatsapp", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "cash",
      cashChangeFor: 50,
    });
    const orderId = result.rows[0]!.create_order_from_cart;

    const confirmation = await asActor({ role: "anon" }, (c) =>
      c.query<{ confirmation: { orderSource: string; requestedPaymentMethod: string; paymentStatus: string; cashChangeFor: number } }>(
        "select get_order_confirmation($1, $2) as confirmation",
        [fx.tenantA, orderId],
      ),
    );
    expect(confirmation.rows[0]!.confirmation).toMatchObject({
      orderSource: "whatsapp",
      requestedPaymentMethod: "cash",
      paymentStatus: "EXTERNAL",
      cashChangeFor: 50,
    });
  });

  it("CHECK rejeita order_source fora de vexo_checkout/whatsapp", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId, { orderSource: "instagram" }));
    expect(err.message).toMatch(/invalid order source/i);
  });

  it("CHECK rejeita payment_channel fora de gateway/external", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId, { paymentChannel: "pix_direto" }));
    expect(err.message).toMatch(/invalid payment channel/i);
  });

  it("a constraint de consistência bloqueia gravar payment_channel='gateway' com payment_status='EXTERNAL' diretamente na tabela", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query(
          `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, payment_channel, payment_status)
           values ($1, $2, 'X', 'x@example.com', '11999999999', $3, 10, 10, 'gateway', 'EXTERNAL')`,
          [fx.tenantA, `PEDX${runId}1`, address],
        ),
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("23514"); // check_violation
  });

  it("a constraint de consistência exige requested_payment_method para todo pedido external, e proíbe para todo pedido gateway", async () => {
    const errNoPreference = await expectPgError(
      withSuperuser((c) =>
        c.query(
          `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, payment_channel, payment_status)
           values ($1, $2, 'X', 'x@example.com', '11999999999', $3, 10, 10, 'external', 'EXTERNAL')`,
          [fx.tenantA, `PEDX${runId}2`, address],
        ),
      ),
    );
    expect((errNoPreference as unknown as { code?: string }).code).toBe("23514");

    const errUnexpectedPreference = await expectPgError(
      withSuperuser((c) =>
        c.query(
          `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, payment_channel, payment_status, requested_payment_method)
           values ($1, $2, 'X', 'x@example.com', '11999999999', $3, 10, 10, 'gateway', 'PENDING', 'pix')`,
          [fx.tenantA, `PEDX${runId}3`, address],
        ),
      ),
    );
    expect((errUnexpectedPreference as unknown as { code?: string }).code).toBe("23514");
  });

  it("requested_payment_method rejeita valor fora da lista fechada (pix/cash/card) — a própria função barra antes de chegar ao INSERT", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const err = await expectPgError(
      callCreateOrder(fx.tenantA, cartId, { orderSource: "whatsapp", paymentChannel: "external", requestedPaymentMethod: "boleto" }),
    );
    expect((err as unknown as { code?: string }).code).toBe("P0001");
    expect(err.message).toMatch(/invalid requested payment method/i);
  });

  it("cash_change_for só é aceito junto de requested_payment_method='cash' — CHECK direto na tabela também bloqueia", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query(
          `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, payment_channel, payment_status, requested_payment_method, cash_change_for)
           values ($1, $2, 'X', 'x@example.com', '11999999999', $3, 10, 10, 'external', 'EXTERNAL', 'pix', 50)`,
          [fx.tenantA, `PEDX${runId}4`, address],
        ),
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  it("tenant hopping continua bloqueado também no caminho whatsapp: p_tenant_id que não bate com o dono real do carrinho é rejeitado", async () => {
    const cartId = await createCartWithItem(fx.tenantB, productB, 1);
    const err = await expectPgError(
      callCreateOrder(fx.tenantA, cartId, { orderSource: "whatsapp", paymentChannel: "external", requestedPaymentMethod: "card" }),
    );
    expect(err.message).toMatch(/cart not found/i);

    const orders = await withSuperuser((c) =>
      c.query("select 1 from public.orders where tenant_id = $1 and order_source = 'whatsapp' and total = 30", [fx.tenantA]),
    );
    expect(orders.rows).toHaveLength(0);
  });

  it("anon não tem nenhum grant de UPDATE em orders — order_source/payment_channel nunca são alteráveis por uma escrita direta do cliente, só pela criação via RPC", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("update public.orders set order_source = 'whatsapp', payment_channel = 'external' where id = $1", [orderId]),
      ),
    );
    expect(err.message).toMatch(/permission denied|row-level security/i);
  });

  it("índice tenant_id/order_source existe (suporte a filtragem futura do painel)", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query("select 1 from pg_indexes where tablename = 'orders' and indexname = 'orders_tenant_source_idx'"),
    );
    expect(rows).toHaveLength(1);
  });
});
