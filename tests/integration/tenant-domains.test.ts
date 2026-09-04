/**
 * D17.2 — cadastro de domínio no painel (`features/settings/domain-actions.ts`).
 *
 * A tabela `tenant_domains` (D17.1) só tem uma policy pública de SELECT
 * para `anon` (`status = 'active'`) — nenhuma policy de INSERT/UPDATE/
 * DELETE para `anon` nem `authenticated`, de propósito, e esta etapa não
 * altera isso. `addCustomDomainAction` opera via `service_role` depois de
 * validar auth → membership → permissão → tenant_id no próprio código da
 * Action (não testável aqui sem o runtime do Next.js/Server Actions —
 * ver relatório D17.2). O que ESTE arquivo confirma é a garantia de banco
 * por trás dessa Action: `authenticated`/`anon` continuam sem acesso
 * direto (mesmo um OWNER não pode contornar a Action escrevendo direto),
 * e o `UNIQUE(domain)` é a autoridade final contra duplicidade/
 * cross-tenant mesmo sob corrida — exatamente como a Action assume.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("tenant_domains — cadastro de domínio (D17.2)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("authenticated (mesmo OWNER do tenant) não consegue inserir em tenant_domains diretamente — sem policy de INSERT para authenticated", async () => {
    await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, `owner-direct-${fx.tenantA}.example.com`],
          ),
        { commit: false },
      ),
    );
  });

  it("anon não consegue inserir em tenant_domains", async () => {
    await expectPgError(
      asActor(
        { role: "anon" },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, `anon-direct-${fx.tenantA}.example.com`],
          ),
        { commit: false },
      ),
    );
  });

  it("service_role consegue inserir exatamente no formato que a Action usa: domain_type=custom, status=pending, verified_at nulo", async () => {
    const domain = `service-role-${fx.tenantA}.example.com`;
    const result = await asActor(
      { role: "service_role" },
      (c) =>
        c.query(
          "insert into public.tenant_domains (tenant_id, domain, domain_type, is_primary, status) values ($1, $2, 'custom', true, 'pending') returning domain, domain_type, status, verified_at, is_primary",
          [fx.tenantA, domain],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({
      domain,
      domain_type: "custom",
      status: "pending",
      verified_at: null,
      is_primary: true,
    });
  });

  it("UNIQUE(domain) impede que o mesmo domínio seja cadastrado duas vezes pelo MESMO tenant", async () => {
    const domain = `duplicado-mesmo-tenant-${fx.tenantA}.example.com`;
    await expectPgError(
      asActor(
        { role: "service_role" },
        async (c) => {
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, domain],
          );
          // segunda tentativa, mesmo tenant, mesmo domínio — deve falhar.
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, domain],
          );
        },
        { commit: false },
      ),
    );
  });

  it("UNIQUE(domain) impede que um domínio já usado por um tenant seja assumido por outro tenant, mesmo sob corrida na mesma transação", async () => {
    const domain = `duplicado-outro-tenant-${fx.tenantA}.example.com`;
    await expectPgError(
      asActor(
        { role: "service_role" },
        async (c) => {
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, domain],
          );
          // mesma corrida que addCustomDomainAction previne com a
          // checagem prévia — aqui simulada faltando de propósito, para
          // provar que o UNIQUE(domain) do banco continua sendo a
          // garantia final independentemente da Action.
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantB, domain],
          );
        },
        { commit: false },
      ),
    );
  });

  it("no máximo um domínio primário por tenant continua valendo (índice parcial de D17.1, não alterado aqui)", async () => {
    await expectPgError(
      asActor(
        { role: "service_role" },
        async (c) => {
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, is_primary, status) values ($1, $2, 'custom', true, 'pending')",
            [fx.tenantA, `primario-1-${fx.tenantA}.example.com`],
          );
          await c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, is_primary, status) values ($1, $2, 'custom', true, 'pending')",
            [fx.tenantA, `primario-2-${fx.tenantA}.example.com`],
          );
        },
        { commit: false },
      ),
    );
  });

  it("anon continua vendo só domínios status='active' (RLS de D17.1 preservada, não alterada por esta etapa)", async () => {
    const activeDomain = `anon-visivel-${fx.tenantA}.example.com`;
    const pendingDomain = `anon-invisivel-${fx.tenantA}.example.com`;

    await withSuperuser((c) =>
      c.query(
        "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'active'), ($1, $3, 'custom', 'pending')",
        [fx.tenantA, activeDomain, pendingDomain],
      ),
    );

    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select domain from public.tenant_domains where domain in ($1, $2)", [activeDomain, pendingDomain]),
    );

    expect(result.rows.map((r: { domain: string }) => r.domain)).toEqual([activeDomain]);

    await withSuperuser((c) => c.query("delete from public.tenant_domains where domain in ($1, $2)", [activeDomain, pendingDomain]));
  });
});
