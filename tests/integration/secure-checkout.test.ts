import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);
const OWNER_HASH_A = "a".repeat(64);
const OWNER_HASH_B = "b".repeat(64);
const ADDRESS = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

interface SecureCheckoutResult {
  orderId: string;
  created: boolean;
}

interface ShippingInput {
  kind: "none" | "method" | "melhor_envio";
  methodId?: string | null;
  expectedPrice?: number | null;
  serviceId?: string | null;
  serviceName?: string | null;
  price?: number | null;
  estimatedDays?: number | null;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Etapa 2A — secure cart checkout", () => {
  let fx: Fixtures;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();
    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);
      const createProduct = async (tenantId: string, label: string) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.products (tenant_id, name, slug, price, status)
           values ($1, $2, $3, 100, 'active') returning id`,
          [tenantId, `Produto seguro ${label}`, `produto-seguro-${label}-${runId}`],
        );
        await client.query(
          "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 10)",
          [tenantId, rows[0]!.id],
        );
        return rows[0]!.id;
      };
      productA = await createProduct(fx.tenantA, "a");
      productB = await createProduct(fx.tenantB, "b");
      await client.query("update public.shipping_settings set enabled = false where tenant_id in ($1, $2)", [fx.tenantA, fx.tenantB]);
    });
  });

  beforeEach(async () => {
    await withSuperuser(async (client) => {
      await client.query(
        "update public.product_inventory set stock_quantity = 100 where product_id in ($1, $2)",
        [productA, productB],
      );
      await client.query(
        "update public.shipping_settings set enabled = false where tenant_id in ($1, $2)",
        [fx.tenantA, fx.tenantB],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOwnedCart(tenantId: string, productId: string, ownerHash: string): Promise<string> {
    const cartId = randomUUID();
    await asActor(
      { role: "service_role" },
      async (client) => {
        await client.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [
          cartId,
          tenantId,
          ownerHash,
        ]);
        await client.query(
          "insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 2)",
          [cartId, tenantId, productId],
        );
      },
      { commit: true },
    );
    return cartId;
  }

  function checkout(
    tenantId: string,
    cartId: string,
    ownerHash: string,
    shipping: ShippingInput = { kind: "none" },
    overrides: Partial<{
      name: string;
      address: typeof ADDRESS | null;
      orderSource: "vexo_checkout" | "whatsapp";
      paymentChannel: "gateway" | "external";
      requestedPaymentMethod: string | null;
      cashChangeFor: number | null;
    }> = {},
  ) {
    return asActor(
      { role: "service_role" },
      (client) =>
        client.query<{ result: SecureCheckoutResult }>(
          `select public.checkout_cart_secure(
             $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
             $7::jsonb, $8::text, $9::text, $10::text, $11::numeric,
             $12::text, $13::uuid, $14::numeric, $15::text, $16::text,
             $17::numeric, $18::integer
           ) as result`,
          [
            tenantId,
            cartId,
            ownerHash,
            overrides.name ?? `Cliente seguro ${runId}`,
            `cliente-${runId}@example.com`,
            "+5511999999999",
            overrides.address === null ? null : JSON.stringify(overrides.address ?? ADDRESS),
            overrides.orderSource ?? "vexo_checkout",
            overrides.paymentChannel ?? "gateway",
            overrides.requestedPaymentMethod ?? null,
            overrides.cashChangeFor ?? null,
            shipping.kind,
            shipping.methodId ?? null,
            shipping.expectedPrice ?? null,
            shipping.serviceId ?? null,
            shipping.serviceName ?? null,
            shipping.price ?? null,
            shipping.estimatedDays ?? null,
          ],
        ),
      { commit: true },
    );
  }

  function actor(role: "anon" | "authenticated") {
    return role === "anon"
      ? ({ role } as const)
      : ({ role, userId: fx.userOutsider } as const);
  }

  const privilegedFunctions = [
    {
      name: "add_to_cart",
      signature: "public.add_to_cart(uuid,uuid,uuid,integer,uuid)",
      sql: "select public.add_to_cart(null::uuid, null::uuid, null::uuid, 1, null::uuid)",
    },
    {
      name: "create_order_from_cart",
      signature: "public.create_order_from_cart(uuid,uuid,text,text,text,jsonb,text,text,text,numeric)",
      sql: "select public.create_order_from_cart(null::uuid, null::uuid, 'x', 'x@example.com', 'x', null::jsonb, 'vexo_checkout', 'gateway', null, null)",
    },
    {
      name: "apply_shipping_to_order",
      signature: "public.apply_shipping_to_order(uuid,uuid,uuid,numeric)",
      sql: "select public.apply_shipping_to_order(null::uuid, null::uuid, null::uuid, 0)",
    },
    {
      name: "apply_melhor_envio_shipping_to_order",
      signature: "public.apply_melhor_envio_shipping_to_order(uuid,uuid,text,text,numeric,integer)",
      sql: "select public.apply_melhor_envio_shipping_to_order(null::uuid, null::uuid, '1', 'PAC', 1, 1)",
    },
    {
      name: "create_payment_for_order",
      signature: "public.create_payment_for_order(uuid,uuid,text)",
      sql: "select public.create_payment_for_order(null::uuid, null::uuid, 'mercadopago')",
    },
    {
      name: "attach_payment_preference",
      signature: "public.attach_payment_preference(uuid,uuid,text)",
      sql: "select public.attach_payment_preference(null::uuid, null::uuid, 'preference')",
    },
    {
      name: "checkout_cart_secure",
      signature: "public.checkout_cart_secure(uuid,uuid,text,text,text,text,jsonb,text,text,text,numeric,text,uuid,numeric,text,text,numeric,integer)",
      sql: "select public.checkout_cart_secure(null::uuid, null::uuid, repeat('a', 64), 'x', 'x@example.com', 'x', null::jsonb, 'vexo_checkout', 'gateway', null, null, 'none', null, null, null, null, null, null)",
    },
  ] as const;

  it.each(["anon", "authenticated"] as const)(
    "blocks %s from direct cart table access",
    async (role) => {
      for (const table of ["carts", "cart_items"] as const) {
        const selectError = await expectPgError(
          asActor(actor(role), (client) => client.query(`select * from public.${table} limit 1`)),
        );
        expect(selectError.message, `${role} SELECT ${table}`).toMatch(/permission denied/i);
      }
    },
  );

  it.each(["anon", "authenticated"] as const)(
    "blocks %s from every privileged cart/checkout RPC",
    async (role) => {
      for (const fn of privilegedFunctions) {
        const error = await expectPgError(asActor(actor(role), (client) => client.query(fn.sql)));
        expect(error.message, `${role} EXECUTE ${fn.name}`).toMatch(/permission denied/i);
      }
    },
  );

  it("has only the canonical function signatures and grants them exclusively to service_role", async () => {
    const state = await withSuperuser(async (client) => {
      const signatures = await client.query<{ name: string; signature: string }>(
        `select p.proname as name, oidvectortypes(p.proargtypes) as signature
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1::text[])
         order by p.proname, signature`,
        [privilegedFunctions.map((fn) => fn.name)],
      );
      const privileges = await Promise.all(
        privilegedFunctions.map(async (fn) => ({
          name: fn.name,
          anon: (await client.query<{ allowed: boolean }>(
            "select has_function_privilege('anon', $1, 'EXECUTE') as allowed",
            [fn.signature],
          )).rows[0]!.allowed,
          authenticated: (await client.query<{ allowed: boolean }>(
            "select has_function_privilege('authenticated', $1, 'EXECUTE') as allowed",
            [fn.signature],
          )).rows[0]!.allowed,
          serviceRole: (await client.query<{ allowed: boolean }>(
            "select has_function_privilege('service_role', $1, 'EXECUTE') as allowed",
            [fn.signature],
          )).rows[0]!.allowed,
        })),
      );
      const publicGrants = await client.query<{ name: string }>(
        `select distinct routine_name as name
         from information_schema.routine_privileges
         where routine_schema = 'public'
           and grantee = 'PUBLIC'
           and privilege_type = 'EXECUTE'
           and routine_name = any($1::text[])`,
        [privilegedFunctions.map((fn) => fn.name)],
      );
      return { signatures, privileges, publicGrants };
    });

    const expectedSignatures = privilegedFunctions
      .map((fn) => ({ name: fn.name, signature: fn.signature.slice(fn.signature.indexOf("(") + 1, -1).replaceAll(",", ", ") }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(state.signatures.rows).toEqual(expectedSignatures);
    expect(state.privileges).toEqual(
      expect.arrayContaining(
        privilegedFunctions.map((fn) => ({
          name: fn.name,
          anon: false,
          authenticated: false,
          serviceRole: true,
        })),
      ),
    );
    expect(state.publicGrants.rows).toEqual([]);
  });

  it("keeps SECURITY DEFINER functions on an empty search_path", async () => {
    const names = privilegedFunctions
      .filter((fn) => fn.name !== "add_to_cart")
      .map((fn) => fn.name);
    const result = await withSuperuser((client) =>
      client.query<{ name: string; security_definer: boolean; config: string[] | null }>(
        `select p.proname as name, p.prosecdef as security_definer, p.proconfig as config
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1::text[])
         order by p.proname`,
        [names],
      ),
    );
    expect(result.rows).toHaveLength(names.length);
    for (const row of result.rows) {
      expect(row.security_definer, row.name).toBe(true);
      expect(row.config?.some((entry) => entry.startsWith("search_path=") && !entry.includes("public")), row.name).toBe(true);
    }
  });

  it("rejects an authenticated outsider from the stock-restoring order status function", async () => {
    const error = await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (client) => client.query(
          "select public.update_order_status($1::uuid, $2::uuid, 'CANCELLED', null)",
          [fx.tenantA, randomUUID()],
        ),
      ),
    );
    expect(error.message).toMatch(/insufficient permission/i);
  });

  it("rejects anon direct RPC invocation before reading a cart", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const err = await expectPgError(
      asActor({ role: "anon" }, (client) =>
        client.query(
          `select public.checkout_cart_secure(
             $1::uuid, $2::uuid, $3::text, 'X', 'x@example.com', '+5511999999999',
             $4::jsonb, 'vexo', 'online', null, null, 'none', null, null, null, null, null, null
           )`,
          [fx.tenantA, cartId, OWNER_HASH_A, JSON.stringify(ADDRESS)],
        ),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);
  });

  it("creates a normal gateway order with canonical database values", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const result = await checkout(fx.tenantA, cartId, OWNER_HASH_A);
    const orderId = result.rows[0]!.result.orderId;
    const order = await withSuperuser((client) =>
      client.query(
        `select order_source, payment_channel, payment_status, subtotal, shipping_total, total
         from public.orders where id = $1`,
        [orderId],
      ),
    );
    expect(result.rows[0]!.result.created).toBe(true);
    expect(order.rows[0]).toMatchObject({
      order_source: "vexo_checkout",
      payment_channel: "gateway",
      payment_status: "PENDING",
    });
    expect(Number(order.rows[0]!.subtotal)).toBe(200);
    expect(Number(order.rows[0]!.shipping_total)).toBe(0);
    expect(Number(order.rows[0]!.total)).toBe(200);
  });

  it("does not misclassify the automatic stock reservation as a manual adjustment", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const inventory = await withSuperuser((client) =>
      client.query<{ id: string }>("select id from public.product_inventory where product_id = $1 and variant_id is null", [productA]),
    );

    await checkout(fx.tenantA, cartId, OWNER_HASH_A);

    const logs = await withSuperuser((client) =>
      client.query(
        `select 1 from public.audit_logs
         where resource_type = 'product_inventory'
           and resource_id = $1
           and action = 'PRODUCT_STOCK_ADJUSTED'`,
        [inventory.rows[0]!.id],
      ),
    );
    expect(logs.rows).toHaveLength(0);
  });

  it.each([
    { type: "own_delivery", label: "Entrega própria", price: 15, address: ADDRESS },
    { type: "pickup", label: "Retirada", price: 0, address: null },
  ] as const)("persists $type atomically with the final total", async ({ type, label, price, address }) => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const methodId = await withSuperuser(async (client) => {
      await client.query("update public.shipping_settings set enabled = true where tenant_id = $1", [fx.tenantA]);
      const { rows } = await client.query<{ id: string }>(
        `insert into public.shipping_methods (tenant_id, name, type, price, estimated_days, status)
         values ($1, $2, $3, $4, $5, 'active') returning id`,
        [fx.tenantA, `${label} ${runId}`, type, price, type === "pickup" ? null : 2],
      );
      return rows[0]!.id;
    });

    const result = await checkout(
      fx.tenantA,
      cartId,
      OWNER_HASH_A,
      { kind: "method", methodId, expectedPrice: price },
      { address },
    );
    const order = await withSuperuser((client) =>
      client.query(
        "select shipping_provider, shipping_total, total, shipping_address from public.orders where id = $1",
        [result.rows[0]!.result.orderId],
      ),
    );
    expect(order.rows[0]!.shipping_provider).toBe(type);
    expect(Number(order.rows[0]!.shipping_total)).toBe(price);
    expect(Number(order.rows[0]!.total)).toBe(200 + price);
    expect(order.rows[0]!.shipping_address === null).toBe(type === "pickup");
  });

  it("persists a server-verified Melhor Envio quote atomically", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    await withSuperuser((client) =>
      client.query("update public.shipping_settings set enabled = true where tenant_id = $1", [fx.tenantA]),
    );
    const result = await checkout(fx.tenantA, cartId, OWNER_HASH_A, {
      kind: "melhor_envio",
      serviceId: "2",
      serviceName: "SEDEX",
      price: 30,
      estimatedDays: 3,
    });
    const order = await withSuperuser((client) =>
      client.query(
        `select shipping_provider, shipping_reference, shipping_total,
                shipping_estimated_days, total
         from public.orders where id = $1`,
        [result.rows[0]!.result.orderId],
      ),
    );
    expect(order.rows[0]).toMatchObject({
      shipping_provider: "melhor_envio",
      shipping_reference: "2",
      shipping_estimated_days: 3,
    });
    expect(Number(order.rows[0]!.shipping_total)).toBe(30);
    expect(Number(order.rows[0]!.total)).toBe(230);
  });

  it("rolls back the whole checkout when stock is insufficient", async () => {
    const productId = await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.products (tenant_id, name, slug, price, status)
         values ($1, $2, $3, 75, 'active') returning id`,
        [fx.tenantA, `Produto sem estoque ${runId}`, `produto-sem-estoque-${runId}`],
      );
      await client.query(
        "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, 1)",
        [fx.tenantA, rows[0]!.id],
      );
      return rows[0]!.id;
    });
    const cartId = await createOwnedCart(fx.tenantA, productId, OWNER_HASH_A);
    const customerName = `Sem estoque ${runId}`;
    const error = await expectPgError(
      checkout(fx.tenantA, cartId, OWNER_HASH_A, { kind: "none" }, { name: customerName }),
    );
    expect(error.message).toMatch(/insufficient stock/i);

    const state = await withSuperuser(async (client) => ({
      items: await client.query("select quantity from public.cart_items where cart_id = $1", [cartId]),
      cart: await client.query("select checkout_order_id from public.carts where id = $1", [cartId]),
      orders: await client.query("select id from public.orders where customer_name = $1", [customerName]),
      stock: await client.query("select stock_quantity from public.product_inventory where product_id = $1", [productId]),
    }));
    expect(state.items.rows).toHaveLength(1);
    expect(state.cart.rows[0]!.checkout_order_id).toBeNull();
    expect(state.orders.rows).toHaveLength(0);
    expect(state.stock.rows[0]!.stock_quantity).toBe(1);
  });

  it("keeps one payment row across checkout retries", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const result = await checkout(fx.tenantA, cartId, OWNER_HASH_A);
    const orderId = result.rows[0]!.result.orderId;
    await asActor(
      { role: "service_role" },
      async (client) => {
        await client.query("select public.create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]);
        await client.query("select public.create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]);
      },
      { commit: true },
    );
    const payments = await withSuperuser((client) =>
      client.query("select amount from public.payments where order_id = $1", [orderId]),
    );
    expect(payments.rows).toHaveLength(1);
    expect(Number(payments.rows[0]!.amount)).toBe(200);
  });

  it("rejects another visitor's token and preserves cart, stock and orders", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const customerName = `Token inválido ${runId}`;
    const before = await withSuperuser((client) =>
      client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    );

    const err = await expectPgError(
      checkout(fx.tenantA, cartId, OWNER_HASH_B, { kind: "none" }, { name: customerName }),
    );
    expect(err.message).toMatch(/ownership could not be verified/i);

    const state = await withSuperuser(async (client) => ({
      items: await client.query("select quantity from public.cart_items where cart_id = $1", [cartId]),
      orders: await client.query("select 1 from public.orders where customer_name = $1", [customerName]),
      stock: await client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    }));
    expect(state.items.rows).toHaveLength(1);
    expect(state.orders.rows).toHaveLength(0);
    expect(state.stock.rows[0]!.stock_quantity).toBe(before.rows[0]!.stock_quantity);
  });

  it("rejects tenant hopping even with a valid token for the other tenant", async () => {
    const cartB = await createOwnedCart(fx.tenantB, productB, OWNER_HASH_B);
    const err = await expectPgError(checkout(fx.tenantA, cartB, OWNER_HASH_B));
    expect(err.message).toMatch(/ownership could not be verified/i);
  });

  it("returns one order for sequential and concurrent duplicate checkout", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const stockBefore = await withSuperuser((client) =>
      client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    );
    const [first, retry] = await Promise.all([
      checkout(fx.tenantA, cartId, OWNER_HASH_A),
      checkout(fx.tenantA, cartId, OWNER_HASH_A),
    ]);
    const firstResult = first.rows[0]!.result;
    const retryResult = retry.rows[0]!.result;

    expect(firstResult.orderId).toBe(retryResult.orderId);
    expect([firstResult.created, retryResult.created].sort()).toEqual([false, true]);

    const again = await checkout(fx.tenantA, cartId, OWNER_HASH_A);
    expect(again.rows[0]!.result).toEqual({ orderId: firstResult.orderId, created: false });

    const state = await withSuperuser(async (client) => ({
      orders: await client.query("select id from public.orders where id = $1", [firstResult.orderId]),
      stock: await client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    }));
    expect(state.orders.rows).toHaveLength(1);
    expect(state.stock.rows[0]!.stock_quantity).toBe(stockBefore.rows[0]!.stock_quantity - 2);
  });

  it("rolls back order, cart clearing and stock reservation when persisted shipping rejects a changed price", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const stockBefore = await withSuperuser((client) =>
      client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    );
    const methodId = await withSuperuser(async (client) => {
      await client.query("update public.shipping_settings set enabled = true where tenant_id = $1", [fx.tenantA]);
      const { rows } = await client.query<{ id: string }>(
        "insert into public.shipping_methods (tenant_id, name, price, status) values ($1, $2, 25, 'active') returning id",
        [fx.tenantA, `Frete seguro ${runId}`],
      );
      return rows[0]!.id;
    });

    const err = await expectPgError(
      checkout(fx.tenantA, cartId, OWNER_HASH_A, { kind: "method", methodId, expectedPrice: 1 }),
    );
    expect(err.message).toMatch(/shipping price has changed/i);

    const state = await withSuperuser(async (client) => ({
      cart: await client.query("select checkout_order_id from public.carts where id = $1", [cartId]),
      items: await client.query("select quantity from public.cart_items where cart_id = $1", [cartId]),
      stock: await client.query("select stock_quantity from public.product_inventory where product_id = $1", [productA]),
    }));
    expect(state.cart.rows[0]!.checkout_order_id).toBeNull();
    expect(state.items.rows).toHaveLength(1);
    expect(state.stock.rows[0]!.stock_quantity).toBe(stockBefore.rows[0]!.stock_quantity);
    await withSuperuser((client) => client.query("update public.shipping_settings set enabled = false where tenant_id = $1", [fx.tenantA]));
  });

  it("rolls back when Melhor Envio persistence lacks the required address", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const err = await expectPgError(
      checkout(
        fx.tenantA,
        cartId,
        OWNER_HASH_A,
        { kind: "melhor_envio", serviceId: "2", serviceName: "SEDEX", price: 30, estimatedDays: 3 },
        { address: null },
      ),
    );
    expect(err.message).toMatch(/no shipping address/i);

    const state = await withSuperuser(async (client) => ({
      items: await client.query("select quantity from public.cart_items where cart_id = $1", [cartId]),
      cart: await client.query("select checkout_order_id from public.carts where id = $1", [cartId]),
    }));
    expect(state.items.rows).toHaveLength(1);
    expect(state.cart.rows[0]!.checkout_order_id).toBeNull();
  });

  it("preserves the WhatsApp business channel inside the same secure transaction", async () => {
    const cartId = await createOwnedCart(fx.tenantA, productA, OWNER_HASH_A);
    const result = await checkout(fx.tenantA, cartId, OWNER_HASH_A, { kind: "none" }, {
      orderSource: "whatsapp",
      paymentChannel: "external",
      requestedPaymentMethod: "pix",
    });
    const orderId = result.rows[0]!.result.orderId;
    const order = await withSuperuser((client) =>
      client.query("select order_source, payment_channel, payment_status from public.orders where id = $1", [orderId]),
    );
    expect(order.rows[0]).toMatchObject({
      order_source: "whatsapp",
      payment_channel: "external",
      payment_status: "EXTERNAL",
    });
  });
});
