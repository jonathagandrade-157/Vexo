/**
 * Etapa 13 — gestão de pedidos. Mesmo padrão de payments.test.ts/
 * shipping.test.ts: RLS/trigger/RPC testados diretamente via SQL
 * (asActor). Foco: a máquina de estados de `update_order_status`
 * (migration 20260817220051) é exaustiva e nunca aceita uma transição
 * fora da lista, isolamento multi-tenant, auditoria (before/after/
 * actor/tenant) e que a nota interna nunca vaza para o cliente via
 * get_order_confirmation.
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Gestão de Pedidos (Etapa 13)", () => {
  let fx: Fixtures;
  let userAOperator: string;

  async function insertOrder(tenantId: string, status: string, total = 100): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, status, customer_name, customer_email, customer_phone, shipping_address, subtotal, total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [tenantId, `PED${runId}${Math.floor(Math.random() * 1000000)}`, status, "Cliente Teste", "cliente@example.com", "11912345678", ADDRESS, total],
      );
      return rows[0]!.id;
    });
  }

  async function updateStatus(actorUserId: string, tenantId: string, orderId: string, newStatus: string, note?: string) {
    return asActor(
      { role: "authenticated", userId: actorUserId },
      (c) => c.query("select update_order_status($1, $2, $3, $4)", [tenantId, orderId, newStatus, note ?? null]),
      { commit: true },
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`orders-operator-${runId}@fixtures.test`],
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

  // A) Transições válidas.
  const validTransitions: [string, string][] = [
    ["PENDING", "CANCELLED"],
    ["PAID", "PREPARING"],
    ["PAID", "CANCELLED"],
    ["PREPARING", "SHIPPED"],
    ["PREPARING", "CANCELLED"],
    ["SHIPPED", "DELIVERED"],
  ];
  for (const [from, to] of validTransitions) {
    it(`allows the valid transition ${from} → ${to}`, async () => {
      const orderId = await insertOrder(fx.tenantA, from);
      await updateStatus(fx.userAOwner, fx.tenantA, orderId, to);
      const row = await withSuperuser((c) => c.query("select status from public.orders where id = $1", [orderId]));
      expect(row.rows[0]!.status).toBe(to);
    });
  }

  // B) Transições inválidas — todas rejeitadas, status permanece inalterado.
  const invalidTransitions: [string, string][] = [
    ["PENDING", "PAID"],
    ["PENDING", "PREPARING"],
    ["PAID", "SHIPPED"],
    ["PAID", "DELIVERED"],
    ["PREPARING", "DELIVERED"],
    ["SHIPPED", "CANCELLED"],
    ["DELIVERED", "PENDING"],
    ["DELIVERED", "CANCELLED"],
    ["CANCELLED", "PENDING"],
    ["CANCELLED", "PAID"],
  ];
  for (const [from, to] of invalidTransitions) {
    it(`rejects the invalid transition ${from} → ${to}`, async () => {
      const orderId = await insertOrder(fx.tenantA, from);
      const err = await expectPgError(updateStatus(fx.userAOwner, fx.tenantA, orderId, to));
      expect(err.message).toMatch(/invalid order status transition/i);
      const row = await withSuperuser((c) => c.query("select status from public.orders where id = $1", [orderId]));
      expect(row.rows[0]!.status).toBe(from);
    });
  }

  // B2 — corrida (achado da revisão de segurança): duas chamadas concorrentes a partir do MESMO status de origem, cada uma
  // individualmente válida (PREPARING → SHIPPED e PREPARING → CANCELLED), nunca podem produzir uma transição fora da
  // máquina de estados (ex.: SHIPPED → CANCELLED, se a segunda escrita destravasse depois da primeira já ter avançado a
  // linha). Exatamente uma das duas deve vencer; a outra deve falhar (leitura-validação-escrita atômica via `and status =
  // v_order.status` no UPDATE), nunca as duas aplicarem por cima uma da outra.
  it("two concurrent update_order_status calls from the same starting status never produce an out-of-machine transition", async () => {
    const orderId = await insertOrder(fx.tenantA, "PREPARING");
    const results = await Promise.allSettled([
      updateStatus(fx.userAOwner, fx.tenantA, orderId, "SHIPPED"),
      updateStatus(fx.userAOwner, fx.tenantA, orderId, "CANCELLED"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Dependendo do timing real de execução, a chamada perdedora é
    // barrada em um de dois pontos — sua própria validação inicial, se a
    // leitura dela já aconteceu depois do commit da vencedora (lê o
    // status já avançado e rejeita a transição normalmente), ou a
    // condição extra no UPDATE, se as duas leituras aconteceram antes de
    // qualquer commit (a leitura da perdedora ficou desatualizada) —
    // ambos os casos são a correção funcionando, nunca a transição
    // inválida sendo aplicada.
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/invalid order status transition|changed concurrently/i);

    const row = await withSuperuser((c) => c.query("select status from public.orders where id = $1", [orderId]));
    expect(["SHIPPED", "CANCELLED"]).toContain(row.rows[0]!.status);

    // Nunca a combinação inválida SHIPPED → CANCELLED: se o vencedor foi SHIPPED, o pedido tem que ter PARADO ali
    // (a segunda chamada, que queria CANCELLED, precisa ter sido a rejeitada).
    if (row.rows[0]!.status === "SHIPPED") {
      const cancelledCall = results[1];
      expect(cancelledCall.status).toBe("rejected");
    }
  });

  // C1 — orders.view: RLS escopa a leitura de orders/order_items por permissão e por tenant.
  it("RLS: only orders.view can read orders/order_items; another tenant sees nothing", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");

    const asOwner = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    expect(asOwner.rows).toHaveLength(1);

    const asTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.orders where id = $1", [orderId]),
    );
    expect(asTenantB.rows).toHaveLength(0);
  });

  // C2 — acesso sem autenticação: `anon` não tem nenhuma policy de SELECT em orders.
  it("RLS: anon has zero read access to orders (no anon policy exists)", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    const asAnon = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.orders where id = $1", [orderId]));
    expect(asAnon.rows).toHaveLength(0);
  });

  // C3 — update_order_status é authenticated-only.
  it("update_order_status is authenticated-only — anon and service_role have no execute grant", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    for (const actor of [{ role: "anon" as const }, { role: "service_role" as const }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select update_order_status($1, $2, 'PREPARING', null)", [fx.tenantA, orderId])),
      );
      expect(err.message).toMatch(/permission denied/i);
    }
  });

  // C4 — sem orders.update (usuário autenticado de verdade, mas sem nenhum vínculo com o tenant), a chamada é rejeitada pela checagem interna da função.
  it("rejects a real authenticated user who has no orders.update on this tenant", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select update_order_status($1, $2, 'PREPARING', null)", [fx.tenantA, orderId]),
      ),
    );
    expect(err.message).toMatch(/insufficient permission/i);
  });

  // C5 — tenant hopping: pedido de outro tenant não é afetado, mesmo por um OWNER de verdade (só de outro tenant).
  it("update_order_status rejects an order_id that doesn't belong to the given tenant (tenant hopping)", async () => {
    const orderId = await insertOrder(fx.tenantB, "PAID");
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select update_order_status($1, $2, 'PREPARING', null)", [fx.tenantA, orderId]),
      ),
    );
    expect(err.message).toMatch(/order not found/i);
    const row = await withSuperuser((c) => c.query("select status from public.orders where id = $1", [orderId]));
    expect(row.rows[0]!.status).toBe("PAID");
  });

  // D — auditoria: before/after/actor/tenant corretos.
  it("audit log records ORDER_STATUS_CHANGED with correct before/after/actor/tenant", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    await updateStatus(fx.userAOwner, fx.tenantA, orderId, "PREPARING", "Separando os itens");

    const logs = await withSuperuser((c) =>
      c.query<{ action: string; before: Record<string, unknown>; after: Record<string, unknown>; actor_user_id: string; tenant_id: string }>(
        "select action, before, after, actor_user_id, tenant_id from public.audit_logs where tenant_id = $1 and resource_type = 'order' and resource_id = $2 and action = 'ORDER_STATUS_CHANGED' order by created_at desc limit 1",
        [fx.tenantA, orderId],
      ),
    );
    expect(logs.rows).toHaveLength(1);
    const entry = logs.rows[0]!;
    expect(entry.before).toMatchObject({ status: "PAID" });
    expect(entry.after).toMatchObject({ status: "PREPARING", note: "Separando os itens" });
    expect(entry.actor_user_id).toBe(fx.userAOwner);
    expect(entry.tenant_id).toBe(fx.tenantA);
  });

  // E1 — nota interna: salva corretamente em orders.internal_note.
  it("internal note is saved on orders.internal_note", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    await updateStatus(fx.userAOwner, fx.tenantA, orderId, "PREPARING", "Aguardando embalagem");
    const row = await withSuperuser((c) => c.query("select internal_note from public.orders where id = $1", [orderId]));
    expect(row.rows[0]!.internal_note).toBe("Aguardando embalagem");
  });

  // E2 — nota interna nunca aparece na confirmação pública do pedido (get_order_confirmation, anon).
  it("internal note is never exposed via get_order_confirmation (customer-facing, anon)", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    await updateStatus(fx.userAOwner, fx.tenantA, orderId, "PREPARING", "Nota confidencial da equipe interna");

    const confirmation = await asActor({ role: "anon" }, (c) =>
      c.query<{ get_order_confirmation: Record<string, unknown> }>("select get_order_confirmation($1, $2)", [fx.tenantA, orderId]),
    );
    const payload = confirmation.rows[0]!.get_order_confirmation;
    expect(JSON.stringify(payload)).not.toContain("Nota confidencial");
    expect(payload).not.toHaveProperty("internalNote");
    expect(payload).not.toHaveProperty("internal_note");
  });

  // payment_status permanece intocado ao cancelar um pedido pago (cancelamento não dispara refund/estorno).
  it("cancelling a PAID order never touches payment_status", async () => {
    const orderId = await insertOrder(fx.tenantA, "PAID");
    await withSuperuser((c) => c.query("update public.orders set payment_status = 'APPROVED' where id = $1", [orderId]));
    await updateStatus(fx.userAOwner, fx.tenantA, orderId, "CANCELLED");
    const row = await withSuperuser((c) => c.query("select status, payment_status from public.orders where id = $1", [orderId]));
    expect(row.rows[0]).toMatchObject({ status: "CANCELLED", payment_status: "APPROVED" });
  });
});
