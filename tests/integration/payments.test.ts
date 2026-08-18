/**
 * Etapa 11 — pagamentos (prompt Etapa 11 §21/§22). RLS/trigger/RPC
 * testados diretamente via SQL (asActor), mesmo padrão de sempre. O
 * fluxo OAuth em si (assinatura/expiração do `state`) e a construção
 * das chamadas HTTP ao Mercado Pago já são cobertos por
 * tests/unit/oauth-state.test.ts e tests/unit/mercadopago-gateway.test.ts
 * (mockando fetch) — aqui o foco é a camada de banco: permissões, RLS,
 * vault (estrutural, sem pgsodium real — ver stub), idempotência,
 * isolamento de tenant, separação status do pedido vs. status do
 * pagamento, e auditoria.
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Pagamentos (Etapa 11)", () => {
  let fx: Fixtures;
  let userAOperator: string;

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

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`payments-operator-${runId}@fixtures.test`],
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

  // 13/14 — permissões: matriz correta.
  it("payments.manage is OWNER/ADMIN only; payments.view also includes MANAGER; OPERATOR has neither", async () => {
    const canManage = async (userId: string) =>
      asActor({ role: "authenticated", userId }, (c) =>
        c.query<{ has_permission: boolean }>("select has_permission($1, 'payments.manage')", [fx.tenantA]),
      ).then((r) => r.rows[0]!.has_permission);
    const canView = async (userId: string) =>
      asActor({ role: "authenticated", userId }, (c) =>
        c.query<{ has_permission: boolean }>("select has_permission($1, 'payments.view')", [fx.tenantA]),
      ).then((r) => r.rows[0]!.has_permission);

    expect(await canManage(fx.userAOwner)).toBe(true);
    expect(await canManage(fx.userAAdmin)).toBe(true);
    expect(await canManage(fx.userAManager)).toBe(false);
    expect(await canView(fx.userAManager)).toBe(true);
    expect(await canManage(userAOperator)).toBe(false);
    expect(await canView(userAOperator)).toBe(false);
  });

  // 8 — conexão duplicada é bloqueada (unique(tenant_id, provider)).
  it("a tenant cannot have two connection rows for the same provider", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.store_payment_providers (tenant_id, provider, status) values ($1, 'mercadopago', 'connected')", [fx.tenantA]),
      { commit: true },
    );
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.store_payment_providers (tenant_id, provider, status) values ($1, 'mercadopago', 'connected')", [fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);

    await withSuperuser((c) => c.query("delete from public.store_payment_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 13/14 — RLS: só payments.manage insere/atualiza; tenant B não vê conexão de tenant A.
  it("RLS: only payments.manage can write store_payment_providers; other tenants can't see the connection", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.store_payment_providers (tenant_id, provider, status) values ($1, 'mercadopago', 'connected')", [fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.store_payment_providers (tenant_id, provider, status) values ($1, 'mercadopago', 'connected')", [fx.tenantA]),
      { commit: true },
    );

    const asTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.store_payment_providers where tenant_id = $1", [fx.tenantA]),
    );
    expect(asTenantB.rows).toHaveLength(0);

    await withSuperuser((c) => c.query("delete from public.store_payment_providers where tenant_id = $1", [fx.tenantA]));
  });

  // Vault: anon/authenticated não têm nenhum acesso à tabela nem às funções.
  it("payment_credentials_vault: zero RLS access for anon/authenticated, and the vault functions require service_role", async () => {
    await withSuperuser((c) =>
      c.query(
        `insert into public.payment_credentials_vault (tenant_id, provider, access_token_secret_id)
         values ($1, 'mercadopago', vault.create_secret('fake-token-for-setup'))
         on conflict (tenant_id, provider) do nothing`,
        [fx.tenantA],
      ),
    );

    const asOwner = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.payment_credentials_vault where tenant_id = $1", [fx.tenantA]),
    );
    expect(asOwner.rows).toHaveLength(0);

    const anonErr = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select private.get_payment_credentials($1, 'mercadopago')", [fx.tenantA])),
    );
    expect(anonErr.message).toMatch(/permission denied/i);

    const authErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select private.get_payment_credentials($1, 'mercadopago')", [fx.tenantA]),
      ),
    );
    expect(authErr.message).toMatch(/permission denied/i);

    await withSuperuser((c) => c.query("delete from public.payment_credentials_vault where tenant_id = $1", [fx.tenantA]));
  });

  // 9/10/11 — vault: store/get/delete via service_role, token nunca aparece fora da função dedicada.
  it("store/get/delete_payment_credentials round-trip via service_role, and secrets are removed on reconnect/disconnect", async () => {
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_payment_credentials($1, 'mercadopago', 'access-token-1', 'refresh-token-1', null)", [fx.tenantA]),
      { commit: true },
    );

    const read = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string; refresh_token: string }>(
        "select access_token, refresh_token from private.get_payment_credentials($1, 'mercadopago')",
        [fx.tenantA],
      ),
    );
    expect(read.rows[0]).toEqual({ access_token: "access-token-1", refresh_token: "refresh-token-1" });

    const { rows: secretsBefore } = await withSuperuser((c) => c.query("select count(*)::int as n from vault.secrets"));

    // Reconectar (store de novo) não deixa os segredos antigos órfãos no vault.
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_payment_credentials($1, 'mercadopago', 'access-token-2', 'refresh-token-2', null)", [fx.tenantA]),
      { commit: true },
    );
    const { rows: secretsAfterReconnect } = await withSuperuser((c) => c.query("select count(*)::int as n from vault.secrets"));
    expect(secretsAfterReconnect[0]!.n).toBe(secretsBefore[0]!.n); // 2 removidos, 2 criados — mesma contagem.

    const readAgain = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string }>("select access_token from private.get_payment_credentials($1, 'mercadopago')", [fx.tenantA]),
    );
    expect(readAgain.rows[0]!.access_token).toBe("access-token-2");

    await asActor({ role: "service_role" }, (c) => c.query("select private.delete_payment_credentials($1, 'mercadopago')", [fx.tenantA]), {
      commit: true,
    });
    const afterDelete = await asActor({ role: "service_role" }, (c) =>
      c.query("select access_token from private.get_payment_credentials($1, 'mercadopago')", [fx.tenantA]),
    );
    expect(afterDelete.rows).toHaveLength(0);
    const { rows: secretsAfterDelete } = await withSuperuser((c) => c.query("select count(*)::int as n from vault.secrets"));
    expect(secretsAfterDelete[0]!.n).toBe(secretsBefore[0]!.n - 2);
  });

  // 17/18 — create_payment_for_order: valor sempre de orders.total, nunca um parâmetro do cliente (a função nem aceita um).
  it("create_payment_for_order always uses orders.total for the amount", async () => {
    const orderId = await insertOrder(fx.tenantA, 249.9);
    const result = await asActor(
      { role: "anon" },
      (c) => c.query<{ amount: string }>("select amount from create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]),
      { commit: true },
    );
    expect(Number(result.rows[0]!.amount)).toBe(249.9);
  });

  // 19/26 — pedido já pago não é pago novamente.
  it("create_payment_for_order rejects starting a new payment for an order already APPROVED", async () => {
    const orderId = await insertOrder(fx.tenantA, 100);
    await withSuperuser((c) => c.query("update public.orders set payment_status = 'APPROVED' where id = $1", [orderId]));

    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId])),
    );
    expect(err.message).toMatch(/already paid/i);
  });

  // 29/30/31 — tenant hopping / order_id manipulado é bloqueado.
  it("create_payment_for_order rejects an order_id that doesn't belong to the given tenant", async () => {
    const orderId = await insertOrder(fx.tenantB, 50);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId])),
    );
    expect(err.message).toMatch(/order not found/i);
  });

  // 15/32 — create_payment_for_order é anon-only.
  it("create_payment_for_order is anon-only — authenticated has no execute grant", async () => {
    const orderId = await insertOrder(fx.tenantA, 30);
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);
  });

  // 19 — pagamento duplicado é bloqueado: unique(order_id) faz um retry atualizar a mesma linha, nunca criar uma segunda.
  it("payments has unique(order_id) — a retry updates the same row instead of creating a duplicate", async () => {
    const orderId = await insertOrder(fx.tenantA, 75);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    const rows = await withSuperuser((c) => c.query("select 1 from public.payments where order_id = $1", [orderId]));
    expect(rows.rows).toHaveLength(1);
  });

  // attach_payment_preference funciona e é escopado por tenant.
  it("attach_payment_preference records the preference id, scoped by tenant", async () => {
    const orderId = await insertOrder(fx.tenantA, 60);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("select attach_payment_preference($1, $2, 'pref-xyz')", [fx.tenantA, orderId]),
      { commit: true },
    );
    const row = await withSuperuser((c) => c.query("select external_id from public.payments where order_id = $1", [orderId]));
    expect(row.rows[0]!.external_id).toBe("pref-xyz");
  });

  // 20/24/25 — apply_payment_update: aprovado separa payment.status de orders.status, orders.status vira PAID só quando aprovado; frete/desconto continuam 0.
  it("apply_payment_update: approving sets payment_status=APPROVED and orders.status=PAID, keeping shipping/discount at 0", async () => {
    const orderId = await insertOrder(fx.tenantA, 150);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });

    await asActor(
      { role: "service_role" },
      (c) =>
        c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-1', 'APPROVED', 'pix', 150)", [fx.tenantA, orderId]),
      { commit: true },
    );

    const order = await withSuperuser((c) =>
      c.query("select status, payment_status, shipping_total, discount_total from public.orders where id = $1", [orderId]),
    );
    expect(order.rows[0]).toMatchObject({ status: "PAID", payment_status: "APPROVED", shipping_total: "0.00", discount_total: "0.00" });

    const payment = await withSuperuser((c) =>
      c.query("select status, external_id, method, paid_at from public.payments where order_id = $1", [orderId]),
    );
    expect(payment.rows[0]!.status).toBe("APPROVED");
    expect(payment.rows[0]!.external_id).toBe("mp-payment-1");
    expect(payment.rows[0]!.paid_at).not.toBeNull();
  });

  // 25 — pagamento rejeitado mantém o pedido PENDING (nunca marca como pago).
  it("apply_payment_update: rejecting keeps orders.status PENDING (never marks it paid)", async () => {
    const orderId = await insertOrder(fx.tenantA, 80);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    await asActor(
      { role: "service_role" },
      (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-2', 'REJECTED', null, 80)", [fx.tenantA, orderId]),
      { commit: true },
    );
    const order = await withSuperuser((c) => c.query("select status, payment_status from public.orders where id = $1", [orderId]));
    expect(order.rows[0]).toMatchObject({ status: "PENDING", payment_status: "REJECTED" });
  });

  // 22 — webhook repetido é idempotente: reaplicar o MESMO evento produz o mesmo estado final, nunca duplica.
  it("apply_payment_update is idempotent — applying the same approval twice leaves a single consistent state", async () => {
    const orderId = await insertOrder(fx.tenantA, 90);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    for (let i = 0; i < 2; i++) {
      await asActor(
        { role: "service_role" },
        (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-3', 'APPROVED', 'pix', 90)", [fx.tenantA, orderId]),
        { commit: true },
      );
    }
    const payments = await withSuperuser((c) => c.query("select 1 from public.payments where order_id = $1", [orderId]));
    expect(payments.rows).toHaveLength(1);
    const order = await withSuperuser((c) => c.query("select status from public.orders where id = $1", [orderId]));
    expect(order.rows[0]!.status).toBe("PAID");
  });

  // 17 — valor divergente do payload é ignorado (não aplica a atualização).
  it("apply_payment_update silently skips when the reported amount doesn't match orders.total", async () => {
    const orderId = await insertOrder(fx.tenantA, 200);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    await asActor(
      { role: "service_role" },
      (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-4', 'APPROVED', 'pix', 1)", [fx.tenantA, orderId]),
      { commit: true },
    );
    const order = await withSuperuser((c) => c.query("select status, payment_status from public.orders where id = $1", [orderId]));
    expect(order.rows[0]).toMatchObject({ status: "PENDING", payment_status: "PENDING" });
  });

  // 29/30/31 — tenant hopping via apply_payment_update: order_id de outro tenant não é afetado.
  it("apply_payment_update does nothing when tenant_id doesn't match the order's real tenant", async () => {
    const orderId = await insertOrder(fx.tenantB, 120);
    await asActor(
      { role: "service_role" },
      (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-5', 'APPROVED', 'pix', 120)", [fx.tenantA, orderId]),
      { commit: true },
    );
    const order = await withSuperuser((c) => c.query("select status, payment_status from public.orders where id = $1", [orderId]));
    expect(order.rows[0]).toMatchObject({ status: "PENDING", payment_status: "PENDING" });
  });

  // apply_payment_update é service_role-only.
  it("apply_payment_update is service_role-only — anon and authenticated have no execute grant", async () => {
    const orderId = await insertOrder(fx.tenantA, 40);
    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, userId: fx.userAOwner }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'x', 'APPROVED', null, 40)", [fx.tenantA, orderId])),
      );
      expect(err.message).toMatch(/permission denied/i);
    }
  });

  // 21 — idempotência de webhook na infraestrutura: (provider, event_id) único.
  it("payment_webhook_events enforces (provider, event_id) uniqueness — a repeated delivery is rejected at the DB level", async () => {
    const eventId = `evt-${runId}`;
    await withSuperuser((c) =>
      c.query("insert into public.payment_webhook_events (provider, event_id, payload) values ('mercadopago', $1, '{}'::jsonb)", [eventId]),
    );
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.payment_webhook_events (provider, event_id, payload) values ('mercadopago', $1, '{}'::jsonb)", [eventId]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);
  });

  // 28/32 — auditoria: PAYMENT_CREATED (anon) e PAYMENT_APPROVED/REJECTED (service_role) são registrados, nunca com token/segredo.
  it("audit log records PAYMENT_CREATED and PAYMENT_APPROVED with no token/secret in the payload", async () => {
    const orderId = await insertOrder(fx.tenantA, 65);
    await asActor({ role: "anon" }, (c) => c.query("select create_payment_for_order($1, $2, 'mercadopago')", [fx.tenantA, orderId]), {
      commit: true,
    });
    await asActor(
      { role: "service_role" },
      (c) => c.query("select apply_payment_update($1, $2, 'mercadopago', 'mp-payment-6', 'APPROVED', 'pix', 65)", [fx.tenantA, orderId]),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query<{ action: string; after: Record<string, unknown> }>(
        "select action, after from public.audit_logs where tenant_id = $1 and resource_type = 'payment' order by created_at",
        [fx.tenantA],
      ),
    );
    const actions = logs.rows.map((r) => r.action);
    expect(actions).toContain("PAYMENT_CREATED");
    expect(actions).toContain("PAYMENT_APPROVED");
    for (const row of logs.rows) {
      const serialized = JSON.stringify(row.after);
      expect(serialized).not.toMatch(/access-token|refresh-token|mp-payment-6/);
    }
  });

  // 28 — auditoria de conexão nunca inclui o account id por inteiro nem qualquer segredo.
  it("audit log records PAYMENT_CONNECTION_CREATED with a masked account id, never the raw value or a token", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "insert into public.store_payment_providers (tenant_id, provider, status, connected_account_id) values ($1, 'mercadopago', 'connected', '1234567890123456')",
          [fx.tenantA],
        ),
      { commit: true },
    );

    const logs = await withSuperuser((c) =>
      c.query<{ after: Record<string, unknown> }>(
        "select after from public.audit_logs where tenant_id = $1 and action = 'PAYMENT_CONNECTION_CREATED' order by created_at desc limit 1",
        [fx.tenantA],
      ),
    );
    expect(logs.rows).toHaveLength(1);
    const after = logs.rows[0]!.after;
    expect(after.connected_account_id).toBe("************3456");
    expect(JSON.stringify(after)).not.toContain("1234567890123456");

    await withSuperuser((c) => c.query("delete from public.store_payment_providers where tenant_id = $1", [fx.tenantA]));
  });
});
