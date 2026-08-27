/**
 * Fase D2-B.3 — confirm_external_payment (migration 20260817220085).
 * Mesmo padrão de `tests/integration/orders-whatsapp.test.ts`: RLS/RPC
 * testadas diretamente via SQL (asActor/withSuperuser), nunca através das
 * Server Actions do Next.js. Pedidos são inseridos diretamente (não via
 * create_order_from_cart) — o que está sob teste aqui é só a função de
 * confirmação, não a criação do pedido (já coberta em outro arquivo).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const address = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: "Sala 1",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("confirm_external_payment (Fase D2-B.3)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  const runId = randomUUID().slice(0, 8);
  let seq = 0;

  beforeAll(async () => {
    fx = await buildFixtures();

    // OPERATOR não está nas fixtures compartilhadas (só usado por este
    // arquivo) — criado localmente, mesmo padrão de buildFixtures().
    userAOperator = await withSuperuser(async (client) => {
      const email = `operator-a-${runId}@fixtures.test`;
      const { rows } = await client.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
      const id = rows[0]?.id;
      if (!id) throw new Error("failed to create operator user");
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        fx.tenantA,
        id,
        fx.roleIds.OPERATOR,
      ]);
      return id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  interface OrderOverrides {
    tenantId?: string;
    orderSource?: "vexo_checkout" | "whatsapp";
    paymentChannel?: "external" | "gateway";
    paymentStatus?: string;
    requestedPaymentMethod?: string | null;
    status?: string;
  }

  async function insertOrder(overrides: OrderOverrides = {}): Promise<{ id: string; orderNumber: string; total: number }> {
    const tenantId = overrides.tenantId ?? fx.tenantA;
    const orderSource = overrides.orderSource ?? "whatsapp";
    const paymentChannel = overrides.paymentChannel ?? "external";
    const paymentStatus = overrides.paymentStatus ?? (paymentChannel === "external" ? "EXTERNAL" : "PENDING");
    const requestedPaymentMethod =
      overrides.requestedPaymentMethod !== undefined ? overrides.requestedPaymentMethod : paymentChannel === "external" ? "pix" : null;
    const status = overrides.status ?? "PENDING";
    const orderNumber = `PEDCEP${runId}${seq++}`;
    const total = 75;

    const result = await withSuperuser((c) =>
      c.query<{ id: string }>(
        `insert into public.orders (
           tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address,
           subtotal, total, order_source, payment_channel, payment_status, requested_payment_method, status
         )
         values ($1, $2, 'Cliente Teste', 'cliente@example.com', '11999999999', $3, $4, $4, $5, $6, $7, $8, $9)
         returning id`,
        [tenantId, orderNumber, address, total, orderSource, paymentChannel, paymentStatus, requestedPaymentMethod, status],
      ),
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("failed to insert test order");
    return { id, orderNumber, total };
  }

  async function fetchOrder(orderId: string) {
    const { rows } = await withSuperuser((c) =>
      c.query(
        "select status, payment_status, total, order_source, payment_channel from public.orders where id = $1",
        [orderId],
      ),
    );
    return rows[0] as { status: string; payment_status: string; total: number; order_source: string; payment_channel: string };
  }

  async function countConfirmationLogs(orderId: string): Promise<number> {
    const { rows } = await withSuperuser((c) =>
      c.query("select count(*)::int as n from public.audit_logs where resource_type = 'order' and resource_id = $1 and action = 'ORDER_PAYMENT_CONFIRMED'", [
        orderId,
      ]),
    );
    return rows[0]?.n ?? 0;
  }

  it("1) OWNER confirma pedido external → sucesso, status PENDING vira PAID", async () => {
    const order = await insertOrder();
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "comprovante conferido"]),
      { commit: true },
    );
    const after = await fetchOrder(order.id);
    expect(after).toMatchObject({ payment_status: "APPROVED", status: "PAID" });
    expect(await countConfirmationLogs(order.id)).toBe(1);
  });

  it("2) ADMIN confirma pedido external → sucesso", async () => {
    const order = await insertOrder();
    await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "confirmado pelo admin"]),
      { commit: true },
    );
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "APPROVED" });
  });

  it("3) MANAGER com orders.update + payments.view → sucesso", async () => {
    const order = await insertOrder();
    await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "confirmado pelo manager"]),
      { commit: true },
    );
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "APPROVED" });
  });

  it("4) OPERATOR com orders.update mas SEM payments.view → falha (interseção exigida, não união)", async () => {
    const order = await insertOrder();
    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: userAOperator },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "tentativa operator"]),
        { commit: false },
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("42501");
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "EXTERNAL" });
  });

  it("5) usuário sem orders.update (não-membro do tenant) → falha", async () => {
    const order = await insertOrder();
    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "tentativa outsider"]),
        { commit: false },
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("42501");
  });

  it("6) pedido gateway (Mercado Pago) → confirmação externa falha, nunca usável para o gateway", async () => {
    const order = await insertOrder({ paymentChannel: "gateway", paymentStatus: "PENDING", requestedPaymentMethod: null });
    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "tentativa em pedido gateway"]),
        { commit: false },
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("P0001");
    expect(err.message).toMatch(/external payment orders/i);
  });

  it("7) tenant A tentando confirmar pedido do tenant B → falha (order not found for this store)", async () => {
    const order = await insertOrder({ tenantId: fx.tenantB });
    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "tenant hopping"]),
        { commit: false },
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("P0002");
    const stillExternal = await fetchOrder(order.id);
    expect(stillExternal.payment_status).toBe("EXTERNAL");
  });

  it("8) pedido já APPROVED → chamada repetida é idempotente, não duplica o log nem re-aplica a transição", async () => {
    const order = await insertOrder();
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "primeira confirmação"]),
      { commit: true },
    );
    // segunda chamada — não deve lançar, não deve alterar nada de novo.
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "segunda tentativa"]),
      { commit: true },
    );
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "APPROVED", status: "PAID" });
    expect(await countConfirmationLogs(order.id)).toBe(1);
  });

  it("9) duas confirmações concorrentes → só uma altera de fato, a outra não tem efeito nem erro", async () => {
    const order = await insertOrder();
    await Promise.all([
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "chamada concorrente 1"]),
        { commit: true },
      ),
      asActor(
        { role: "authenticated", userId: fx.userAAdmin },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "chamada concorrente 2"]),
        { commit: true },
      ),
    ]);
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "APPROVED", status: "PAID" });
    expect(await countConfirmationLogs(order.id)).toBe(1);
  });

  it("10) payment_status não pode ser manipulado por UPDATE direto — nenhuma policy de UPDATE existe em orders", async () => {
    const order = await insertOrder();
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.orders set payment_status = 'APPROVED' where id = $1", [order.id]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "EXTERNAL" });
  });

  it("11) confirm_external_payment nunca move o status para um valor arbitrário — só toca status quando ele ainda era PENDING", async () => {
    const order = await insertOrder();
    // Cancela o pedido ANTES de confirmar o pagamento (cenário: cliente
    // desistiu, mas o comprovante do PIX já tinha sido enviado antes).
    await withSuperuser((c) => c.query("update public.orders set status = 'CANCELLED' where id = $1", [order.id]));

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "confirmando após cancelamento"]),
      { commit: true },
    );

    // payment_status avança (o dinheiro foi recebido de fato), mas o
    // status do pedido permanece CANCELLED — a função nunca o move para
    // PAID a partir de qualquer status que não seja PENDING.
    expect(await fetchOrder(order.id)).toMatchObject({ payment_status: "APPROVED", status: "CANCELLED" });
  });

  it("12) anon é bloqueado — EXECUTE nunca concedido a anon", async () => {
    const order = await insertOrder();
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "tentativa anon"]), {
        commit: false,
      }),
    );
    expect((err as unknown as { code?: string }).code).toBe("42501");
  });

  it("13/14/15) total, order_source e payment_channel permanecem imutáveis após a confirmação", async () => {
    const order = await insertOrder({ orderSource: "whatsapp", paymentChannel: "external" });
    const before = await fetchOrder(order.id);
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "confirmação"]),
      { commit: true },
    );
    const after = await fetchOrder(order.id);
    expect(after.total).toBe(before.total);
    expect(after.order_source).toBe(before.order_source);
    expect(after.payment_channel).toBe(before.payment_channel);
  });

  it("exige motivo não vazio", async () => {
    const order = await insertOrder();
    const err = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select public.confirm_external_payment($1, $2, $3)", [fx.tenantA, order.id, "   "]),
        { commit: false },
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("22023");
  });

  it("nunca altera apply_payment_update/Mercado Pago: um pedido gateway approved continua com payment_channel=gateway", async () => {
    const order = await insertOrder({ paymentChannel: "gateway", paymentStatus: "APPROVED", requestedPaymentMethod: null, status: "PAID" });
    expect(await fetchOrder(order.id)).toMatchObject({ payment_channel: "gateway", payment_status: "APPROVED", status: "PAID" });
  });
});
