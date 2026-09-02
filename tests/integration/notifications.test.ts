/**
 * D14.1 — notificação interna de novo pedido (`public.notifications`,
 * migration 20260817220097). Mesmo princípio de sempre neste projeto:
 * RLS/trigger testados diretamente via SQL (asActor/withSuperuser), e a
 * criação do pedido reaproveita EXATAMENTE o mesmo caminho já testado em
 * tests/integration/checkout.test.ts (`create_order_from_cart` via
 * `anon`) — nunca uma segunda forma de criar pedido só para este teste.
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Notificação de novo pedido (D14.1)", () => {
  let fx: Fixtures;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const insertProduct = async (tenantId: string, name: string, price: number) => {
        const { rows } = await client.query<{ id: string }>(
          "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
          [tenantId, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`, price],
        );
        return rows[0]!.id;
      };
      productA = await insertProduct(fx.tenantA, "Notif Produto A", 100);
      productB = await insertProduct(fx.tenantB, "Notif Produto B", 70);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createCartWithItem(tenantId: string, productId: string): Promise<string> {
    const cartId = randomUUID();
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, tenantId]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [
          cartId,
          tenantId,
          productId,
        ]),
      { commit: true },
    );
    return cartId;
  }

  async function createOrder(tenantId: string, cartId: string): Promise<string> {
    const result = await asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          tenantId,
          cartId,
          "Maria Cliente",
          "maria@example.com",
          "11912345678",
          JSON.stringify(address),
        ]),
      { commit: true },
    );
    return result.rows[0]!.create_order_from_cart;
  }

  // 1/6 — criar um pedido gera exatamente uma notificação, correta.
  it("creating an order generates exactly one 'new_order' notification, correctly associated", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA);
    const orderId = await createOrder(fx.tenantA, cartId);

    const { rows } = await withSuperuser((c) =>
      c.query(
        "select tenant_id, type, resource_type, resource_id, read_at from public.notifications where resource_type = 'order' and resource_id = $1",
        [orderId],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(fx.tenantA);
    expect(rows[0]!.type).toBe("new_order");
    expect(rows[0]!.resource_type).toBe("order");
    expect(rows[0]!.resource_id).toBe(orderId);
    expect(rows[0]!.read_at).toBeNull();
  });

  // 2/6 — nenhuma duplicata: dois pedidos diferentes geram duas notificações distintas, nunca uma re-disparada por leitura.
  it("does not duplicate notifications — a second order creates a second, distinct notification", async () => {
    const cartId1 = await createCartWithItem(fx.tenantA, productA);
    const orderId1 = await createOrder(fx.tenantA, cartId1);
    const cartId2 = await createCartWithItem(fx.tenantA, productA);
    const orderId2 = await createOrder(fx.tenantA, cartId2);

    expect(orderId1).not.toBe(orderId2);

    const { rows } = await withSuperuser((c) =>
      c.query("select resource_id from public.notifications where resource_type = 'order' and resource_id = any($1)", [
        [orderId1, orderId2],
      ]),
    );
    expect(rows).toHaveLength(2);

    // Reler duas vezes (o painel faz isso a cada navegação) nunca cria linha nova.
    const { rows: reread } = await withSuperuser((c) =>
      c.query("select resource_id from public.notifications where resource_type = 'order' and resource_id = any($1)", [
        [orderId1, orderId2],
      ]),
    );
    expect(reread).toHaveLength(2);
  });

  // 3/6 — isolamento por tenant: um membro do tenant B nunca vê a notificação do tenant A.
  it("a member of tenant B cannot see tenant A's order notification", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA);
    const orderId = await createOrder(fx.tenantA, cartId);

    const { rows } = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.notifications where resource_type = 'order' and resource_id = $1", [orderId]),
    );
    expect(rows).toHaveLength(0);
  });

  // 4/6 — o próprio tenant (com orders.view) vê a notificação.
  it("the OWNER of the order's own tenant can see the notification", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA);
    const orderId = await createOrder(fx.tenantA, cartId);

    const { rows } = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id, resource_id from public.notifications where resource_type = 'order' and resource_id = $1", [orderId]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resource_id).toBe(orderId);
  });

  // 5/6 — marcar como lida funciona para o próprio tenant; tenant B não consegue marcar a notificação do tenant A como lida (RLS via USING, 0 linhas afetadas).
  it("the owning tenant can mark its notification as read; a different tenant cannot", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA);
    const orderId = await createOrder(fx.tenantA, cartId);

    const crossTenantUpdate = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("update public.notifications set read_at = now() where resource_type = 'order' and resource_id = $1", [orderId]),
    );
    expect(crossTenantUpdate.rowCount).toBe(0);

    const ownUpdate = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.notifications set read_at = now() where resource_type = 'order' and resource_id = $1", [orderId]),
      { commit: true },
    );
    expect(ownUpdate.rowCount).toBe(1);

    const { rows } = await withSuperuser((c) =>
      c.query("select read_at from public.notifications where resource_type = 'order' and resource_id = $1", [orderId]),
    );
    expect(rows[0]!.read_at).not.toBeNull();
  });

  // 6/6 — defesa em profundidade: nem o próprio tenant consegue alterar title/message/tenant_id/resource_* — só read_at.
  it("the content-protection trigger rejects changing anything other than read_at", async () => {
    const cartId = await createCartWithItem(fx.tenantA, productA);
    const orderId = await createOrder(fx.tenantA, cartId);

    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("update public.notifications set title = 'forjado' where resource_type = 'order' and resource_id = $1", [orderId]),
      ),
    );
    expect(err.message).toMatch(/only read_at can be updated/i);
  });

  // Confirma que o produto/pedido do tenant B nunca aparece nas notificações do tenant A (sanidade extra do isolamento).
  it("tenant B's own order never surfaces as a notification for tenant A", async () => {
    const cartId = await createCartWithItem(fx.tenantB, productB);
    const orderId = await createOrder(fx.tenantB, cartId);

    const { rows } = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.notifications where resource_type = 'order' and resource_id = $1", [orderId]),
    );
    expect(rows).toHaveLength(0);
  });
});
