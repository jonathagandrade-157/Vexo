/**
 * D18.2 — RLS `authenticated` em `tenant_domains` (migration
 * 20260817220104). Antes desta migration, `tenant_domains` só tinha
 * policy de SELECT para `anon` (`status='active'`, D17.1) — todo acesso
 * autenticado só era possível via `service_role` (RLS nega por padrão sem
 * policy, mesma garantia já testada em `tenant-domains.test.ts`, D17.2).
 *
 * Este arquivo testa exclusivamente a NOVA camada de RLS para
 * `authenticated`, direto via SQL (asActor/withSuperuser), nunca através
 * do runtime do Next.js — mesmo padrão de todo o projeto.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("tenant_domains — RLS authenticated (D18.2)", () => {
  let fx: Fixtures;
  let domainA: string;
  let domainB: string;
  let activeDomainA: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    domainA = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
        [fx.tenantA, `d18-2-a-${fx.tenantA}.example.com`],
      );
      return rows[0]!.id;
    });

    domainB = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
        [fx.tenantB, `d18-2-b-${fx.tenantB}.example.com`],
      );
      return rows[0]!.id;
    });

    activeDomainA = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'active') returning id",
        [fx.tenantA, `d18-2-active-a-${fx.tenantA}.example.com`],
      );
      return rows[0]!.id;
    });
  });

  afterAll(async () => {
    await withSuperuser((c) => c.query("delete from public.tenant_domains where id in ($1, $2, $3)", [domainA, domainB, activeDomainA]));
    await pool.end();
  });

  describe("SELECT", () => {
    it("authenticated do Tenant A (OWNER) consegue SELECT dos próprios domínios", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.tenant_domains where tenant_id = $1", [fx.tenantA]),
      );
      expect(result.rows.map((r: { id: string }) => r.id)).toContain(domainA);
    });

    it("authenticated do Tenant A não consegue SELECT domínio do Tenant B", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select id from public.tenant_domains where id = $1", [domainB]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("usuário sem tenant_members (outsider) não obtém acesso a nenhum domínio", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select id from public.tenant_domains where tenant_id in ($1, $2)", [fx.tenantA, fx.tenantB]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("platform_admin não recebe acesso implícito a tenant_domains só por ser platform_admin", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
        c.query("select id from public.tenant_domains where tenant_id in ($1, $2)", [fx.tenantA, fx.tenantB]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("MANAGER (sem settings.update, mas membro ativo) ainda consegue SELECT — visualização não exige settings.update", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("select id from public.tenant_domains where id = $1", [domainA]),
      );
      expect(result.rowCount).toBe(1);
    });

    it("isolamento: um SELECT sem filtro de tenant_id nunca retorna linha de outro tenant", async () => {
      const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) => c.query("select tenant_id from public.tenant_domains"));
      expect(result.rows.every((r: { tenant_id: string }) => r.tenant_id === fx.tenantA)).toBe(true);
    });
  });

  describe("INSERT", () => {
    it("OWNER do Tenant A (com settings.update) consegue INSERT em tenant_domains do próprio tenant", async () => {
      const domain = `d18-2-insert-owner-${fx.tenantA}.example.com`;
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
            [fx.tenantA, domain],
          ),
        { commit: false },
      );
      expect(result.rowCount).toBe(1);
    });

    it("authenticated do Tenant A não consegue INSERT em tenant_domains do Tenant B (tenant_id não é fonte de autorização)", async () => {
      await expectPgError(
        asActor(
          { role: "authenticated", userId: fx.userAOwner },
          (c) =>
            c.query(
              "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
              [fx.tenantB, `d18-2-insert-cross-${fx.tenantB}.example.com`],
            ),
          { commit: false },
        ),
      );
    });

    it("MANAGER (sem settings.update) não consegue INSERT, mesmo sendo membro ativo do tenant", async () => {
      await expectPgError(
        asActor(
          { role: "authenticated", userId: fx.userAManager },
          (c) =>
            c.query(
              "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
              [fx.tenantA, `d18-2-insert-manager-${fx.tenantA}.example.com`],
            ),
          { commit: false },
        ),
      );
    });

    it("usuário sem tenant_members não consegue INSERT em nenhum tenant", async () => {
      await expectPgError(
        asActor(
          { role: "authenticated", userId: fx.userOutsider },
          (c) =>
            c.query(
              "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
              [fx.tenantA, `d18-2-insert-outsider-${fx.tenantA}.example.com`],
            ),
          { commit: false },
        ),
      );
    });
  });

  describe("UPDATE", () => {
    it("OWNER do Tenant A (com settings.update) consegue UPDATE do próprio domínio", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenant_domains set status = 'verifying' where id = $1", [domainA]),
        { commit: false },
      );
      expect(result.rowCount).toBe(1);
    });

    it("authenticated do Tenant A não consegue UPDATE domínio do Tenant B", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenant_domains set status = 'active' where id = $1", [domainB]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });

    it("MANAGER (sem settings.update) não consegue UPDATE, mesmo em domínio do próprio tenant", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAManager },
        (c) => c.query("update public.tenant_domains set status = 'active' where id = $1", [domainA]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });
  });

  describe("DELETE", () => {
    it("OWNER do Tenant A (com settings.update) consegue DELETE do próprio domínio", async () => {
      const tempId = await withSuperuser(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
          [fx.tenantA, `d18-2-delete-owner-${fx.tenantA}.example.com`],
        );
        return rows[0]!.id;
      });
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.tenant_domains where id = $1", [tempId]),
        { commit: true },
      );
      expect(result.rowCount).toBe(1);
    });

    it("authenticated do Tenant A não consegue DELETE domínio do Tenant B", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.tenant_domains where id = $1", [domainB]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });

    it("MANAGER (sem settings.update) não consegue DELETE, mesmo em domínio do próprio tenant", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAManager },
        (c) => c.query("delete from public.tenant_domains where id = $1", [domainA]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });
  });

  describe("anon — preservado exatamente como antes (D17.1)", () => {
    it("anon continua conseguindo SELECT somente domínios status='active'", async () => {
      const result = await asActor({ role: "anon" }, (c) => c.query("select id, status from public.tenant_domains where id in ($1, $2)", [domainA, activeDomainA]));
      const ids = result.rows.map((r: { id: string }) => r.id);
      expect(ids).toContain(activeDomainA);
      expect(ids).not.toContain(domainA);
    });

    it("anon não consegue INSERT", async () => {
      await expectPgError(
        asActor(
          { role: "anon" },
          (c) =>
            c.query(
              "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
              [fx.tenantA, `d18-2-anon-insert-${fx.tenantA}.example.com`],
            ),
          { commit: false },
        ),
      );
    });

    it("anon não consegue UPDATE (nem domínio ativo)", async () => {
      const result = await asActor(
        { role: "anon" },
        (c) => c.query("update public.tenant_domains set domain_type = 'subdomain' where id = $1", [activeDomainA]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });

    it("anon não consegue DELETE (nem domínio ativo)", async () => {
      const result = await asActor(
        { role: "anon" },
        (c) => c.query("delete from public.tenant_domains where id = $1", [activeDomainA]),
        { commit: false },
      );
      expect(result.rowCount).toBe(0);
    });
  });

  describe("FORCE ROW LEVEL SECURITY preservado", () => {
    it("relrowsecurity e relforcerowsecurity continuam true em tenant_domains", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.tenant_domains'::regclass",
        ),
      );
      expect(result.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });
});
