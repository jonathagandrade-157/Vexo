/**
 * D18.3 — Equipe/Funcionários. Testa exclusivamente a camada de banco
 * (migration 20260817220105) direto via SQL (asActor/withSuperuser), nunca
 * através das Server Actions do Next.js — mesmo padrão de todo o projeto.
 * `auth.admin.inviteUserByEmail` (Supabase Admin API) não é testável aqui
 * (não existe contra um Postgres local puro); o INSERT em tenant_members
 * que essa chamada precede é simulado diretamente via service_role, o
 * mesmo papel que `inviteTeamMemberAction` usa de verdade.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Equipe/Funcionários — camada de banco (D18.3)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function logsFor(tenantId: string, resourceType: string): Promise<AuditLogRow[]> {
    const { rows } = await withSuperuser((c) =>
      c.query<AuditLogRow>(
        "select * from public.audit_logs where tenant_id = $1 and resource_type = $2 order by created_at",
        [tenantId, resourceType],
      ),
    );
    return rows;
  }

  /**
   * D18.3.1 — depois de `prevent_unauthorized_owner_insert`, NENHUM INSERT
   * com role OWNER passa (nem via `withSuperuser`, propositalmente — o
   * trigger não tem exceção para nenhum papel, é exatamente esse o ponto
   * da correção). Para os cenários de teste que precisam simular um tenant
   * já com um segundo OWNER pré-existente (não o fluxo de convite em si,
   * que é coberto pelos testes de bloqueio abaixo), este helper desliga os
   * triggers só ao redor do INSERT de fixture — nunca algo que a aplicação
   * poderia fazer (Server Actions só têm privilégio de `service_role`,
   * nunca `ALTER TABLE`; só uma conexão de superuser real, como esta usada
   * só para montar fixtures, consegue fazer isso).
   */
  async function insertSecondOwnerDirectly(tenantId: string, userId: string, roleId: string, status: "active" | "invited" = "active"): Promise<string> {
    return withSuperuser(async (c) => {
      await c.query("alter table public.tenant_members disable trigger all");
      try {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, $4) returning id",
          [tenantId, userId, roleId, status],
        );
        return rows[0]!.id;
      } finally {
        await c.query("alter table public.tenant_members enable trigger all");
      }
    });
  }

  describe("Auditoria de INSERT/UPDATE/DELETE em tenant_members", () => {
    it("INSERT (convite) gera TEAM_MEMBER_INVITED", async () => {
      const newUserId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`invited-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });

      await asActor(
        { role: "service_role" },
        (c) =>
          c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited')", [
            fx.tenantA,
            newUserId,
            fx.roleIds.OPERATOR,
          ]),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "tenant_member");
      const evt = logs.find((l) => l.action === "TEAM_MEMBER_INVITED" && (l.after as { target_user_id: string })?.target_user_id === newUserId);
      expect(evt).toBeDefined();
      expect(evt!.before).toBeNull();
      expect(evt!.after).toMatchObject({ status: "invited" });
    });

    it("UPDATE de status (invited -> active) gera TEAM_MEMBER_STATUS_CHANGED, role_id continua gerando USER_ROLE_CHANGED (regressão Etapa 2)", async () => {
      const newUserId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`status-change-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      const memberId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited') returning id",
          [fx.tenantA, newUserId, fx.roleIds.OPERATOR],
        );
        return rows[0]!.id;
      });

      await withSuperuser((c) => c.query("update public.tenant_members set status = 'active' where id = $1", [memberId]));
      await withSuperuser((c) => c.query("update public.tenant_members set role_id = $1 where id = $2", [fx.roleIds.MANAGER, memberId]));

      const logs = await logsFor(fx.tenantA, "tenant_member");
      const statusEvt = logs.find((l) => l.action === "TEAM_MEMBER_STATUS_CHANGED" && l.resource_id === memberId);
      const roleEvt = logs.find((l) => l.action === "USER_ROLE_CHANGED" && l.resource_id === memberId);
      expect(statusEvt).toBeDefined();
      expect(statusEvt!.after).toMatchObject({ status: "active" });
      expect(roleEvt).toBeDefined();
    });

    it("DELETE (remoção) gera TEAM_MEMBER_REMOVED", async () => {
      const newUserId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`removed-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      const memberId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'active') returning id",
          [fx.tenantA, newUserId, fx.roleIds.OPERATOR],
        );
        return rows[0]!.id;
      });

      await withSuperuser((c) => c.query("delete from public.tenant_members where id = $1", [memberId]));

      const logs = await logsFor(fx.tenantA, "tenant_member");
      const evt = logs.find((l) => l.action === "TEAM_MEMBER_REMOVED" && l.resource_id === memberId);
      expect(evt).toBeDefined();
      expect(evt!.after).toBeNull();
    });
  });

  describe("Proteção contra remover/rebaixar o último OWNER (prevent_removing_last_owner)", () => {
    it("não permite DELETE do único OWNER ativo do tenant", async () => {
      const err = await expectPgError(
        withSuperuser((c) => c.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, fx.userAOwner])),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514");
    });

    it("não permite rebaixar (UPDATE role_id) o único OWNER ativo do tenant", async () => {
      const err = await expectPgError(
        withSuperuser((c) =>
          c.query("update public.tenant_members set role_id = $1 where tenant_id = $2 and user_id = $3", [
            fx.roleIds.ADMIN,
            fx.tenantA,
            fx.userAOwner,
          ]),
        ),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514");
    });

    it("com um segundo OWNER ativo, remover um dos dois é permitido", async () => {
      const secondOwnerId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`second-owner-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      const memberId = await insertSecondOwnerDirectly(fx.tenantA, secondOwnerId, fx.roleIds.OWNER);

      const result = await withSuperuser((c) => c.query("delete from public.tenant_members where id = $1", [memberId]));
      expect(result.rowCount).toBe(1);
    });

    it("não bloqueia remover/rebaixar um membro que NÃO é OWNER", async () => {
      const memberId = await withSuperuser(async (c) => {
        const userId = (
          await c.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
            `non-owner-${fx.tenantA}@fixtures.test`,
          ])
        ).rows[0]!.id;
        const { rows } = await c.query<{ id: string }>(
          "insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'active') returning id",
          [fx.tenantA, userId, fx.roleIds.OPERATOR],
        );
        return rows[0]!.id;
      });

      const result = await withSuperuser((c) => c.query("delete from public.tenant_members where id = $1", [memberId]));
      expect(result.rowCount).toBe(1);
    });

    it("D18.3.1 — rebaixa OWNER quando existem dois (caminho de UPDATE, não só DELETE)", async () => {
      const secondOwnerId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`demote-second-owner-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      const memberId = await insertSecondOwnerDirectly(fx.tenantA, secondOwnerId, fx.roleIds.OWNER);

      const result = await withSuperuser((c) =>
        c.query("update public.tenant_members set role_id = $1 where id = $2", [fx.roleIds.ADMIN, memberId]),
      );
      expect(result.rowCount).toBe(1);

      await withSuperuser((c) => c.query("delete from public.tenant_members where id = $1", [memberId]));
    });

    it("D18.3.1 — um OWNER com status 'invited' não conta como OWNER ativo (não protege o único OWNER real)", async () => {
      const invitedOwnerId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`invited-owner-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      await insertSecondOwnerDirectly(fx.tenantA, invitedOwnerId, fx.roleIds.OWNER, "invited");

      // fx.userAOwner continua sendo o ÚNICO OWNER ativo — mesmo com um segundo OWNER 'invited' existindo.
      const err = await expectPgError(
        withSuperuser((c) => c.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, fx.userAOwner])),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514");

      await withSuperuser((c) => c.query("delete from public.tenant_members where user_id = $1", [invitedOwnerId]));
    });

    it("D18.3.1 — um OWNER com status 'removed' não conta como OWNER ativo", async () => {
      const removedOwnerId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`removed-owner-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      // Insere já como 'active' (INSERT com status 'removed' direto não é um fluxo real do app,
      // mas o schema permite) e então transiciona para 'removed' via UPDATE de status, para
      // provar que o trigger reavalia o estado real, não um valor assumido.
      await withSuperuser((c) =>
        c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'active')", [
          fx.tenantA,
          removedOwnerId,
          fx.roleIds.OPERATOR,
        ]),
      );
      await withSuperuser((c) => c.query("update public.tenant_members set status = 'removed' where user_id = $1", [removedOwnerId]));

      const err = await expectPgError(
        withSuperuser((c) => c.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, fx.userAOwner])),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514");

      await withSuperuser((c) => c.query("delete from public.tenant_members where user_id = $1", [removedOwnerId]));
    });

    it("D18.3.1 — duas remoções concorrentes dos 2 únicos OWNERs ativos NUNCA deixam o tenant sem OWNER (advisory lock)", async () => {
      const ownerBUserId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`race-owner-b-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      const ownerAMemberId = await withSuperuser((c) =>
        c.query<{ id: string }>("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, fx.userAOwner]),
      ).then((r) => r.rows[0]!.id);
      const ownerBMemberId = await insertSecondOwnerDirectly(fx.tenantA, ownerBUserId, fx.roleIds.OWNER);

      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query("begin");
        await clientA.query("set local role service_role");
        await clientB.query("begin");
        await clientB.query("set local role service_role");

        const runA = clientA
          .query("delete from public.tenant_members where id = $1", [ownerAMemberId])
          .then(() => clientA.query("commit"))
          .then(() => "fulfilled" as const)
          .catch(async (e: unknown) => {
            await clientA.query("rollback").catch(() => {});
            throw e;
          });

        const runB = clientB
          .query("delete from public.tenant_members where id = $1", [ownerBMemberId])
          .then(() => clientB.query("commit"))
          .then(() => "fulfilled" as const)
          .catch(async (e: unknown) => {
            await clientB.query("rollback").catch(() => {});
            throw e;
          });

        const settled = await Promise.allSettled([runA, runB]);
        const succeeded = settled.filter((s) => s.status === "fulfilled").length;
        // Exatamente uma das duas remoções concorrentes deve ter sucesso — nunca as duas.
        expect(succeeded).toBe(1);
      } finally {
        clientA.release();
        clientB.release();
      }

      const { rows } = await withSuperuser((c) =>
        c.query<{ n: number }>(
          `select count(*)::int as n from public.tenant_members tm join public.roles r on r.id = tm.role_id
           where tm.tenant_id = $1 and tm.status = 'active' and r.key = 'OWNER'`,
          [fx.tenantA],
        ),
      );
      // Nunca zero (o objetivo da correção) — e nunca dois (uma das duas remoções teve que passar).
      expect(rows[0]!.n).toBe(1);

      // Restaura o tenant A para 1 OWNER ativo (fx.userAOwner) para não vazar estado para outros testes deste arquivo.
      const { rows: remaining } = await withSuperuser((c) =>
        c.query<{ user_id: string }>(
          `select tm.user_id from public.tenant_members tm join public.roles r on r.id = tm.role_id
           where tm.tenant_id = $1 and tm.status = 'active' and r.key = 'OWNER'`,
          [fx.tenantA],
        ),
      );
      if (remaining[0]?.user_id !== fx.userAOwner) {
        await insertSecondOwnerDirectly(fx.tenantA, fx.userAOwner, fx.roleIds.OWNER);
      }
    });
  });

  describe("D18.3.1 — regressão do RBAC (team.manage/team.view não vazaram para outros papéis)", () => {
    it("MANAGER/OPERATOR/SUPPORT continuam sem team.manage nem team.view (matriz de permissões da Etapa 2, intocada)", async () => {
      const { rows } = await withSuperuser((c) =>
        c.query<{ role_key: string; permission_key: string }>(
          `select r.key as role_key, p.key as permission_key
           from public.roles r
           join public.role_permissions rp on rp.role_id = r.id
           join public.permissions p on p.id = rp.permission_id
           where r.key in ('MANAGER', 'OPERATOR', 'SUPPORT') and p.key in ('team.manage', 'team.view')`,
        ),
      );
      expect(rows).toHaveLength(0);
    });

    it("OWNER e ADMIN continuam com team.manage e team.view (regressão)", async () => {
      const { rows } = await withSuperuser((c) =>
        c.query<{ role_key: string; permission_key: string }>(
          `select r.key as role_key, p.key as permission_key
           from public.roles r
           join public.role_permissions rp on rp.role_id = r.id
           join public.permissions p on p.id = rp.permission_id
           where r.key in ('OWNER', 'ADMIN') and p.key in ('team.manage', 'team.view')
           order by r.key, p.key`,
        ),
      );
      expect(rows).toEqual([
        { role_key: "ADMIN", permission_key: "team.manage" },
        { role_key: "ADMIN", permission_key: "team.view" },
        { role_key: "OWNER", permission_key: "team.manage" },
        { role_key: "OWNER", permission_key: "team.view" },
      ]);
    });
  });

  describe("D18.3.1 — bloqueio de OWNER via INSERT (prevent_unauthorized_owner_insert)", () => {
    it("INSERT direto com role OWNER em um tenant que já tem membros é bloqueado", async () => {
      const userId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`insert-owner-blocked-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });

      const err = await expectPgError(
        asActor(
          { role: "service_role" },
          (c) =>
            c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited')", [
              fx.tenantA,
              userId,
              fx.roleIds.OWNER,
            ]),
          { commit: false },
        ),
      );
      expect((err as unknown as { code?: string }).code).toBe("42501");
    });

    it("INSERT com role não-OWNER continua funcionando normalmente (regressão)", async () => {
      const userId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`insert-admin-ok-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });

      const result = await asActor(
        { role: "service_role" },
        (c) =>
          c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited') returning id", [
            fx.tenantA,
            userId,
            fx.roleIds.ADMIN,
          ]),
        { commit: false },
      );
      expect(result.rowCount).toBe(1);
    });

    it("create_tenant() continua conseguindo criar o OWNER inicial de um tenant novo (regressão)", async () => {
      const newOwnerUserId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`founding-owner-${Date.now()}@fixtures.test`],
        );
        return rows[0]!.id;
      });

      const result = await asActor(
        { role: "authenticated", userId: newOwnerUserId },
        (c) => c.query<{ id: string }>("select (public.create_tenant($1, $2)).id as id", [`Loja Fundação ${Date.now()}`, `loja-fundacao-${Date.now()}`]),
        { commit: true },
      );
      const newTenantId = result.rows[0]!.id;

      const { rows: memberRows } = await withSuperuser((c) =>
        c.query<{ status: string; role_key: string }>(
          `select tm.status, r.key as role_key from public.tenant_members tm join public.roles r on r.id = tm.role_id
           where tm.tenant_id = $1 and tm.user_id = $2`,
          [newTenantId, newOwnerUserId],
        ),
      );
      expect(memberRows[0]).toMatchObject({ status: "active", role_key: "OWNER" });
    });
  });

  describe("D18.3.1 — team_member_profiles (view estreita, colunas limitadas)", () => {
    it("expõe só id/full_name/email — nunca phone/cpf_hash (a coluna simplesmente não existe na view)", async () => {
      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
          c.query("select phone from public.team_member_profiles where id = $1", [fx.userAManager]),
        ),
      );
      expect((err as unknown as { message?: string }).message ?? "").toMatch(/column .*phone.* does not exist/i);
    });

    it("OWNER com team.view consegue ler nome/e-mail de um colega através da view", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id, full_name, email from public.team_member_profiles where id = $1", [fx.userAManager]),
      );
      expect(result.rowCount).toBe(1);
    });

    it("a RLS de profiles continua sendo a autoridade: MANAGER sem team.view não vê colega através da view", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("select id from public.team_member_profiles where id = $1", [fx.userAOwner]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("isolamento entre tenants continua valendo através da view", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.team_member_profiles where id = $1", [fx.userBOwner]),
      );
      expect(result.rowCount).toBe(0);
    });
  });

  describe("accept_tenant_invite()", () => {
    it("transiciona a própria linha invited -> active", async () => {
      const userId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`accept-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      await withSuperuser((c) =>
        c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited')", [
          fx.tenantA,
          userId,
          fx.roleIds.OPERATOR,
        ]),
      );

      await asActor({ role: "authenticated", userId }, (c) => c.query("select public.accept_tenant_invite()"), { commit: true });

      const { rows } = await withSuperuser((c) =>
        c.query<{ status: string }>("select status from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, userId]),
      );
      expect(rows[0]).toMatchObject({ status: "active" });
    });

    it("nunca aceita convite de outro usuário (auth.uid() é sempre interno, nunca parâmetro)", async () => {
      const userId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into auth.users (email) values ($1) returning id",
          [`isolamento-${fx.tenantA}@fixtures.test`],
        );
        return rows[0]!.id;
      });
      await withSuperuser((c) =>
        c.query("insert into public.tenant_members (tenant_id, user_id, role_id, status) values ($1, $2, $3, 'invited')", [
          fx.tenantA,
          userId,
          fx.roleIds.OPERATOR,
        ]),
      );

      // fx.userOutsider chama a RPC — não deve afetar o convite de `userId`.
      await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) => c.query("select public.accept_tenant_invite()"), {
        commit: true,
      });

      const { rows } = await withSuperuser((c) =>
        c.query<{ status: string }>("select status from public.tenant_members where tenant_id = $1 and user_id = $2", [fx.tenantA, userId]),
      );
      expect(rows[0]).toMatchObject({ status: "invited" });
    });

    it("sem nenhuma linha invited, é um no-op seguro (sem erro)", async () => {
      await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) => c.query("select public.accept_tenant_invite()"), {
        commit: false,
      });
    });
  });

  describe("RLS de profiles — visibilidade de colegas de equipe (team.view)", () => {
    it("OWNER (tem team.view) consegue ver o perfil de outro membro do mesmo tenant", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.profiles where id = $1", [fx.userAManager]),
      );
      expect(result.rowCount).toBe(1);
    });

    it("MANAGER (sem team.view) não consegue ver o perfil de outro membro", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("select id from public.profiles where id = $1", [fx.userAOwner]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("usuário sem tenant_members (outsider) não consegue ver perfil de ninguém além do próprio", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select id from public.profiles where id = $1", [fx.userAOwner]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("isolamento entre tenants: OWNER do tenant A não vê perfil de membro exclusivo do tenant B", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.profiles where id = $1", [fx.userBOwner]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("cada usuário sempre continua vendo o próprio perfil (policy pré-existente, não alterada)", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("select id from public.profiles where id = $1", [fx.userAManager]),
      );
      expect(result.rowCount).toBe(1);
    });
  });
});
