/**
 * D11.2 — `/master/auditoria` não introduz nenhuma autorização nova: só
 * consome a RLS de `audit_logs` já existente desde a Etapa 2 (policy
 * "tenant members and platform admins can select audit_logs", migration
 * 20260817220015). Este arquivo testa exatamente essa policy — nunca uma
 * camada paralela — mais a garantia (também pré-existente, testada de novo
 * aqui só sob a ótica desta feature) de que nenhuma escrita é possível
 * através dela, matching prompt §16: "nenhum log pode ser alterado pela
 * interface". Mesmo padrão de asActor/expectPgError contra SQL direto de
 * master-tenants.test.ts, nunca através do código da aplicação.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Master — Auditoria (D11.2)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;
  let knownLogId: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-audit-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);

      // tenantA já foi criado por buildFixtures() (via withSuperuser, que
      // dispara o trigger audit_tenant_changes normalmente) — TENANT_CREATED
      // já existe de verdade em audit_logs para tenantA, nenhum dado
      // fabricado especificamente para este teste.
      const { rows: logRows } = await client.query<{ id: string }>(
        "select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_CREATED' limit 1",
        [fx.tenantA],
      );
      knownLogId = logRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Achado de infraestrutura de teste (registrado no relatório final, não
   * corrigido aqui — fora do escopo do D11.2, afetaria o fixture
   * compartilhado por toda a suíte): a migration real
   * (20260817220067_grant_base_table_privileges.sql) só concede SELECT em
   * `audit_logs` a `authenticated`, nunca a `anon` — em produção, `anon`
   * receberia "permission denied" antes mesmo de a RLS entrar em jogo.
   * O stub local (`tests/integration/fixtures/supabase-stub.sql`) usa
   * `alter default privileges ... grant select on tables to anon`
   * ANTES das migrations reais rodarem, então toda tabela criada depois
   * (inclusive `audit_logs`) herda um SELECT para `anon` que a produção
   * nunca concede. Por isso este teste verifica a camada que continua
   * idêntica entre os dois ambientes — a RLS: `anon` nunca enxerga
   * NENHUMA linha, mesmo tendo o privilégio de tabela neste ambiente local.
   */
  it("anon não vê nenhuma linha de audit_logs (RLS não tem nenhuma policy para anon)", async () => {
    const result = await asActor({ role: "anon" }, (c) => c.query("select id from public.audit_logs where id = $1", [knownLogId]));
    expect(result.rows).toHaveLength(0);
  });

  it("authenticated sem relação com o tenant não vê o log daquele tenant (RLS filtra, não erro)", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select id from public.audit_logs where id = $1", [knownLogId]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("SUPPORT_AGENT consegue ler audit_logs de qualquer tenant (is_platform_admin() cobre os dois papéis)", async () => {
    const result = await asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
      c.query("select id, action from public.audit_logs where id = $1", [knownLogId]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.action).toBe("TENANT_CREATED");
  });

  it("MASTER consegue ler audit_logs de qualquer tenant", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select id, action from public.audit_logs where id = $1", [knownLogId]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.action).toBe("TENANT_CREATED");
  });

  it("nenhum log pode ser alterado por esta interface: nem MASTER nem SUPPORT_AGENT têm INSERT/UPDATE/DELETE em audit_logs", async () => {
    const insertAsMaster = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
        c.query(
          "insert into public.audit_logs (tenant_id, actor_type, action) values ($1, 'master', 'FORGED_EVENT')",
          [fx.tenantA],
        ),
      ),
    );
    expect(insertAsMaster.message).toMatch(/permission denied/i);

    const updateAsMaster = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
        c.query("update public.audit_logs set reason = 'tampered' where id = $1", [knownLogId]),
      ),
    );
    expect(updateAsMaster.message).toMatch(/permission denied/i);

    const deleteAsMaster = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
        c.query("delete from public.audit_logs where id = $1", [knownLogId]),
      ),
    );
    expect(deleteAsMaster.message).toMatch(/permission denied/i);

    const updateAsSupport = await expectPgError(
      asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
        c.query("update public.audit_logs set reason = 'tampered' where id = $1", [knownLogId]),
      ),
    );
    expect(updateAsSupport.message).toMatch(/permission denied/i);
  });

  it("nenhum dado sensível existe em audit_logs para os eventos reais gerados nesta fixture (sanity check, não uma garantia geral)", async () => {
    const result = await withSuperuser((c) =>
      c.query<{ before: unknown; after: unknown; metadata: unknown }>(
        "select before, after, metadata from public.audit_logs where tenant_id = $1",
        [fx.tenantA],
      ),
    );
    const serialized = JSON.stringify(result.rows);
    expect(serialized.toLowerCase()).not.toMatch(/token|secret|password/);
  });
});
