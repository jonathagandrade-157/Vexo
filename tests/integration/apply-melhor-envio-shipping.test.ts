/**
 * D3.2-B Ponto 2E — `apply_melhor_envio_shipping_to_order` (migration
 * 092). Diferente de `apply_shipping_to_order` (Etapa 12/D3.1), esta
 * função nunca relê nenhuma tabela de preço (não existe uma para Melhor
 * Envio) — por isso é `service_role`-only, nunca `anon`. A proteção real
 * contra preço manipulado está inteiramente em Node
 * (`features/shipping/melhor-envio-checkout.ts::verifyMelhorEnvioShippingFresh`,
 * coberto por testes unitários) — aqui o foco é: a RPC em si nunca é
 * alcançável por `anon`/`authenticated`, e aplica corretamente os
 * campos já verificados ao pedido, respeitando os mesmos guards de
 * `apply_shipping_to_order` (tenant, status PENDING, endereço
 * obrigatório).
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("apply_melhor_envio_shipping_to_order (D3.2-B Ponto 2E)", () => {
  let fx: Fixtures;

  async function insertOrder(tenantId: string, subtotal: number, status = "PENDING", shippingAddress: typeof ADDRESS | null = ADDRESS): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [tenantId, `PED${runId}${Math.floor(Math.random() * 100000)}`, status, "Cliente Teste", "cliente@example.com", "11912345678", shippingAddress, subtotal],
      );
      return rows[0]!.id;
    });
  }

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("applies a verified quote to a PENDING order: shipping_total/shipping_method/shipping_provider/shipping_estimated_days/shipping_reference/total all set from the parameters, never from any table", async () => {
    const orderId = await insertOrder(fx.tenantA, 100);

    await withSuperuser((c) =>
      c.query(
        "select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)",
        [fx.tenantA, orderId, "1", "PAC", 27.48, 10],
      ),
    );

    const { rows } = await withSuperuser((c) =>
      c.query(
        "select shipping_total, shipping_method, shipping_provider, shipping_estimated_days, shipping_reference, total from public.orders where id = $1",
        [orderId],
      ),
    );
    const order = rows[0]!;
    expect(Number(order.shipping_total)).toBe(27.48);
    expect(order.shipping_method).toBe("PAC");
    expect(order.shipping_provider).toBe("melhor_envio");
    expect(order.shipping_estimated_days).toBe(10);
    expect(order.shipping_reference).toBe("1");
    expect(Number(order.total)).toBe(127.48);
  });

  it("rejects an order that no longer belongs to the given tenant (cross-tenant)", async () => {
    const orderA = await insertOrder(fx.tenantA, 50);

    const err = await expectPgError(
      withSuperuser((c) => c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantB, orderA, "1", "PAC", 27.48, 10])),
    );
    expect(err.message).toMatch(/order not found for this store/);
  });

  it("rejects an order that is no longer PENDING", async () => {
    const orderId = await insertOrder(fx.tenantA, 50, "PAID");

    const err = await expectPgError(
      withSuperuser((c) => c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantA, orderId, "1", "PAC", 27.48, 10])),
    );
    expect(err.message).toMatch(/order can no longer be changed/);
  });

  it("rejects an order with no shipping_address (Melhor Envio never applies to pickup)", async () => {
    const orderId = await insertOrder(fx.tenantA, 50, "PENDING", null);

    const err = await expectPgError(
      withSuperuser((c) => c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantA, orderId, "1", "PAC", 27.48, 10])),
    );
    expect(err.message).toMatch(/order has no shipping address for this method/);
  });

  it("never uses shipping_methods — an order with zero rows in shipping_methods for the tenant still succeeds", async () => {
    // fx.tenantB never had any shipping_methods row inserted by this
    // file's setup — confirms this RPC truly never reads that table.
    const orderId = await insertOrder(fx.tenantB, 30);

    await withSuperuser((c) =>
      c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantB, orderId, "2", "SEDEX", 45.9, 3]),
    );

    const { rows } = await withSuperuser((c) => c.query("select shipping_total, shipping_provider from public.orders where id = $1", [orderId]));
    expect(Number(rows[0]!.shipping_total)).toBe(45.9);
    expect(rows[0]!.shipping_provider).toBe("melhor_envio");
  });

  it("service_role-only: neither anon nor authenticated have EXECUTE — this RPC can never be called directly with a fabricated price", async () => {
    const orderId = await insertOrder(fx.tenantA, 50);

    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, userId: fx.userAOwner }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantA, orderId, "1", "PAC", 0.01, 10])),
      );
      expect(err.message).toMatch(/permission denied/i);
    }

    // Confirma que a tentativa acima realmente não gravou nada (preço não foi aplicado).
    const { rows } = await withSuperuser((c) => c.query("select shipping_total from public.orders where id = $1", [orderId]));
    expect(Number(rows[0]!.shipping_total)).toBe(0);
  });

  it("orders_shipping_total_check still rejects a negative price even from a trusted caller (defense in depth)", async () => {
    const orderId = await insertOrder(fx.tenantA, 50);

    const err = await expectPgError(
      withSuperuser((c) => c.query("select public.apply_melhor_envio_shipping_to_order($1, $2, $3, $4, $5, $6)", [fx.tenantA, orderId, "1", "PAC", -5, 10])),
    );
    expect(err.message).toMatch(/check constraint/i);
  });
});
