/**
 * Etapa 18 — Master / Gestão de Lojas. Foco: `public.update_tenant_status`
 * é o único caminho para mudar `tenants.status`, MASTER-only (nunca
 * SUPPORT_AGENT, nunca o próprio lojista, nem via a RPC nem via UPDATE
 * direto — a RLS/trigger de tenants continuam bloqueando isso desde a
 * Etapa 2), segue exatamente a máquina de estados
 * pending → active → suspended → active, é segura sob concorrência, e a
 * auditoria acontece automaticamente via o trigger já existente. Mesmo
 * padrão de order-management.test.ts (asActor/expectPgError contra SQL
 * direto, nunca através do código da aplicação).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Master — Gestão de Lojas (Etapa 18)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;

  async function insertTenant(status: "pending" | "active" | "suspended", createdBy: string): Promise<string> {
    return withSuperuser(async (client) => {
      const slug = `loja-${randomUUID().slice(0, 8)}-${runId}`;
      const { rows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by, status) values ($1, $2, $3, $4) returning id",
        [`Loja ${slug}`, slug, createdBy, status],
      );
      return rows[0]!.id;
    });
  }

  function updateStatus(userId: string, tenantId: string, newStatus: string, commit = true) {
    return asActor(
      { role: "authenticated", userId },
      (c) => c.query("select update_tenant_status($1, $2)", [tenantId, newStatus]),
      { commit },
    );
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("MASTER can walk the full machine: pending → active → suspended → active", async () => {
    const tenantId = await insertTenant("pending", fx.userAOwner);

    await updateStatus(fx.userMaster, tenantId, "active");
    let row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("active");

    await updateStatus(fx.userMaster, tenantId, "suspended");
    row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("suspended");

    await updateStatus(fx.userMaster, tenantId, "active");
    row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("active");
  });

  it("rejects any transition outside the machine (pending → suspended directly)", async () => {
    const tenantId = await insertTenant("pending", fx.userAOwner);
    const err = await expectPgError(updateStatus(fx.userMaster, tenantId, "suspended", false));
    expect(err.message).toMatch(/invalid tenant status transition/i);

    const row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("pending");
  });

  it("SUPPORT_AGENT can read tenants but cannot call update_tenant_status", async () => {
    const tenantId = await insertTenant("pending", fx.userAOwner);

    const asSupport = await asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
      c.query("select id from public.tenants where id = $1", [tenantId]),
    );
    expect(asSupport.rows).toHaveLength(1);

    const err = await expectPgError(updateStatus(userSupportAgent, tenantId, "active", false));
    expect(err.message).toMatch(/only a MASTER admin/i);

    const row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("pending");
  });

  it("a tenant's own OWNER cannot change its status — neither via the RPC nor via a direct UPDATE", async () => {
    const viaRpc = await expectPgError(updateStatus(fx.userAOwner, fx.tenantA, "active", false));
    expect(viaRpc.message).toMatch(/only a MASTER admin/i);

    // Segunda camada: mesmo contornando a RPC, o trigger
    // prevent_unauthorized_tenant_status_change (Etapa 2) continua
    // bloqueando qualquer não-admin de escrever tenants.status direto.
    const viaDirectUpdate = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantA]),
      ),
    );
    expect(viaDirectUpdate.message).toMatch(/tenants\.status can only be changed by a platform admin/i);
  });

  it("update_tenant_status is authenticated-only — anon and service_role have no execute grant", async () => {
    const tenantId = await insertTenant("pending", fx.userAOwner);
    for (const actor of [{ role: "anon" as const }, { role: "service_role" as const }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select update_tenant_status($1, 'active')", [tenantId])),
      );
      expect(err.message).toMatch(/permission denied for function/i);
    }
  });

  it("rejects a non-existent tenant id", async () => {
    const err = await expectPgError(updateStatus(fx.userMaster, randomUUID(), "active", false));
    expect(err.message).toMatch(/store not found/i);
  });

  it("every successful transition is captured by the existing audit trigger", async () => {
    const tenantId = await insertTenant("pending", fx.userAOwner);

    await updateStatus(fx.userMaster, tenantId, "active");
    const changed = await withSuperuser((c) =>
      c.query(
        "select action, before, after from public.audit_logs where tenant_id = $1 and resource_type = 'tenant' and action = 'TENANT_STATUS_CHANGED' order by created_at desc limit 1",
        [tenantId],
      ),
    );
    expect(changed.rows[0]).toMatchObject({ before: { status: "pending" }, after: { status: "active" } });

    await updateStatus(fx.userMaster, tenantId, "suspended");
    const suspended = await withSuperuser((c) =>
      c.query(
        "select action, before, after from public.audit_logs where tenant_id = $1 and resource_type = 'tenant' and action = 'TENANT_SUSPENDED' order by created_at desc limit 1",
        [tenantId],
      ),
    );
    expect(suspended.rows[0]).toMatchObject({ before: { status: "active" }, after: { status: "suspended" } });
  });

  // Corrida: duas chamadas concorrentes a partir do MESMO status de
  // origem, cada uma individualmente válida a partir dele
  // (active → suspended, e uma segunda active → suspended repetida),
  // nunca podem as duas "vencerem" — mesma técnica de
  // order-management.test.ts (Promise.allSettled sobre duas chamadas
  // paralelas, cada uma na sua própria conexão/transação via asActor).
  it("two concurrent update_tenant_status calls from the same starting status never both apply", async () => {
    const tenantId = await insertTenant("active", fx.userAOwner);

    const results = await Promise.allSettled([
      updateStatus(fx.userMaster, tenantId, "suspended"),
      updateStatus(fx.userMaster, tenantId, "suspended"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /invalid tenant status transition|changed concurrently/i,
    );

    const row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantId]));
    expect(row.rows[0]!.status).toBe("suspended");

    // Exatamente um registro de auditoria para esta transição — nunca dois.
    const audit = await withSuperuser((c) =>
      c.query(
        "select count(*)::int as n from public.audit_logs where tenant_id = $1 and resource_type = 'tenant' and action = 'TENANT_SUSPENDED'",
        [tenantId],
      ),
    );
    expect(audit.rows[0]!.n).toBe(1);
  });
});
