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

/**
 * D11.4 — Busca e paginação de `/master/lojas`. `listTenantsForMaster`
 * (TypeScript, `"server-only"`) não pode ser importada aqui (mesmo motivo
 * de todo este arquivo já usar SQL direto via `asActor`/`withSuperuser`) —
 * então estes testes exercitam a MESMA forma de query que a função monta
 * (ILIKE em `tenants.name`/`slug`, resolução de e-mail do proprietário via
 * `profiles`→`tenant_members`, `LIMIT`/`OFFSET` equivalente a `range()`),
 * validando a RLS real por trás dela — a cobertura da lógica de montagem
 * do `.or()` em si (o que combina com o quê) já está em
 * `tests/unit/master-tenants-data.test.ts`.
 */
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Master — Lojas: busca e paginação (D11.4)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;
  let tenantAlpha: string;
  let tenantBeta: string;
  let ownerAlphaEmail: string;

  /**
   * Cria a loja E a membership OWNER correspondente — `buildFixtures()` já
   * faz isso para `fx.tenantA`/`fx.tenantB`, mas uma loja criada aqui à
   * parte (para ter nome/slug reconhecíveis pela busca) precisa do mesmo
   * INSERT em `tenant_members` explicitamente, senão a resolução de
   * "e-mail do proprietário" nunca encontra nada para ela.
   */
  async function insertNamedTenant(name: string, slug: string, ownerId: string): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows: roleRows } = await client.query<{ id: string }>("select id from public.roles where key = 'OWNER'");
      const { rows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by, status) values ($1, $2, $3, 'active') returning id",
        [name, slug, ownerId],
      );
      const tenantId = rows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        tenantId,
        ownerId,
        roleRows[0]!.id,
      ]);
      return tenantId;
    });
  }

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-search-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);
    });

    // Duas lojas com nome/slug/dono distintos e reconhecíveis, escopadas a
    // este runId (nunca dado real, e nunca colide entre execuções paralelas
    // da suíte — mesmo cuidado de buildFixtures()). Donos são usuários NOVOS
    // (não fx.userAOwner/fx.userBOwner) de propósito: o resto deste arquivo
    // (describe acima) cria vários outros tenants com slug terminado em
    // `-${runId}` também, então toda verificação de contagem/paginação
    // abaixo usa os `id`s conhecidos destas duas lojas, nunca um padrão de
    // texto que pudesse coincidir com dado de outro teste.
    const ownerAlpha = await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`owner-alpha-search-${runId}@fixtures.test`],
      );
      return rows[0]!.id;
    });
    tenantAlpha = await insertNamedTenant(`Confeitaria Alpha ${runId}`, `confeitaria-alpha-${runId}`, ownerAlpha);
    tenantBeta = await insertNamedTenant(`Loja Beta ${runId}`, `loja-beta-${runId}`, fx.userBOwner);
    ownerAlphaEmail = await withSuperuser(async (client) => {
      const { rows } = await client.query<{ email: string }>("select email from public.profiles where id = $1", [ownerAlpha]);
      return rows[0]!.email!;
    });
  });

  it("MASTER encontra uma loja pesquisando por nome (ILIKE, case-insensitive)", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where name ilike $1", [`%confeitaria alpha ${runId}%`]),
    );
    expect(result.rows.map((r) => r.id)).toContain(tenantAlpha);
  });

  it("MASTER encontra uma loja pesquisando por slug", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where slug ilike $1", [`%loja-beta-${runId}%`]),
    );
    expect(result.rows.map((r) => r.id)).toContain(tenantBeta);
  });

  it("MASTER encontra uma loja pesquisando pelo e-mail do proprietário (via profiles→tenant_members, mesma resolução do data layer)", async () => {
    const matchingProfiles = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.profiles where email ilike $1", [`%${ownerAlphaEmail}%`]),
    );
    expect(matchingProfiles.rows.length).toBeGreaterThan(0);

    const ownerTenantIds = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query(
        `select tm.tenant_id from public.tenant_members tm
         join public.roles r on r.id = tm.role_id
         where r.key = 'OWNER' and tm.user_id = any($1::uuid[])`,
        [matchingProfiles.rows.map((r) => r.id)],
      ),
    );
    expect(ownerTenantIds.rows.map((r) => r.tenant_id)).toContain(tenantAlpha);
  });

  it("SUPPORT_AGENT consegue os mesmos resultados de busca que MASTER (só leitura, mesma RLS)", async () => {
    const asMaster = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where name ilike $1", [`%confeitaria alpha ${runId}%`]),
    );
    const asSupport = await asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
      c.query("select id from public.tenants where name ilike $1", [`%confeitaria alpha ${runId}%`]),
    );
    expect(asSupport.rows).toEqual(asMaster.rows);
  });

  it("busca por e-mail permanece isolada por RLS: um lojista comum não consegue ler profiles de outro usuário para 'descobrir' donos", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.profiles where email ilike $1", [`%${runId}%`]),
    );
    // RLS de profiles: cada authenticated só vê o PRÓPRIO profile (a menos que seja platform admin) —
    // então mesmo que o e-mail de outro usuário contenha o runId, ele não aparece aqui.
    expect(result.rows.every((r) => r.id === fx.userAOwner)).toBe(true);
  });

  it("anon não vê tenant_members/profiles (a busca por e-mail nunca fica acessível a anon, mesmo achado já confirmado em rls-isolation.test.ts)", async () => {
    const members = await asActor({ role: "anon" }, (c) => c.query("select id from public.tenant_members"));
    expect(members.rows).toHaveLength(0);
    const profiles = await asActor({ role: "anon" }, (c) => c.query("select id from public.profiles"));
    expect(profiles.rows).toHaveLength(0);
  });

  it("paginação real: LIMIT/OFFSET (equivalente ao range() usado pelo data layer) retorna só o intervalo pedido, e o total via count(*) bate", async () => {
    // Escopado pelos `id`s conhecidos das duas lojas criadas neste describe
    // — nunca um padrão de texto (`ilike '%-runId%'`), que colidiria com
    // outros tenants criados pelo describe anterior no mesmo arquivo
    // (mesmo `runId`, mesmo sufixo de slug).
    const total = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select count(*)::int as n from public.tenants where id = any($1::uuid[])", [[tenantAlpha, tenantBeta]]),
    );
    expect(total.rows[0]!.n).toBe(2);

    const firstPage = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where id = any($1::uuid[]) order by created_at asc limit 1 offset 0", [
        [tenantAlpha, tenantBeta],
      ]),
    );
    const secondPage = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where id = any($1::uuid[]) order by created_at asc limit 1 offset 1", [
        [tenantAlpha, tenantBeta],
      ]),
    );
    expect(firstPage.rows).toHaveLength(1);
    expect(secondPage.rows).toHaveLength(1);
    expect(firstPage.rows[0]!.id).not.toBe(secondPage.rows[0]!.id);
    expect([firstPage.rows[0]!.id, secondPage.rows[0]!.id].sort()).toEqual([tenantAlpha, tenantBeta].sort());
  });

  it("regressão: filtro de status + busca continuam funcionando juntos (AND), sem enfraquecer a RLS existente", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id from public.tenants where status = $1 and id = any($2::uuid[])", ["active", [tenantAlpha, tenantBeta]]),
    );
    expect(result.rows.map((r) => r.id).sort()).toEqual([tenantAlpha, tenantBeta].sort());
  });

  it("regressão: update_tenant_status e a autorização MASTER/SUPPORT_AGENT continuam idênticas após a mudança de busca/paginação", async () => {
    const asSupportAttempt = await expectPgError(
      asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
        c.query("select update_tenant_status($1, 'suspended')", [tenantAlpha]),
      ),
    );
    expect(asSupportAttempt.message).toMatch(/only a MASTER admin/i);

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("select update_tenant_status($1, 'suspended')", [tenantAlpha]),
      { commit: true },
    );
    const row = await withSuperuser((c) => c.query("select status from public.tenants where id = $1", [tenantAlpha]));
    expect(row.rows[0]!.status).toBe("suspended");
  });
});

// Único fechamento do pool compartilhado do módulo — precisa rodar só depois dos dois describes acima, nunca entre eles (mesmo padrão de tests/integration/shipping.test.ts).
afterAll(async () => {
  await pool.end();
});
