/**
 * D17.3.1 — fundação de dados do desafio de verificação de domínio
 * (migration 20260817220101, `lib/security/domain-challenge.ts`).
 *
 * Cobre só as garantias de BANCO introduzidas por esta etapa — geração,
 * hash e comparação do challenge já são testados em
 * tests/unit/domain-challenge.test.ts. Nenhuma consulta DNS real, nenhuma
 * Server Action, nenhuma transição de status é exercida aqui (não existem
 * ainda — D17.3.2).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("tenant_domains — fundação do desafio de verificação (D17.3.1)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("verification_method aceita 'dns_txt'", async () => {
    const domain = `verif-metodo-ok-${fx.tenantA}.example.com`;
    const result = await asActor(
      { role: "service_role" },
      (c) =>
        c.query(
          "insert into public.tenant_domains (tenant_id, domain, domain_type, status, verification_method) values ($1, $2, 'custom', 'pending', 'dns_txt') returning verification_method",
          [fx.tenantA, domain],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ verification_method: "dns_txt" });
  });

  it("verification_method rejeita qualquer outro valor", async () => {
    const domain = `verif-metodo-invalido-${fx.tenantA}.example.com`;
    await expectPgError(
      asActor(
        { role: "service_role" },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status, verification_method) values ($1, $2, 'custom', 'pending', 'http_file')",
            [fx.tenantA, domain],
          ),
        { commit: false },
      ),
    );
  });

  it("cadastro no formato do D17.2 continua criando o domínio como pending, com todos os campos de verificação NULL", async () => {
    const domain = `cadastro-d17-2-${fx.tenantA}.example.com`;
    const result = await asActor(
      { role: "service_role" },
      (c) =>
        c.query(
          `insert into public.tenant_domains (tenant_id, domain, domain_type, is_primary, status)
           values ($1, $2, 'custom', false, 'pending')
           returning status, verified_at, verification_method, verification_token_hash, verification_started_at, verification_expires_at, last_verification_at`,
          [fx.tenantA, domain],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({
      status: "pending",
      verified_at: null,
      verification_method: null,
      verification_token_hash: null,
      verification_started_at: null,
      verification_expires_at: null,
      last_verification_at: null,
    });
  });

  it("preencher os campos de verificação não ativa o domínio sozinho — nenhum trigger/default desta migration muda status", async () => {
    const domain = `verif-campos-nao-ativam-${fx.tenantA}.example.com`;
    const result = await asActor(
      { role: "service_role" },
      (c) =>
        c.query(
          `insert into public.tenant_domains
             (tenant_id, domain, domain_type, status, verification_method, verification_token_hash, verification_started_at, verification_expires_at)
           values
             ($1, $2, 'custom', 'pending', 'dns_txt', repeat('a', 64), now(), now() + interval '72 hours')
           returning status`,
          [fx.tenantA, domain],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ status: "pending" });
  });

  it("nenhum domínio pré-existente foi ativado por esta migration", async () => {
    const { rows } = await withSuperuser((c) => c.query("select count(*)::int as n from public.tenant_domains where status = 'active'"));
    expect(rows[0]!.n).toBe(0);
  });

  it("RLS preservada: anon continua só enxergando domínios status='active', mesmo com as 5 colunas novas presentes", async () => {
    const activeDomain = `verif-rls-active-${fx.tenantA}.example.com`;
    const pendingDomain = `verif-rls-pending-${fx.tenantA}.example.com`;

    await withSuperuser((c) =>
      c.query(
        `insert into public.tenant_domains (tenant_id, domain, domain_type, status, verification_method, verification_token_hash)
         values
           ($1, $2, 'custom', 'active', 'dns_txt', repeat('b', 64)),
           ($1, $3, 'custom', 'pending', 'dns_txt', repeat('c', 64))`,
        [fx.tenantA, activeDomain, pendingDomain],
      ),
    );

    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select domain from public.tenant_domains where domain in ($1, $2)", [activeDomain, pendingDomain]),
    );
    expect(result.rows.map((r: { domain: string }) => r.domain)).toEqual([activeDomain]);

    await withSuperuser((c) => c.query("delete from public.tenant_domains where domain in ($1, $2)", [activeDomain, pendingDomain]));
  });

  it("authenticated continua sem conseguir inserir/atualizar tenant_domains diretamente (RLS de D17.1 intacta)", async () => {
    const domain = `verif-authenticated-blocked-${fx.tenantA}.example.com`;
    await expectPgError(
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status, verification_method) values ($1, $2, 'custom', 'pending', 'dns_txt')",
            [fx.tenantA, domain],
          ),
        { commit: false },
      ),
    );
  });
});
