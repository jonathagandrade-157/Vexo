/**
 * D18.4 (Fase 2) — `/painel/historico`. Este arquivo testa somente o que
 * `features/history/data.ts` de fato depende do banco: a RLS já existente
 * de `audit_logs` (policy "tenant members and platform admins can select
 * audit_logs", migration 20260817220015, intencionalmente NÃO alterada
 * nesta fase — a consulta real da feature usa o client de SESSÃO, nunca
 * service_role), a permission `settings.view` (RBAC real, Etapa 2, sem
 * nenhuma mudança), e o índice novo desta fase (20260817220107). Mesmo
 * padrão de `tests/integration/master-audit-logs.test.ts` — SQL direto via
 * `asActor`, nunca chamando o código TypeScript da feature (que depende de
 * `next/headers`, indisponível fora de uma request Next.js real).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Histórico do lojista — D18.4", () => {
  let fx: Fixtures;
  let tenantCreatedLogIdA: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      // tenantA já foi criado por buildFixtures() (via withSuperuser, que
      // dispara o trigger audit_tenant_changes normalmente) — TENANT_CREATED
      // já existe de verdade em audit_logs para tenantA, nenhum dado
      // fabricado especificamente para este teste.
      const { rows } = await client.query<{ id: string }>(
        "select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_CREATED' limit 1",
        [fx.tenantA],
      );
      tenantCreatedLogIdA = rows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("Isolamento por tenant (RLS + WHERE tenant_id = $1, mesmo filtro que listHistoryForTenant aplica)", () => {
    it("um membro do tenant A vê o histórico do próprio tenant", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id, action from public.audit_logs where tenant_id = $1 and id = $2", [fx.tenantA, tenantCreatedLogIdA]),
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.action).toBe("TENANT_CREATED");
    });

    it("tenant A não recebe dados de tenant B: um membro do tenant B não vê o log do tenant A, mesmo pedindo o id exato", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
        c.query("select id from public.audit_logs where id = $1", [tenantCreatedLogIdA]),
      );
      expect(result.rows).toHaveLength(0);
    });

    it("um outsider (sem nenhuma membership) não vê nenhuma linha de nenhum tenant", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select id from public.audit_logs where tenant_id = $1", [fx.tenantA]),
      );
      expect(result.rows).toHaveLength(0);
    });

    it("a query nunca 'aceita' um tenant_id arbitrário de fora — filtrar por um tenant_id ao qual o ator não pertence sempre retorna vazio, nunca lança nem retorna dado de outro tenant", async () => {
      const forgedTenantId = randomUUID();
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.audit_logs where tenant_id = $1", [forgedTenantId]),
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe("Eventos de escopo Master nunca aparecem no histórico de um tenant", () => {
    it("existe pelo menos um evento real de escopo Master (tenant_id IS NULL) na base — sanity check de que a exclusão não é vazia por acidente", async () => {
      const result = await withSuperuser((c) =>
        c.query("select count(*)::int as n from public.audit_logs where tenant_id is null and action = 'PLAN_LIMIT_SET'"),
      );
      expect((result.rows[0] as { n: number }).n).toBeGreaterThan(0);
    });

    it("filtrar por tenant_id = tenantA nunca retorna um evento de escopo Master (tenant_id IS NULL não é igual a nenhum uuid concreto)", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select action from public.audit_logs where tenant_id = $1 and action = 'PLAN_LIMIT_SET'", [fx.tenantA]),
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe("Permissão settings.view (RBAC real, Etapa 2 — reaproveitada, decisão do produto D18.4 Fase 2 item 3)", () => {
    it("OWNER possui settings.view", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select public.has_permission($1, 'settings.view') as allowed", [fx.tenantA]),
      );
      expect(result.rows[0]?.allowed).toBe(true);
    });

    it("ADMIN possui settings.view", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAAdmin }, (c) =>
        c.query("select public.has_permission($1, 'settings.view') as allowed", [fx.tenantA]),
      );
      expect(result.rows[0]?.allowed).toBe(true);
    });

    it("MANAGER NÃO possui settings.view — a página/Server Action deve bloqueá-lo", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("select public.has_permission($1, 'settings.view') as allowed", [fx.tenantA]),
      );
      expect(result.rows[0]?.allowed).toBe(false);
    });
  });

  describe("Índice de performance (D18.4 §14 — migration 20260817220107)", () => {
    it("audit_logs_tenant_id_created_at_idx existe, é um btree composto (tenant_id, created_at DESC), na ordem certa para a consulta paginada", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ indexdef: string }>(
          "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'audit_logs' and indexname = 'audit_logs_tenant_id_created_at_idx'",
        ),
      );
      expect(result.rows).toHaveLength(1);
      const def = result.rows[0]!.indexdef.toLowerCase();
      expect(def).toContain("btree (tenant_id, created_at desc)");
    });

    it("nenhum índice pré-existente (tenant_id/actor_user_id/created_at simples) foi removido — esta migration é puramente aditiva", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ indexname: string }>(
          "select indexname from pg_indexes where schemaname = 'public' and tablename = 'audit_logs'",
        ),
      );
      const names = result.rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          "audit_logs_pkey",
          "audit_logs_tenant_id_idx",
          "audit_logs_actor_user_id_idx",
          "audit_logs_created_at_idx",
          "audit_logs_tenant_id_created_at_idx",
        ]),
      );
    });
  });

  describe("audit_logs continua append-only (nenhuma alteração desta fase toca essa garantia)", () => {
    it("RLS de audit_logs continua sem nenhuma policy de INSERT/UPDATE/DELETE para authenticated", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ cmd: string }>("select cmd from pg_policies where schemaname = 'public' and tablename = 'audit_logs'"),
      );
      expect(result.rows.map((r) => r.cmd)).toEqual(["SELECT"]);
    });
  });
});
