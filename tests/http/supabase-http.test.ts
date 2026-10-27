import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool, withSuperuser } from "../integration/helpers/db";
import { giveUnlimitedPlan } from "../integration/helpers/fixtures";
import { CART_ITEMS_SELECT } from "../../features/cart/cart-query";

const runId = randomUUID().slice(0, 8);
const apiUrl = process.env.SUPABASE_HTTP_URL ?? "";
const anonKey = process.env.SUPABASE_HTTP_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_HTTP_SERVICE_ROLE_KEY ?? "";
const jwtSecret = process.env.SUPABASE_HTTP_JWT_SECRET ?? "";

const ADDRESS = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

type HttpActor = "anon" | "authenticated" | "service_role";

interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
}

interface AuthSession {
  accessToken: string;
  userId: string;
}

interface CheckoutResult {
  orderId: string;
  created: boolean;
}

let authenticatedToken = "";
let userA = "";
let userB = "";
let tenantA = "";
let tenantB = "";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signJwt(payload: Record<string, unknown>): string {
  const unsigned = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson(payload)}`;
  const signature = createHmac("sha256", jwtSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Auth returned an invalid JWT shape");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function bearerFor(actor: HttpActor, token?: string): string {
  if (token) return token;
  if (actor === "authenticated") return authenticatedToken;
  return actor === "service_role" ? serviceRoleKey : anonKey;
}

async function http(
  path: string,
  options: {
    actor?: HttpActor;
    token?: string;
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const actor = options.actor ?? "anon";
  const key = actor === "service_role" ? serviceRoleKey : anonKey;
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${bearerFor(actor, options.token)}`,
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

async function signUp(label: string): Promise<AuthSession> {
  const email = `${label}-${runId}@http.local`;
  const response = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: `VexoHttp-${runId}-A9!` }),
  });
  const body = (await response.json()) as { access_token?: unknown; user?: { id?: unknown }; msg?: unknown };
  if (!response.ok || typeof body.access_token !== "string" || typeof body.user?.id !== "string") {
    throw new Error(`Local Supabase Auth signup failed with HTTP ${response.status}`);
  }
  return { accessToken: body.access_token, userId: body.user.id };
}

function expectDenied(result: HttpResult): void {
  expect([401, 403]).toContain(result.status);
  expect(result.ok).toBe(false);
}

function unwrapCheckout(body: unknown): CheckoutResult {
  const row = Array.isArray(body) ? body[0] : body;
  const value = row && typeof row === "object" && "result" in row ? (row as { result: unknown }).result : row;
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { orderId?: unknown }).orderId !== "string" ||
    typeof (value as { created?: unknown }).created !== "boolean"
  ) {
    throw new Error("PostgREST returned an invalid secure checkout response");
  }
  return value as CheckoutResult;
}

async function createProduct(tenantId: string, stock: number): Promise<{ productId: string; inventoryId: string }> {
  return withSuperuser(async (client) => {
    const suffix = randomUUID().slice(0, 8);
    const product = await client.query<{ id: string }>(
      `insert into public.products (tenant_id, name, slug, price, status)
       values ($1, $2, $3, 100, 'active') returning id`,
      [tenantId, `Produto HTTP ${suffix}`, `produto-http-${runId}-${suffix}`],
    );
    const inventory = await client.query<{ id: string }>(
      `insert into public.product_inventory (tenant_id, product_id, stock_quantity)
       values ($1, $2, $3) returning id`,
      [tenantId, product.rows[0]!.id, stock],
    );
    return { productId: product.rows[0]!.id, inventoryId: inventory.rows[0]!.id };
  });
}

async function createCart(tenantId: string, productId: string, ownerHash: string, quantity: number): Promise<string> {
  const cartId = randomUUID();
  await withSuperuser(async (client) => {
    await client.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [
      cartId,
      tenantId,
      ownerHash,
    ]);
    await client.query(
      "insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, $4)",
      [cartId, tenantId, productId, quantity],
    );
  });
  return cartId;
}

function checkoutPayload(
  tenantId: string,
  cartId: string,
  ownerHash: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const suffix = randomUUID().slice(0, 8);
  return {
    p_tenant_id: tenantId,
    p_cart_id: cartId,
    p_owner_token_hash: ownerHash,
    p_customer_name: `Cliente HTTP ${suffix}`,
    p_customer_email: `cliente-${runId}-${suffix}@example.com`,
    p_customer_phone: "+5511999999999",
    p_shipping_address: ADDRESS,
    p_order_source: "vexo_checkout",
    p_payment_channel: "gateway",
    p_requested_payment_method: null,
    p_cash_change_for: null,
    p_shipping_kind: "none",
    p_shipping_method_id: null,
    p_expected_shipping_price: null,
    p_me_service_id: null,
    p_me_service_name: null,
    p_me_price: null,
    p_me_estimated_days: null,
    ...overrides,
  };
}

function secureCheckout(payload: Record<string, unknown>, actor: HttpActor = "service_role") {
  return http("/rest/v1/rpc/checkout_cart_secure", { actor, method: "POST", body: payload });
}

describe.skipIf(!process.env.RUN_SUPABASE_HTTP_TESTS).sequential("Etapa 2A.2 — real Supabase Auth and PostgREST HTTP", () => {
  beforeAll(async () => {
    if (!apiUrl || !anonKey || !serviceRoleKey || !jwtSecret) {
      throw new Error("Local Supabase HTTP environment is incomplete");
    }

    const [sessionA, sessionB] = await Promise.all([signUp("owner-a"), signUp("owner-b")]);
    authenticatedToken = sessionA.accessToken;
    userA = sessionA.userId;
    userB = sessionB.userId;

    await withSuperuser(async (client) => {
      const roles = await client.query<{ id: string }>("select id from public.roles where key = 'OWNER'");
      const ownerRoleId = roles.rows[0]?.id;
      if (!ownerRoleId) throw new Error("OWNER role fixture is missing");

      const tenantARow = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        ["HTTP Tenant A", `http-tenant-a-${runId}`, userA],
      );
      const tenantBRow = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        ["HTTP Tenant B", `http-tenant-b-${runId}`, userB],
      );
      tenantA = tenantARow.rows[0]!.id;
      tenantB = tenantBRow.rows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3), ($4, $5, $3)",
        [tenantA, userA, ownerRoleId, tenantB, userB],
      );
      await giveUnlimitedPlan(client, [tenantA, tenantB]);
    });
  }, 30_000);

  beforeEach(async () => {
    if (!tenantA || !tenantB) return;
    await withSuperuser((client) =>
      client.query("update public.shipping_settings set enabled = false where tenant_id in ($1, $2)", [tenantA, tenantB]),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("issues a JWT through local Auth and verifies the session through HTTP", async () => {
    const claims = decodeJwtPayload(authenticatedToken);
    expect(claims.role).toBe("authenticated");
    expect(claims.sub).toBe(userA);
    expect(Number(claims.exp)).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const user = await http("/auth/v1/user", { actor: "authenticated" });
    expect(user.status).toBe(200);
    expect(user.body).toMatchObject({ id: userA });
  });

  it("rejects invalid, manipulated and expired JWTs before PostgREST authorization", async () => {
    const parts = authenticatedToken.split(".");
    const signature = parts[2] ?? "";
    const manipulated = `${parts[0]}.${parts[1]}.${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    const expired = signJwt({
      aud: "authenticated",
      role: "authenticated",
      sub: userA,
      iat: Math.floor(Date.now() / 1000) - 120,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    for (const token of ["not-a-jwt", manipulated, expired]) {
      const result = await http("/rest/v1/tenants?select=id&limit=1", { actor: "authenticated", token });
      expect(result.status).toBe(401);
    }
  });

  it("applies authenticated tenant RLS over real PostgREST HTTP", async () => {
    const result = await http("/rest/v1/tenant_members?select=tenant_id,user_id", { actor: "authenticated" });
    expect(result.status).toBe(200);
    const rows = result.body as Array<{ tenant_id: string; user_id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === tenantA)).toBe(true);
    expect(rows.some((row) => row.tenant_id === tenantB)).toBe(false);
  });

  it("blocks anon and authenticated direct access to protected cart tables while service_role succeeds", async () => {
    const { productId } = await createProduct(tenantA, 10);
    const cartId = await createCart(tenantA, productId, "a".repeat(64), 1);
    const path = `/rest/v1/carts?id=eq.${cartId}&select=id,tenant_id`;

    expectDenied(await http(path, { actor: "anon" }));
    expectDenied(await http(path, { actor: "authenticated" }));
    const privileged = await http(path, { actor: "service_role" });
    expect(privileged.status).toBe(200);
    expect(privileged.body).toEqual([{ id: cartId, tenant_id: tenantA }]);
  });

  it("reads the real cart projection including product and optional variant through the BFF role", async () => {
    const { productId } = await createProduct(tenantA, 10);
    const cartId = await createCart(tenantA, productId, "a".repeat(64), 2);
    const query = new URLSearchParams({ cart_id: `eq.${cartId}`, tenant_id: `eq.${tenantA}`, select: CART_ITEMS_SELECT });
    const result = await http(`/rest/v1/cart_items?${query}`, { actor: "service_role" });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({ quantity: 2, product: expect.objectContaining({ id: productId, price: 100 }), variant: null }),
    ]);
  });

  it.each(["anon", "authenticated"] as const)("blocks every privileged checkout RPC for %s over HTTP", async (actor) => {
    const calls = [
      ["add_to_cart", { p_tenant_id: tenantA, p_cart_id: null, p_product_id: null, p_quantity: 1, p_variant_id: null }],
      [
        "create_order_from_cart",
        {
          p_tenant_id: tenantA,
          p_cart_id: null,
          p_customer_name: "X",
          p_customer_email: "x@example.com",
          p_customer_phone: "x",
          p_shipping_address: null,
          p_order_source: "vexo_checkout",
          p_payment_channel: "gateway",
          p_requested_payment_method: null,
          p_cash_change_for: null,
        },
      ],
      ["create_payment_for_order", { p_tenant_id: tenantA, p_order_id: null, p_provider: "mercadopago" }],
      ["checkout_cart_secure", checkoutPayload(tenantA, randomUUID(), "a".repeat(64))],
    ] as const;

    for (const [name, body] of calls) {
      expectDenied(await http(`/rest/v1/rpc/${name}`, { actor, method: "POST", body }));
    }
  });

  it("blocks an authenticated user from creating a platform administrator through the public API", async () => {
    const result = await http("/rest/v1/platform_admins", {
      actor: "authenticated",
      method: "POST",
      body: { user_id: userA, role: "MASTER" },
      headers: { prefer: "return=representation" },
    });
    expectDenied(result);
  });

  it("rejects another visitor's ownership hash without changing orders, cart or stock", async () => {
    const { productId, inventoryId } = await createProduct(tenantA, 10);
    const cartId = await createCart(tenantA, productId, "a".repeat(64), 2);
    const email = `wrong-owner-${runId}@example.com`;
    const result = await secureCheckout(
      checkoutPayload(tenantA, cartId, "b".repeat(64), { p_customer_email: email }),
    );
    expect(result.ok).toBe(false);

    await withSuperuser(async (client) => {
      const orders = await client.query("select 1 from public.orders where customer_email = $1", [email]);
      const inventory = await client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where id = $1",
        [inventoryId],
      );
      const items = await client.query("select 1 from public.cart_items where cart_id = $1", [cartId]);
      expect(orders.rowCount).toBe(0);
      expect(inventory.rows[0]!.stock_quantity).toBe(10);
      expect(items.rowCount).toBe(1);
    });
  });

  it("rejects tenant hopping even with a valid cart ownership hash", async () => {
    const { productId } = await createProduct(tenantA, 10);
    const cartId = await createCart(tenantA, productId, "c".repeat(64), 1);
    const result = await secureCheckout(checkoutPayload(tenantB, cartId, "c".repeat(64)));
    expect(result.ok).toBe(false);
    const orders = await withSuperuser((client) =>
      client.query("select 1 from public.orders where tenant_id = $1 and customer_email like $2", [tenantB, `cliente-${runId}-%`]),
    );
    expect(orders.rowCount).toBe(0);
  });

  it("returns one order for simultaneous duplicate checkout requests", async () => {
    const { productId, inventoryId } = await createProduct(tenantA, 10);
    const cartId = await createCart(tenantA, productId, "d".repeat(64), 2);
    const email = `duplicate-${runId}-${randomUUID().slice(0, 8)}@example.com`;
    const payload = checkoutPayload(tenantA, cartId, "d".repeat(64), { p_customer_email: email });
    const responses = await Promise.all([secureCheckout(payload), secureCheckout(payload)]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const results = responses.map((response) => unwrapCheckout(response.body));
    expect(new Set(results.map((result) => result.orderId)).size).toBe(1);
    expect(results.filter((result) => result.created).length).toBe(1);

    await withSuperuser(async (client) => {
      const orders = await client.query("select 1 from public.orders where customer_email = $1", [email]);
      const inventory = await client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where id = $1",
        [inventoryId],
      );
      expect(orders.rowCount).toBe(1);
      expect(inventory.rows[0]!.stock_quantity).toBe(8);
    });
  });

  it("serializes competing stock reservations so only one order can consume limited stock", async () => {
    const { productId, inventoryId } = await createProduct(tenantA, 5);
    const cartA = await createCart(tenantA, productId, "e".repeat(64), 4);
    const cartB = await createCart(tenantA, productId, "f".repeat(64), 4);
    const responses = await Promise.all([
      secureCheckout(checkoutPayload(tenantA, cartA, "e".repeat(64))),
      secureCheckout(checkoutPayload(tenantA, cartB, "f".repeat(64))),
    ]);
    expect(responses.filter((response) => response.ok).length).toBe(1);
    expect(responses.filter((response) => !response.ok).length).toBe(1);

    await withSuperuser(async (client) => {
      const inventory = await client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where id = $1",
        [inventoryId],
      );
      const orders = await client.query(
        "select 1 from public.order_items where product_id = $1 and quantity = 4",
        [productId],
      );
      expect(inventory.rows[0]!.stock_quantity).toBe(1);
      expect(orders.rowCount).toBe(1);
    });
  });

  it("rolls back an insufficient-stock checkout and preserves its cart", async () => {
    const { productId, inventoryId } = await createProduct(tenantA, 1);
    const cartId = await createCart(tenantA, productId, "1".repeat(64), 2);
    const email = `stock-${runId}-${randomUUID().slice(0, 8)}@example.com`;
    const result = await secureCheckout(
      checkoutPayload(tenantA, cartId, "1".repeat(64), { p_customer_email: email }),
    );
    expect(result.ok).toBe(false);

    await withSuperuser(async (client) => {
      const inventory = await client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where id = $1",
        [inventoryId],
      );
      const orders = await client.query("select 1 from public.orders where customer_email = $1", [email]);
      const items = await client.query("select 1 from public.cart_items where cart_id = $1", [cartId]);
      expect(inventory.rows[0]!.stock_quantity).toBe(1);
      expect(orders.rowCount).toBe(0);
      expect(items.rowCount).toBe(1);
    });
  });

  it("rolls back order, cart and stock when persisted shipping rejects a changed price", async () => {
    const { productId, inventoryId } = await createProduct(tenantA, 5);
    const cartId = await createCart(tenantA, productId, "2".repeat(64), 1);
    const methodId = await withSuperuser(async (client) => {
      await client.query("update public.shipping_settings set enabled = true where tenant_id = $1", [tenantA]);
      const method = await client.query<{ id: string }>(
        `insert into public.shipping_methods (tenant_id, name, type, price, estimated_days, status)
         values ($1, $2, 'own_delivery', 10, 2, 'active') returning id`,
        [tenantA, `Entrega HTTP ${runId}`],
      );
      return method.rows[0]!.id;
    });
    const email = `shipping-${runId}-${randomUUID().slice(0, 8)}@example.com`;
    const result = await secureCheckout(
      checkoutPayload(tenantA, cartId, "2".repeat(64), {
        p_customer_email: email,
        p_shipping_kind: "method",
        p_shipping_method_id: methodId,
        p_expected_shipping_price: 9,
      }),
    );
    expect(result.ok).toBe(false);

    await withSuperuser(async (client) => {
      const inventory = await client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where id = $1",
        [inventoryId],
      );
      const orders = await client.query("select 1 from public.orders where customer_email = $1", [email]);
      const items = await client.query("select 1 from public.cart_items where cart_id = $1", [cartId]);
      expect(inventory.rows[0]!.stock_quantity).toBe(5);
      expect(orders.rowCount).toBe(0);
      expect(items.rowCount).toBe(1);
    });
  });

  it("creates a WhatsApp order atomically without creating a gateway payment", async () => {
    const { productId } = await createProduct(tenantA, 5);
    const cartId = await createCart(tenantA, productId, "3".repeat(64), 1);
    const result = await secureCheckout(
      checkoutPayload(tenantA, cartId, "3".repeat(64), {
        p_order_source: "whatsapp",
        p_payment_channel: "external",
        p_requested_payment_method: "pix",
      }),
    );
    expect(result.status).toBe(200);
    const checkout = unwrapCheckout(result.body);

    await withSuperuser(async (client) => {
      const order = await client.query<{ order_source: string; payment_channel: string }>(
        "select order_source, payment_channel from public.orders where id = $1",
        [checkout.orderId],
      );
      const payments = await client.query("select 1 from public.payments where order_id = $1", [checkout.orderId]);
      expect(order.rows[0]).toMatchObject({ order_source: "whatsapp", payment_channel: "external" });
      expect(payments.rowCount).toBe(0);
    });
  });

  it("prepares one local Mercado Pago payment row across repeated HTTP RPC calls", async () => {
    const { productId } = await createProduct(tenantA, 5);
    const cartId = await createCart(tenantA, productId, "4".repeat(64), 1);
    const checkoutResponse = await secureCheckout(checkoutPayload(tenantA, cartId, "4".repeat(64)));
    expect(checkoutResponse.status).toBe(200);
    const checkout = unwrapCheckout(checkoutResponse.body);
    const payload = { p_tenant_id: tenantA, p_order_id: checkout.orderId, p_provider: "mercadopago" };

    const first = await http("/rest/v1/rpc/create_payment_for_order", {
      actor: "service_role",
      method: "POST",
      body: payload,
    });
    const second = await http("/rest/v1/rpc/create_payment_for_order", {
      actor: "service_role",
      method: "POST",
      body: payload,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const payment = await withSuperuser((client) =>
      client.query<{ amount: string; status: string }>(
        "select amount, status from public.payments where order_id = $1 and provider = 'mercadopago'",
        [checkout.orderId],
      ),
    );
    expect(payment.rowCount).toBe(1);
    expect(payment.rows[0]!.status).toBe("PENDING");
    expect(Number(payment.rows[0]!.amount)).toBe(100);
  });
});
