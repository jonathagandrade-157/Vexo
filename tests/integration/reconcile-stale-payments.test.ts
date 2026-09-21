/**
 * JON-15 — `list_stale_pending_gateway_payments` (migration
 * 20260817220120), a única leitura nova do cron de reconciliação de
 * webhook de pagamento perdido. A escrita em si (apply_payment_update)
 * já é totalmente coberta por tests/integration/payments.test.ts — aqui
 * o foco é só esta função de listagem: escopo por payment_channel,
 * janela de staleness, ordenação, limite, e permissões.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

const ADDRESS = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("list_stale_pending_gateway_payments (JON-15)", () => {
  let fx: Fixtures;

  async function insertOrder(tenantId: string, total: number): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
        [tenantId, `PED${runId}${Math.floor(Math.random() * 100000)}`, "Cliente Teste", "cliente@example.com", "11912345678", ADDRESS, total],
      );
      return rows[0]!.id;
    });
  }

  async function createStalePendingPayment(tenantId: string, total: number, ageMinutes: number): Promise<string> {
    const orderId = await insertOrder(tenantId, total);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [tenantId, orderId]), {
      commit: true,
    });
    await withSuperuser((c) =>
      c.query("update public.payments set created_at = now() - make_interval(mins => $2) where order_id = $1", [orderId, ageMinutes]),
    );
    return orderId;
  }

  /** payments_order_id_fkey não tem ON DELETE CASCADE — a linha de payments sempre precisa ser removida primeiro. */
  async function deleteOrders(orderIds: string[]): Promise<void> {
    await withSuperuser((c) => c.query("delete from public.payments where order_id = any($1)", [orderIds]));
    await withSuperuser((c) => c.query("delete from public.orders where id = any($1)", [orderIds]));
  }

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns a gateway-channel order whose payment is PENDING and older than the window, oldest first", async () => {
    const older = await createStalePendingPayment(fx.tenantA, 100, 60);
    const newer = await createStalePendingPayment(fx.tenantA, 100, 35);

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ tenant_id: string; order_id: string }>(
        "select tenant_id, order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)",
      ),
    );

    const orderIds = result.rows.map((r) => r.order_id);
    expect(orderIds).toContain(older);
    expect(orderIds).toContain(newer);
    expect(orderIds.indexOf(older)).toBeLessThan(orderIds.indexOf(newer));

    await deleteOrders([older, newer]);
  });

  it("excludes a payment younger than the window (order still genuinely in progress)", async () => {
    const fresh = await createStalePendingPayment(fx.tenantA, 100, 5);

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ order_id: string }>("select order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)"),
    );
    expect(result.rows.map((r) => r.order_id)).not.toContain(fresh);

    await deleteOrders([fresh]);
  });

  it("excludes a payment that is no longer PENDING (already resolved by the webhook)", async () => {
    const orderId = await createStalePendingPayment(fx.tenantA, 100, 60);
    await withSuperuser((c) => c.query("update public.payments set status = 'APPROVED' where order_id = $1", [orderId]));

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ order_id: string }>("select order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)"),
    );
    expect(result.rows.map((r) => r.order_id)).not.toContain(orderId);

    await deleteOrders([orderId]);
  });

  it("excludes a payment_channel='external' order even if it were somehow PENDING and old (defense in depth — external never has a payments row in practice)", async () => {
    const orderId = await insertOrder(fx.tenantA, 100);
    await withSuperuser((c) =>
      c.query(
        `insert into public.payments (tenant_id, order_id, provider, status, amount, created_at)
         values ($1, $2, 'mercadopago', 'PENDING', 100, now() - interval '60 minutes')`,
        [fx.tenantA, orderId],
      ),
    );
    // payment_channel só pode virar 'external' com payment_status EXTERNAL e
    // requested_payment_method preenchido (constraints
    // orders_payment_channel_status_consistency e
    // orders_requested_payment_method_channel_check) — então isto exercita a
    // cláusula WHERE em si, não um estado alcançável em produção (nenhuma
    // linha de payments chega a existir para um pedido external de verdade).
    await withSuperuser((c) =>
      c.query(
        "update public.orders set payment_channel = 'external', payment_status = 'EXTERNAL', requested_payment_method = 'pix' where id = $1",
        [orderId],
      ),
    );

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ order_id: string }>("select order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)"),
    );
    expect(result.rows.map((r) => r.order_id)).not.toContain(orderId);

    await deleteOrders([orderId]);
  });

  it("respects p_limit — never returns more rows than requested, even with more stale orders available", async () => {
    const orderIds = await Promise.all([
      createStalePendingPayment(fx.tenantA, 10, 90),
      createStalePendingPayment(fx.tenantA, 10, 80),
      createStalePendingPayment(fx.tenantA, 10, 70),
    ]);

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query("select order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 2)"),
    );
    expect(result.rows.length).toBeLessThanOrEqual(2);

    await deleteOrders(orderIds);
  });

  it("is scoped correctly across tenants — a stale order from tenant B is still returned (no RLS on this internal listing; scoping is the cron's job, not per-tenant filtering)", async () => {
    const orderId = await createStalePendingPayment(fx.tenantB, 100, 60);

    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ tenant_id: string; order_id: string }>("select tenant_id, order_id from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)"),
    );
    const row = result.rows.find((r) => r.order_id === orderId);
    expect(row).toEqual({ tenant_id: fx.tenantB, order_id: orderId });

    await deleteOrders([orderId]);
  });

  it("is service_role-only — anon and authenticated have no execute grant", async () => {
    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, userId: fx.userAOwner }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select * from list_stale_pending_gateway_payments(now() - interval '30 minutes', 50)")),
      );
      expect(err.message).toMatch(/permission denied/i);
    }
  });
});
