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

  async function insertOrder(
    tenantId: string,
    subtotal: number,
    status = "PENDING",
    shippingAddress: typeof ADDRESS | null = ADDRESS,
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [tenantId, `PED${runId}${Math.floor(Math.random() * 100000)}`, status, "Cliente Teste", "cliente@example.com", "11912345678", shippingAddress, subtotal],
      );
      return rows[0]!.id;
    });
  }

  async function insertMethod(
    tenantId: string,
    opts: { name?: string; price?: number; status?: string; estimatedDays?: number | null; type?: "flat_rate" | "own_delivery" | "pickup" } = {},
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.shipping_methods (tenant_id, name, price, status, estimated_days, type)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          tenantId,
          opts.name ?? `Padrão ${randomUUID().slice(0, 6)}`,
          opts.price ?? 15.5,
          opts.status ?? "active",
          opts.estimatedDays ?? 5,
          opts.type ?? "flat_rate",
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

/**
 * D3.1 — retirada na loja + entrega própria básica (migration
 * 20260817220086). Mesmo padrão de fixtures/helpers do describe acima —
 * foco só no que é novo: os dois tipos de modalidade, o endereço do
 * pedido virando opcional, e a revalidação de apply_shipping_to_order
 * ciente de pickup.
 */
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("D3.1 — retirada na loja + entrega própria", () => {
  let fx: Fixtures;

  async function insertOrder(
    tenantId: string,
    subtotal: number,
    status = "PENDING",
    shippingAddress: typeof ADDRESS | null = ADDRESS,
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [tenantId, `PEDD31${runId}${Math.floor(Math.random() * 100000)}`, status, "Cliente Teste", "cliente@example.com", "11912345678", shippingAddress, subtotal],
      );
      return rows[0]!.id;
    });
  }

  async function insertMethod(
    tenantId: string,
    opts: { name?: string; price?: number; status?: string; estimatedDays?: number | null; type?: "flat_rate" | "own_delivery" | "pickup" } = {},
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.shipping_methods (tenant_id, name, price, status, estimated_days, type)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          tenantId,
          opts.name ?? `D31-${randomUUID().slice(0, 6)}`,
          opts.price ?? 15.5,
          opts.status ?? "active",
          opts.estimatedDays ?? 5,
          opts.type ?? "flat_rate",
        ],
      );
      return rows[0]!.id;
    });
  }

  // shipping_methods_tenant_singleton_type_idx (migration 086) allows only
  // one pickup and one own_delivery row per tenant — most tests below need
  // their own throwaway tenant so they don't collide with each other over
  // the same singleton slot (fx.tenantA/tenantB are shared with the whole
  // describe block, unlike asActor's default-rollback transactions).
  async function createExtraTenant(label: string): Promise<string> {
    return withSuperuser(async (client) => {
      const tag = `${label}-${runId}-${randomUUID().slice(0, 6)}`;
      const { rows: userRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`${tag}@fixtures.test`],
      );
      const { rows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [tag, tag, userRows[0]!.id],
      );
      return rows[0]!.id;
    });
  }

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  // shipping_methods_type_check foi estendida (migration 086) para aceitar os dois novos tipos e continuar rejeitando qualquer outro.
  it("shipping_methods.type accepts 'pickup' and 'own_delivery', and still rejects an unknown type", async () => {
    const tenantId = await createExtraTenant("type-check");
    await expect(insertMethod(tenantId, { type: "pickup", price: 0, name: `Pickup-${runId}` })).resolves.toBeTruthy();
    await expect(insertMethod(tenantId, { type: "own_delivery", price: 9, name: `OwnDelivery-${runId}` })).resolves.toBeTruthy();

    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.shipping_methods (tenant_id, name, price, type) values ($1, $2, 10, 'melhor_envio')", [
          tenantId,
          `Invalida-${runId}`,
        ]),
      ),
    );
    expect(err.message).toMatch(/shipping_methods_type_check|check constraint/i);
  });

  // Retirada na loja nunca tem preço — o preço final é sempre 0, garantido pelo banco, nunca só pela UI/Zod.
  it("shipping_methods_pickup_price_zero_check rejects a pickup row with a non-zero price", async () => {
    const tenantId = await createExtraTenant("price-zero");
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.shipping_methods (tenant_id, name, price, type) values ($1, $2, 10, 'pickup')", [
          tenantId,
          `PickupCaro-${runId}`,
        ]),
      ),
    );
    expect(err.message).toMatch(/shipping_methods_pickup_price_zero_check|check constraint/i);

    await expect(insertMethod(tenantId, { type: "pickup", price: 0, name: `PickupGratis-${runId}` })).resolves.toBeTruthy();
  });

  // No máximo uma linha de pickup e uma de own_delivery por tenant; flat_rate continua sem essa restrição (regressão).
  it("enforces at most one pickup and one own_delivery row per tenant, while flat_rate stays an unrestricted list", async () => {
    const tenantId = await createExtraTenant("singleton");
    await insertMethod(tenantId, { type: "pickup", price: 0, name: `Pickup2a-${runId}` });
    const dupPickup = await expectPgError(insertMethod(tenantId, { type: "pickup", price: 0, name: `Pickup2b-${runId}` }));
    expect(dupPickup.message).toMatch(/duplicate key|unique constraint/i);

    await insertMethod(tenantId, { type: "own_delivery", price: 5, name: `OwnDelivery2a-${runId}` });
    const dupOwnDelivery = await expectPgError(
      insertMethod(tenantId, { type: "own_delivery", price: 7, name: `OwnDelivery2b-${runId}` }),
    );
    expect(dupOwnDelivery.message).toMatch(/duplicate key|unique constraint/i);

    // flat_rate: duas linhas para o mesmo tenant continuam permitidas (regressão do modelo de lista livre).
    await expect(insertMethod(tenantId, { type: "flat_rate", name: `Flat2a-${runId}` })).resolves.toBeTruthy();
    await expect(insertMethod(tenantId, { type: "flat_rate", name: `Flat2b-${runId}` })).resolves.toBeTruthy();
  });

  // orders.shipping_address agora aceita nulo (retirada na loja) sem precisar tocar na constraint de chaves.
  it("orders.shipping_address accepts null, and the key-completeness check still applies when it isn't null (regression)", async () => {
    await expect(insertOrder(fx.tenantA, 50, "PENDING", null)).resolves.toBeTruthy();

    const err = await expectPgError(
      withSuperuser((c) =>
        c.query(
          `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
           values ($1, $2, 'PENDING', $3, $4, $5, $6, 50, 50)`,
          [fx.tenantA, `PEDINVALID${runId}`, "Cliente", "cliente@example.com", "11900000000", { zip: "01310100" }],
        ),
      ),
    );
    expect(err.message).toMatch(/orders_shipping_address_check|check constraint/i);
  });

  // Caminho feliz de pickup: endereço do cliente é zerado, nunca substituído pelo endereço da loja; modalidade/prazo ficam no snapshot.
  it("apply_shipping_to_order applies pickup: nulls out shipping_address (never fabricating or reusing the store's), snapshots the modality", async () => {
    const tenantId = await createExtraTenant("pickup-happy");
    const pickupId = await insertMethod(tenantId, { type: "pickup", price: 0, estimatedDays: 1, name: `PickupFeliz-${runId}` });
    const orderId = await insertOrder(tenantId, 80); // criado com endereço do cliente, como no fluxo real (create_order_from_cart roda antes)

    await asActor(
      { role: "anon" },
      (c) => c.query("select apply_shipping_to_order($1, $2, $3, 0)", [tenantId, orderId, pickupId]),
      { commit: true },
    );

    const order = await withSuperuser((c) =>
      c.query(
        "select shipping_address, shipping_total, shipping_method, shipping_provider, shipping_estimated_days, total from public.orders where id = $1",
        [orderId],
      ),
    );
    expect(order.rows[0]).toMatchObject({
      shipping_address: null,
      shipping_total: "0.00",
      shipping_method: `PickupFeliz-${runId}`,
      shipping_provider: "pickup",
      shipping_estimated_days: 1,
      total: "80.00",
    });
  });

  // Caminho feliz de entrega própria: reaproveita o mesmo provedor/RPC de flat_rate, endereço do cliente é preservado.
  it("apply_shipping_to_order applies own_delivery like flat_rate, keeping the customer's shipping_address untouched", async () => {
    const tenantId = await createExtraTenant("own-delivery-happy");
    const ownDeliveryId = await insertMethod(tenantId, { type: "own_delivery", price: 12, estimatedDays: 2, name: `OwnDeliveryFeliz-${runId}` });
    const orderId = await insertOrder(tenantId, 80);

    await asActor(
      { role: "anon" },
      (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [tenantId, orderId, ownDeliveryId]),
      { commit: true },
    );

    const order = await withSuperuser((c) =>
      c.query("select shipping_address, shipping_total, shipping_provider, total from public.orders where id = $1", [orderId]),
    );
    expect(order.rows[0]!.shipping_address).toEqual(ADDRESS);
    expect(order.rows[0]).toMatchObject({ shipping_total: "12.00", shipping_provider: "own_delivery", total: "92.00" });
  });

  // Nunca inventa um endereço do cliente: aplicar uma modalidade que não é pickup a um pedido sem endereço é rejeitado, não silenciosamente aceito.
  it("apply_shipping_to_order rejects a non-pickup method on an order that has no shipping_address", async () => {
    const tenantId = await createExtraTenant("no-address");
    const ownDeliveryId = await insertMethod(tenantId, { type: "own_delivery", price: 12, name: `OwnDeliverySemEndereco-${runId}` });
    const orderId = await insertOrder(tenantId, 50, "PENDING", null);

    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 12)", [tenantId, orderId, ownDeliveryId])),
    );
    expect(err.message).toMatch(/order has no shipping address for this method/i);
  });

  // Isolamento multi-tenant, especificamente para os dois novos tipos (a regra genérica já existe acima para flat_rate).
  it("tenant A cannot apply tenant B's pickup or own_delivery method to its own order", async () => {
    const tenantOther = await createExtraTenant("cross-tenant");
    const pickupB = await insertMethod(tenantOther, { type: "pickup", price: 0, name: `PickupB-${runId}` });
    const ownDeliveryB = await insertMethod(tenantOther, { type: "own_delivery", price: 12, name: `OwnDeliveryB-${runId}` });
    const orderA = await insertOrder(fx.tenantA, 50);

    for (const [methodId, price] of [[pickupB, 0], [ownDeliveryB, 12]] as const) {
      const err = await expectPgError(
        asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, $4)", [fx.tenantA, orderA, methodId, price])),
      );
      expect(err.message).toMatch(/shipping method not available/i);
    }
  });

  // Manipulação de preço: preço divergente também é rejeitado para os dois novos tipos (regra genérica, exercitada aqui de novo por exigência explícita do prompt).
  it("apply_shipping_to_order rejects a manipulated price for pickup and own_delivery, same as flat_rate", async () => {
    const tenantId = await createExtraTenant("price-manipulation");
    const pickupId = await insertMethod(tenantId, { type: "pickup", price: 0, name: `PickupManipulado-${runId}` });
    const ownDeliveryId = await insertMethod(tenantId, { type: "own_delivery", price: 15, name: `OwnDeliveryManipulado-${runId}` });
    const orderId = await insertOrder(tenantId, 50);

    const errPickup = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 5)", [tenantId, orderId, pickupId])),
    );
    expect(errPickup.message).toMatch(/shipping price has changed/i);

    const errOwnDelivery = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select apply_shipping_to_order($1, $2, $3, 999)", [tenantId, orderId, ownDeliveryId])),
    );
    expect(errOwnDelivery.message).toMatch(/shipping price has changed/i);
  });

  // get_order_confirmation expõe a modalidade/prazo aplicados e nunca inventa um endereço quando é pickup.
  it("get_order_confirmation exposes shippingMethod/shippingProvider/shippingEstimatedDays and a null shippingAddress for a pickup order", async () => {
    const tenantId = await createExtraTenant("confirmation");
    const pickupId = await insertMethod(tenantId, { type: "pickup", price: 0, estimatedDays: 1, name: `PickupConfirmacao-${runId}` });
    const orderId = await insertOrder(tenantId, 40);

    await asActor(
      { role: "anon" },
      (c) => c.query("select apply_shipping_to_order($1, $2, $3, 0)", [tenantId, orderId, pickupId]),
      { commit: true },
    );

    const confirmation = await asActor({ role: "anon" }, (c) =>
      c.query("select get_order_confirmation($1, $2) as confirmation", [tenantId, orderId]),
    );
    const data = confirmation.rows[0]!.confirmation;
    expect(data.shippingAddress).toBeNull();
    expect(data.shippingMethod).toBe(`PickupConfirmacao-${runId}`);
    expect(data.shippingProvider).toBe("pickup");
    expect(data.shippingEstimatedDays).toBe(1);
  });
});

// Único fechamento do pool compartilhado do módulo — precisa rodar só depois dos dois describes acima, nunca entre eles.
afterAll(async () => {
  await pool.end();
});
