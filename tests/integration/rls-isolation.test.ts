/**
 * Etapa 2 — testes de isolamento multi-tenant e segurança de RLS
 * (arquitetura §20/§25.1; itens 20 e 26 do prompt da Etapa 2 — os 13
 * cenários obrigatórios, mais algumas extensões cobrindo os mecanismos
 * adicionais implementados nas migrations: bloqueio de auto-promoção via
 * trigger, restrição de quem pode conceder OWNER, e restrição de quem
 * pode mudar tenants.status).
 *
 * Roda contra um Postgres real (não um mock) usando o stub de
 * tests/integration/fixtures/supabase-stub.sql — ver o relatório da
 * Etapa 2 para por que isto substitui `supabase start` neste ambiente.
 *
 * Opt-in via RUN_INTEGRATION_TESTS=1 (setado pelo CI depois de rodar
 * `npm run db:test:reset`), para que `npm test` continue rápido e
 * hermético para quem não tem Postgres local configurado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)(
  "RLS isolation (Etapa 2)",
  () => {
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await buildFixtures();
    });

    afterAll(async () => {
      await pool.end();
    });

    // TESTE 1: Usuário A acessa tenant A -> permitido.
    it("a tenant member can select their own tenant", async () => {
      const rows = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select id from public.tenants where id = $1", [fx.tenantA]),
      );
      expect(rows.rows).toHaveLength(1);
    });

    // TESTE 2: Usuário A tenta acessar tenant B -> bloqueado (RLS filtra,
    // não lança erro — é assim que SELECT com RLS nega por padrão).
    it("a tenant member cannot select a tenant they don't belong to", async () => {
      const rows = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select id from public.tenants where id = $1", [fx.tenantB]),
      );
      expect(rows.rows).toHaveLength(0);
    });

    // TESTE 3: Usuário A tenta UPDATE alterando tenant_id A -> B -> bloqueado.
    // Testado via service_role (bypassa RLS por completo) para isolar
    // especificamente a proteção do trigger de imutabilidade (0008) — se
    // testado via `authenticated`, a própria policy de RLS já rejeitaria a
    // linha antes do trigger entrar em ação, o que provaria a policy, não
    // o trigger (defesa em profundidade exige testar as duas camadas
    // separadamente).
    it("tenant_id cannot be changed on an existing tenant_members row (tenant hopping)", async () => {
      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query(
            "update public.tenant_members set tenant_id = $1 where tenant_id = $2 and user_id = $3",
            [fx.tenantB, fx.tenantA, fx.userAManager],
          ),
        ),
      );
      expect(err.message).toMatch(/tenant_id is immutable/);
    });

    // TESTE 4: Usuário comum tenta se promover para OWNER -> bloqueado.
    // A policy de UPDATE já exclui `user_id = auth.uid()` do USING, então
    // a linha nem fica visível para o próprio UPDATE (0 linhas afetadas,
    // sem erro) — e o trigger prevent_self_role_change cobriria o caso
    // mesmo que a policy um dia mudasse.
    it("a member cannot promote themselves to OWNER", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAManager },
        (c) =>
          c.query(
            "update public.tenant_members set role_id = $1 where tenant_id = $2 and user_id = $3",
            [fx.roleIds.OWNER, fx.tenantA, fx.userAManager],
          ),
      );
      expect(result.rowCount).toBe(0);

      const stillManager = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "select role_id from public.tenant_members where tenant_id = $1 and user_id = $2",
            [fx.tenantA, fx.userAManager],
          ),
      );
      expect(stillManager.rows[0]?.role_id).toBe(fx.roleIds.MANAGER);
    });

    // TESTE 5: Usuário tenta inserir a si próprio como OWNER -> bloqueado.
    it("a user cannot insert themselves as OWNER of a tenant", async () => {
      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
          c.query(
            "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
            [fx.tenantA, fx.userOutsider, fx.roleIds.OWNER],
          ),
        ),
      );
      expect(err.message).toMatch(/row-level security/i);
    });

    // TESTE 6: Usuário não associado ao tenant tenta inserir registro
    // (qualquer papel, não só OWNER) -> bloqueado. Não existe policy de
    // INSERT para authenticated em tenant_members — a via legítima é
    // public.create_tenant() (para o primeiro OWNER) ou uma função de
    // convite (etapa futura), nunca um INSERT livre do client.
    it("an unaffiliated user cannot insert a membership row at all", async () => {
      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
          c.query(
            "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
            [fx.tenantA, fx.userOutsider, fx.roleIds.MANAGER],
          ),
        ),
      );
      expect(err.message).toMatch(/row-level security/i);
    });

    // TESTE 7: Usuário de tenant A tenta atualizar registro de tenant B ->
    // bloqueado (0 linhas afetadas, RLS filtra a linha antes do UPDATE).
    it("a tenant A member cannot update a tenant B row", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set name = 'hacked' where id = $1", [fx.tenantB]),
      );
      expect(result.rowCount).toBe(0);

      const untouched = await asActor(
        { role: "authenticated", userId: fx.userBOwner },
        (c) => c.query("select name from public.tenants where id = $1", [fx.tenantB]),
      );
      expect(untouched.rows[0]?.name).toBe("Tenant B");
    });

    // TESTE 8: Usuário tenta DELETE audit_logs -> bloqueado. Testado via
    // service_role especificamente: é o papel com BYPASSRLS, então este é
    // o caso que realmente comprova que a proteção não depende só de RLS
    // (arquitetura §18.2/§25.1).
    it("service_role cannot delete audit_logs rows (REVOKE, not just RLS)", async () => {
      const { rows } = await asActor({ role: "service_role" }, (c) =>
        c.query("select id from public.audit_logs limit 1"),
      );
      expect(rows.length).toBeGreaterThan(0);

      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("delete from public.audit_logs where id = $1", [rows[0]?.id]),
        ),
      );
      expect(err.message).toMatch(/permission denied|append-only/i);
    });

    // TESTE 9: Usuário tenta UPDATE audit_logs -> bloqueado (mesmo motivo
    // do teste 8).
    it("service_role cannot update audit_logs rows (REVOKE, not just RLS)", async () => {
      const { rows } = await asActor({ role: "service_role" }, (c) =>
        c.query("select id from public.audit_logs limit 1"),
      );

      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("update public.audit_logs set reason = 'tampered' where id = $1", [rows[0]?.id]),
        ),
      );
      expect(err.message).toMatch(/permission denied|append-only/i);
    });

    // TESTE 10: Usuário comum tenta criar platform_admin -> bloqueado.
    // Testado também via service_role: "a gestão de platform_admins deve
    // ocorrer fora do fluxo normal do frontend/aplicação" — nem o código
    // server-side da própria aplicação deve conseguir isso.
    it("neither authenticated nor service_role can insert a platform_admin", async () => {
      const asUser = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
          c.query(
            "insert into public.platform_admins (user_id, role) values ($1, 'MASTER')",
            [fx.userAOwner],
          ),
        ),
      );
      expect(asUser.message).toMatch(/permission denied/i);

      const asService = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query(
            "insert into public.platform_admins (user_id, role) values ($1, 'MASTER')",
            [fx.userAOwner],
          ),
        ),
      );
      expect(asService.message).toMatch(/permission denied/i);
    });

    // TESTE 11: Usuário comum tenta alterar platform_admin -> bloqueado
    // (mesmas duas camadas do teste 10).
    it("neither authenticated nor service_role can update a platform_admin", async () => {
      const asUser = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
          c.query("update public.platform_admins set role = 'SUPPORT_AGENT' where user_id = $1", [
            fx.userMaster,
          ]),
        ),
      );
      expect(asUser.message).toMatch(/permission denied/i);

      const asService = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("update public.platform_admins set role = 'SUPPORT_AGENT' where user_id = $1", [
            fx.userMaster,
          ]),
        ),
      );
      expect(asService.message).toMatch(/permission denied/i);
    });

    // TESTE 12: Usuário autenticado sem membership tenta acessar dados do
    // tenant -> bloqueado.
    it("a user with no membership sees no tenants or tenant_members", async () => {
      const tenants = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select id from public.tenants"),
      );
      expect(tenants.rows).toHaveLength(0);

      const members = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select id from public.tenant_members where tenant_id = $1", [fx.tenantA]),
      );
      expect(members.rows).toHaveLength(0);
    });

    // TESTE 13: service_role continua exigindo filtros explícitos de
    // tenant quando usado pela aplicação — este teste comprova, de
    // propósito, o RISCO que motiva essa regra: service_role tem
    // BYPASSRLS de verdade, então uma query sem WHERE tenant_id devolve
    // linhas de todos os tenants. A proteção contra isso não pode vir do
    // banco — tem que vir de todo Server Action/Route Handler que usa
    // service_role sempre incluir o filtro (arquitetura §3.4.1/§17), o
    // que este teste documenta explicitamente em vez de assumir.
    it("service_role bypasses RLS entirely — the app, not the DB, must filter by tenant", async () => {
      const rows = await asActor({ role: "service_role" }, (c) =>
        c.query("select id from public.tenants where id in ($1, $2)", [fx.tenantA, fx.tenantB]),
      );
      // Sem WHERE tenant_id explícito por quem chama, service_role vê as
      // duas tenants — não é um bug desta suíte, é o comportamento real do
      // Postgres para um papel com BYPASSRLS, documentado aqui como razão
      // pela qual §3.4.1/§17 exigem filtro explícito em todo uso de
      // service_role.
      expect(rows.rows.map((r: { id: string }) => r.id).sort()).toEqual(
        [fx.tenantA, fx.tenantB].sort(),
      );
    });

    // --- Extensões: mecanismos adicionais além dos 13 cenários mínimos ---

    it("[extra] an ADMIN with team.manage cannot grant OWNER to someone else", async () => {
      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAAdmin }, (c) =>
          c.query(
            "update public.tenant_members set role_id = $1 where tenant_id = $2 and user_id = $3",
            [fx.roleIds.OWNER, fx.tenantA, fx.userAManager],
          ),
        ),
      );
      expect(err.message).toMatch(/only an existing OWNER/);
    });

    it("[extra] an OWNER can promote another member's role (not to OWNER)", async () => {
      // Sem { commit: true }: a mudança é revertida ao final deste teste
      // (rollback padrão de asActor), então outros testes deste arquivo
      // continuam podendo assumir que userAManager = MANAGER.
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "update public.tenant_members set role_id = $1 where tenant_id = $2 and user_id = $3",
            [fx.roleIds.OPERATOR, fx.tenantA, fx.userAManager],
          ),
      );
      expect(result.rowCount).toBe(1);
    });

    it("[extra] an OWNER cannot change their own tenant's status (MASTER-only)", async () => {
      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
          c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantA]),
        ),
      );
      expect(err.message).toMatch(/only be changed by a platform admin/);
    });

    it("[extra] a platform admin (MASTER) can change tenant status, and it is audited", async () => {
      // { commit: true }: precisamos que o UPDATE (e o INSERT em
      // audit_logs feito pelo trigger) realmente persistam para a
      // consulta seguinte, numa transação separada, conseguir enxergá-los.
      const result = await asActor(
        { role: "authenticated", userId: fx.userMaster },
        (c) => c.query("update public.tenants set status = 'active' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      expect(result.rowCount).toBe(1);

      const log = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
        c.query(
          "select action, actor_type from public.audit_logs where tenant_id = $1 and action = 'TENANT_STATUS_CHANGED' order by created_at desc limit 1",
          [fx.tenantA],
        ),
      );
      expect(log.rows[0]?.actor_type).toBe("master");
    });

    it("[extra] public.create_tenant() atomically creates a tenant and its OWNER membership", async () => {
      // { commit: true }: a verificação de membership abaixo roda numa
      // transação separada e precisa enxergar o que create_tenant() gravou.
      const created = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Outsider Store", "outsider-store"]),
        { commit: true },
      );
      const newTenantId = created.rows[0]?.id as string;
      expect(newTenantId).toBeTruthy();
      expect(created.rows[0]?.status).toBe("pending");

      const membership = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) =>
          c.query(
            "select r.key from public.tenant_members tm join public.roles r on r.id = tm.role_id where tm.tenant_id = $1 and tm.user_id = $2",
            [newTenantId, fx.userOutsider],
          ),
      );
      expect(membership.rows[0]?.key).toBe("OWNER");
    });

    it("[extra] anon cannot read tenants, tenant_members, or platform_admins", async () => {
      const tenants = await asActor({ role: "anon" }, (c) =>
        c.query("select id from public.tenants"),
      );
      expect(tenants.rows).toHaveLength(0);

      const members = await asActor({ role: "anon" }, (c) =>
        c.query("select id from public.tenant_members"),
      );
      expect(members.rows).toHaveLength(0);

      const admins = await asActor({ role: "anon" }, (c) =>
        c.query("select id from public.platform_admins"),
      );
      expect(admins.rows).toHaveLength(0);
    });
  },
);
