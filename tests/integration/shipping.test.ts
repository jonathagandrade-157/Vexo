/**
 * Etapa 12 — frete/entrega. Mesmo padrão de payments.test.ts (Etapa 11):
 * RLS/trigger/RPC testados diretamente via SQL (asActor). Foco: RLS
 * multi-tenant de shipping_settings/shipping_methods, leitura pública
 * (anon) escopada a lojas com entrega habilitada, e a revalidação
 * anti-manipulação de apply_shipping_to_order (nunca aceita o preço do
 * cliente como valor final, sempre relê shipping_methods.price).
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Frete/Entrega (Etapa 12)", () => {
  let fx: Fixtures;
  let userAOperator: string;

  async function insertOrder(tenantId: string, subtotal: number, status = "PENDING"): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [tenantId, `PED${runId}${Math.floor(Math.random() * 100000)}`, status, "Cliente Teste", "cliente@example.com", "11912345678", ADDRESS, subtotal],
      );
      return rows[0]!.id;
    });
  }

  async function insertMethod(
    tenantId: string,
    opts: { name?: string; price?: number; status?: string; estimatedDays?: number | null } = {},
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.shipping_methods (tenant_id, name, price, status, estimated_days)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          tenantId,
          opts.name ?? `Padrão ${randomUUID().slice(0, 6)}`,
          opts.price ?? 15.5,
          opts.status ?? "active",
          opts.estimatedDays ?? 5,
        ],
      );
      return rows[0]!.id;
    });
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`shipping-operator-${runId}@fixtures.test`],
      );
      userAOperator = rows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // RLS — só settings.update escreve shipping_settings; qualquer membro lê; outro tenant não vê nada.
  it("RLS: only settings.update can write shipping_settings; any tenant member can read; another tenant sees nothing", async () => {
    const deniedInsert = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.shipping_settings (tenant_id, enabled) values ($1, true)", [fx.tenantA]),
      ),
    );
    expect(deniedInsert.message).toMatch(/row-level security|permission denied/i);

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.shipping_settings (tenant_id, enabled, origin_zip) values ($1, true, '01310100')", [fx.tenantA]),
      { commit: true },
    );

    const readAsOperator = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("select enabled from public.shipping_settings where tenant_id = $1", [fx.tenantA]),
    );
    expect(readAsOperator.rows[0]!.enabled).toBe(true);

    const readAsTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.shipping_settings where tenant_id = $1", [fx.tenantA]),
    );
    expect(readAsTenantB.rows).toHaveLength(0);
  });

  // RLS — anon só vê shipping_settings de lojas com enabled = true.
  it("RLS: anon can only see shipping_settings rows with enabled = true", async () => {
    await withSuperuser((c) =>
      c.query("insert into public.shipping_settings (tenant_id, enabled) values ($1, false) on conflict (tenant_id) do update set enabled = false", [
        fx.tenantB,
      ]),
    );

    const anonSeesA = await asActor({ role: "anon" }, (c) =>
      c.query("select enabled from public.shipping_settings where tenant_id = $1", [fx.tenantA]),
    );
    expect(anonSeesA.rows).toHaveLength(1);

    const anonSeesB = await asActor({ role: "anon" }, (c) =>
      c.query("select 1 from public.shipping_settings where tenant_id = $1", [fx.tenantB]),
    );
    expect(anonSeesB.rows).toHaveLength(0);
  });

  // RLS — anon só vê shipping_methods ativas de lojas com entrega habilitada.
  it("RLS: anon can only see active shipping_methods of a tenant with shipping enabled", async () => {
    const activeId = await insertMethod(fx.tenantA, { name: `Ativa-${runId}`, status: "active" });
    const inactiveId = await insertMethod(fx.tenantA, { name: `Inativa-${runId}`, status: "inactive" });
    const tenantBMethodId = await insertMethod(fx.tenantB, { name: `TenantB-${runId}`, status: "active" });

    const anonView = await asActor({ role: "anon" }, (c) => c.query("select id from public.shipping_methods where tenant_id = $1", [fx.tenantA]));
    const visibleIds = anonView.rows.map((r: { id: string }) => r.id);
    expect(visibleIds).toContain(activeId);
    expect(visibleIds).not.toContain(inactiveId);

    // tenant B tem enabled = false (teste anterior) — mesmo com uma modalidade ativa, anon não vê nenhuma.
    const anonViewB = await asActor({ role: "anon" }, (c) => c.query("select id from public.shipping_methods where tenant_id = $1", [fx.tenantB]));
    expect(anonViewB.rows.map((r: { id: string }) => r.id)).not.toContain(tenantBMethodId);
  });

  // Unicidade de nome por tenant.
  it("shipping_methods enforces unique(tenant_id, name)", async () => {
    const name = `Duplicada-${runId}`;
    await insertMethod(fx.tenantA, { name });
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.shipping_methods (tenant_id, name, price) values ($1, $2, 9.9)", [fx.tenantA, name]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  // apply_shipping_to_order — caminho feliz: shipping_total/total/snapshot atualizados, preço sempre relido do banco.
  it("apply_shipping_to_order applies the current price and recalculates total, ignoring a stale expected price only for detection", async () => {
    const methodId = await insertMethod(fx.tenantA, { name: `Feliz-${runId}`, price: 22.5, estimatedDays: 3 });
    const orderId = await insertOrder(fx.tenantA, 100);

    await asActor(
      { role: "anon" },
      (c) => c.query("select apply_shipping_to_order($1, $2, $3, 22.5)", [fx.tenantA, orderId, methodId]),
      { commit: true },
    );

    const order = await withSuperuser((c) =>
      c.query(
        "select shipping_total, shipping_method, shipping_provider, shipping_estimated_days, total from public.orders where id = $1",
        [orderId],
      ),
    );
    expect(order.rows[0]).toMatchObject({
      shipping_total: "22.50",
      shipping_method: `Feliz-${runId}`,
      shipping_provider: "flat_rate",
      shipping_estimated_days: 3,
      total: "122.50",
    });
  });

  // Anti-manipulação — preço divergente do que o cliente "viu" é rejeitado, nunca aplicado silenciosamente.
  it("apply_shipping_to_order rejects when the expected price no longer matches shipping_methods.price", async () => {
    const methodId = await insertMethod(fx.tenantA, { price: 30 });
    const orderId = await insertOrder(fx.tenantA, 50);

    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 999)", [fx.tenantA, orderId, methodId])),
    );
    expect(err.message).toMatch(/shipping price has changed/i);

    const order = await withSuperuser((c) => c.query("select shipping_total from public.orders where id = $1", [orderId]));
    expect(order.rows[0]!.shipping_total).toBe("0.00");
  });

  // Modalidade inativa não pode ser aplicada.
  it("apply_shipping_to_order rejects an inactive shipping method", async () => {
    const methodId = await insertMethod(fx.tenantA, { price: 12, status: "inactive" });
    const orderId = await insertOrder(fx.tenantA, 50);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [fx.tenantA, orderId, methodId])),
    );
    expect(err.message).toMatch(/shipping method not available/i);
  });

  // Tenant hopping — modalidade de outro tenant não pode ser aplicada mesmo com o preço certo.
  it("apply_shipping_to_order rejects a shipping method that belongs to a different tenant", async () => {
    const methodId = await insertMethod(fx.tenantB, { price: 12 });
    const orderId = await insertOrder(fx.tenantA, 50);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [fx.tenantA, orderId, methodId])),
    );
    expect(err.message).toMatch(/shipping method not available/i);
  });

  // Tenant hopping — order_id de outro tenant não é afetado.
  it("apply_shipping_to_order rejects an order_id that doesn't belong to the given tenant", async () => {
    const methodId = await insertMethod(fx.tenantA, { price: 12 });
    const orderId = await insertOrder(fx.tenantB, 50);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [fx.tenantA, orderId, methodId])),
    );
    expect(err.message).toMatch(/order not found/i);
  });

  // Pedido que já avançou (nunca mais PENDING) não pode ter o frete alterado.
  it("apply_shipping_to_order rejects an order that is no longer PENDING", async () => {
    const methodId = await insertMethod(fx.tenantA, { price: 12 });
    const orderId = await insertOrder(fx.tenantA, 50, "PAID");
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [fx.tenantA, orderId, methodId])),
    );
    expect(err.message).toMatch(/order can no longer be changed/i);
  });

  // apply_shipping_to_order é anon-only — authenticated/service_role sem grant.
  it("apply_shipping_to_order is anon-only — authenticated and service_role have no execute grant", async () => {
    const methodId = await insertMethod(fx.tenantA, { price: 12 });
    const orderId = await insertOrder(fx.tenantA, 50);
    for (const actor of [{ role: "authenticated" as const, userId: fx.userAOwner }, { role: "service_role" as const }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [fx.tenantA, orderId, methodId])),
      );
      expect(err.message).toMatch(/permission denied/i);
    }
  });

  // orders.shipping_total agora aceita > 0 (Etapa 10/11 forçavam = 0); discount_total continua forçado a 0.
  it("orders_shipping_total_check now allows shipping_total > 0, while discount_total stays forced to 0", async () => {
    const orderId = await insertOrder(fx.tenantA, 50);
    await withSuperuser((c) => c.query("update public.orders set shipping_total = 9.9, total = 59.9 where id = $1", [orderId]));
    const order = await withSuperuser((c) => c.query("select shipping_total from public.orders where id = $1", [orderId]));
    expect(order.rows[0]!.shipping_total).toBe("9.90");

    const err = await expectPgError(
      withSuperuser((c) => c.query("update public.orders set discount_total = 5 where id = $1", [orderId])),
    );
    expect(err.message).toMatch(/orders_discount_total_check|check constraint/i);
  });

  // Auditoria — SHIPPING_SETTINGS_UPDATED e SHIPPING_METHOD_CREATED/UPDATED/DELETED são registrados.
  it("audit log records SHIPPING_SETTINGS_UPDATED and SHIPPING_METHOD_CREATED/UPDATED/DELETED", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.shipping_settings set origin_zip = '04567000' where tenant_id = $1", [fx.tenantA]),
      { commit: true },
    );

    let methodId = "";
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.shipping_methods (tenant_id, name, price) values ($1, $2, 19.9) returning id",
          [fx.tenantA, `Auditada-${runId}`],
        );
        methodId = rows[0]!.id;
      },
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.shipping_methods set price = 25 where id = $1", [methodId]),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("delete from public.shipping_methods where id = $1", [methodId]),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query<{ action: string }>(
        "select action from public.audit_logs where tenant_id = $1 and resource_type in ('shipping_settings', 'shipping_method') order by created_at",
        [fx.tenantA],
      ),
    );
    const actions = logs.rows.map((r) => r.action);
    expect(actions).toContain("SHIPPING_SETTINGS_UPDATED");
    expect(actions).toContain("SHIPPING_METHOD_CREATED");
    expect(actions).toContain("SHIPPING_METHOD_UPDATED");
    expect(actions).toContain("SHIPPING_METHOD_DELETED");
  });
});
