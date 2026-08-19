/**
 * Etapa 4 — onboarding e configuração inicial da loja (arquitetura §24
 * Etapa 4; docs/architecture/etapa-4-onboarding.md).
 *
 * Mesmo harness da Etapa 2/3 (Postgres real + stub, ver
 * tests/integration/fixtures/supabase-stub.sql) e as mesmas fixtures de
 * rls-isolation.test.ts (buildFixtures) — onboarding não introduz tabela
 * nova, é um UPDATE em `tenants` protegido pela mesma RLS de sempre
 * (0012), então reaproveitar o fixture set de tenant A/tenant B/outsider/
 * master é o cenário certo, não um conjunto próprio.
 *
 * Os 15 cenários pedidos no prompt da Etapa 4 estão cobertos aqui,
 * mapeados para o que de fato existe nesta etapa (onboarding é uma única
 * tela de dados — sem tela de slug, então "slug aceito/rejeitado" vira
 * "as proteções de slug da Etapa 2 continuam intactas").
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

// Mesmo motivo do runId em helpers/fixtures.ts: tenants criados aqui com
// { commit: true } persistem de verdade entre execuções deste arquivo
// contra o mesmo banco compartilhado — sufixo aleatório evita colisão de
// tenants.slug (unique) numa segunda execução da suíte.
const runId = randomUUID().slice(0, 8);

const BRAND_INFO = {
  segment: "apparel",
  description: "Roupas autorais feitas à mão.",
  instagram: "suamarca",
  whatsapp: "11999998888",
  email: "contato@suamarca.com.br",
};

async function saveBrandInfo(
  fx: Fixtures,
  tenantId: string,
  userId: string,
  overrides: Partial<typeof BRAND_INFO & { storeName: string }> = {},
  options: { commit?: boolean } = {},
) {
  const values = { storeName: "Minha Marca", ...BRAND_INFO, ...overrides };
  return asActor(
    { role: "authenticated", userId },
    (c) =>
      c.query(
        `update public.tenants
           set name = $1, segment = $2, description = $3,
               instagram_handle = $4, whatsapp_phone = $5, contact_email = $6,
               onboarding_completed_at = now()
         where id = $7
         returning id, name, slug, onboarding_completed_at`,
        [
          values.storeName,
          values.segment,
          values.description,
          values.instagram,
          values.whatsapp,
          values.email,
          tenantId,
        ],
      ),
    options,
  );
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Onboarding (Etapa 4)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1. usuário autenticado inicia o onboarding (enxerga seu próprio tenant pendente)
  it("an authenticated OWNER can see their own tenant is pending onboarding", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id, onboarding_completed_at from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.onboarding_completed_at).toBeNull();
  });

  // 2. usuário não autenticado é bloqueado PARA ESCRITA — leitura de
  // tenants não suspensos/excluídos passou a ser pública de propósito na
  // Etapa 6 (storefront), via a policy "anyone can view public
  // storefront-visible tenants" (migration 20260817220022); ver
  // tests/integration/storefront.test.ts para a cobertura dessa regra.
  // fx.tenantA está "pending" (default), então esta leitura hoje
  // encontra a linha — isso é o comportamento correto, não um vazamento.
  it("an unauthenticated (anon) request can read (public storefront data) but never write tenants", async () => {
    const read = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(read.rows).toHaveLength(1);

    // UPDATE já é diferente: anon nunca recebeu o GRANT de UPDATE na
    // tabela (só SELECT) — isso é negado no nível de privilégio do
    // Postgres, antes mesmo de qualquer policy de RLS ser avaliada.
    const writeErr = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("update public.tenants set name = 'hacked' where id = $1", [fx.tenantA]),
      ),
    );
    expect(writeErr.message).toMatch(/permission denied/i);
  });

  // 3. dados válidos são salvos
  it("valid brand info is saved by the tenant's OWNER", async () => {
    const before = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select slug from public.tenants where id = $1", [fx.tenantA]),
    );

    const res = await saveBrandInfo(fx, fx.tenantA, fx.userAOwner, { storeName: "Loja da Ana" });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.name).toBe("Loja da Ana");
    expect(res.rows[0]?.onboarding_completed_at).not.toBeNull();

    // 5. slug não é tocado por esta etapa (sem campo de slug na tela) —
    // continua igual ao que create_tenant havia definido, nunca alterado
    // silenciosamente.
    expect(res.rows[0]?.slug).toBe(before.rows[0]?.slug);
  });

  // 4. dados inválidos são rejeitados (defesa em profundidade — CHECK no banco,
  // além da validação Zod que a Server Action já faz antes de chegar aqui)
  it("invalid segment is rejected by the tenants_segment check constraint", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("update public.tenants set segment = $1 where id = $2", ["not-a-real-segment", fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/check constraint|tenants_segment_check/i);
  });

  it("an overly long description is rejected by its check constraint", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("update public.tenants set description = $1 where id = $2", ["x".repeat(501), fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/check constraint/i);
  });

  // 6/7. proteções de slug da Etapa 2 continuam intactas (não enfraquecidas
  // por esta etapa, que nem expõe um campo de slug)
  it("Etapa 2 slug protections (format + uniqueness) remain intact", async () => {
    const badFormat = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select * from public.create_tenant($1, $2)", ["Loja X", "Slug Inválido!!"]),
      ),
    );
    expect(badFormat.message).toMatch(/tenants_slug_format|check constraint/i);

    const created = await asActor(
      { role: "authenticated", userId: fx.userOutsider },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Única", `loja-unica-onboarding-test-${runId}`]),
      { commit: true },
    );
    expect(created.rows).toHaveLength(1);

    const duplicate = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
        c.query("select * from public.create_tenant($1, $2)", ["Outra Loja", `loja-unica-onboarding-test-${runId}`]),
      ),
    );
    expect(duplicate.message).toMatch(/duplicate key|unique/i);
  });

  // 8/14. usuário não pode alterar o tenant de outra pessoa / sem membership nenhuma
  it("a user cannot configure a tenant they are not a member of (IDOR / tenant hopping)", async () => {
    // userBOwner é dono do tenant B, tenta configurar o tenant A enviando o id de A.
    const res = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query(
        "update public.tenants set name = 'Sequestrada' where id = $1 returning id",
        [fx.tenantA],
      ),
    );
    // RLS filtra a linha (0 rows), não lança erro — é assim que UPDATE com
    // WHERE fora do escopo da policy se comporta; a asserção certa é "nada
    // foi afetado", não "erro".
    expect(res.rows).toHaveLength(0);

    const check = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select name from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(check.rows[0]?.name).not.toBe("Sequestrada");
  });

  it("a user with no membership anywhere cannot configure any tenant", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("update public.tenants set name = 'Invasor' where id = $1 returning id", [fx.tenantA]),
    );
    expect(res.rows).toHaveLength(0);
  });

  it("a MANAGER (no settings.update permission) cannot configure the tenant", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
      c.query("update public.tenants set name = 'Gerente Tentou' where id = $1 returning id", [
        fx.tenantA,
      ]),
    );
    expect(res.rows).toHaveLength(0);
  });

  it("an ADMIN (has settings.update) can also configure the tenant, same as OWNER", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userAAdmin }, (c) =>
      c.query(
        "update public.tenants set description = 'Editado pelo admin' where id = $1 returning id",
        [fx.tenantA],
      ),
    );
    expect(res.rows).toHaveLength(1);
  });

  // 10. usuário consegue concluir o onboarding, e a conclusão é auditada
  // (mesmo sistema de audit_logs da Etapa 2 — trigger estendido em 0019)
  it("completing onboarding writes a TENANT_ONBOARDING_COMPLETED audit entry", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Auditada", `loja-auditada-onboarding-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;

    await saveBrandInfo(fx, tenantId, fx.userBOwner, {}, { commit: true });

    const auditRows = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query(
        "select action from public.audit_logs where tenant_id = $1 and action = 'TENANT_ONBOARDING_COMPLETED'",
        [tenantId],
      ),
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  // 11. a conclusão persiste entre sessões/logins (uma nova transação/conexão
  // separada ainda enxerga o estado gravado)
  it("onboarding completion persists across a brand-new session", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Persistente", `loja-persistente-onboarding-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;
    await saveBrandInfo(fx, tenantId, fx.userAOwner, {}, { commit: true });

    // Nova conexão/transação — simula um novo login em outro momento.
    const laterSession = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select onboarding_completed_at from public.tenants where id = $1", [tenantId]),
    );
    expect(laterSession.rows[0]?.onboarding_completed_at).not.toBeNull();
  });

  // 12. quem abandona o onboarding pode retomar sem perder dados (nada é
  // perdido porque nada além do que já foi de fato salvo existe no servidor)
  it("a user who abandons onboarding can resume later without data loss", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Retomada", `loja-retomada-onboarding-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;

    // "Abandona": nunca envia o formulário. Reabrir a tela mais tarde
    // continua enxergando o tenant como pendente, com os dados que já
    // existiam (só o nome, definido no cadastro).
    const resumed = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select name, onboarding_completed_at from public.tenants where id = $1", [tenantId]),
    );
    expect(resumed.rows[0]?.name).toBe("Loja Retomada");
    expect(resumed.rows[0]?.onboarding_completed_at).toBeNull();

    // Agora conclui de fato.
    const completed = await saveBrandInfo(fx, tenantId, fx.userBOwner, {}, { commit: true });
    expect(completed.rows[0]?.onboarding_completed_at).not.toBeNull();
  });

  // 13. double-submit não cria duplicata (UPDATE é idempotente; o trigger de
  // auditoria só loga a conclusão uma vez, na transição null -> not null)
  it("double-submitting the same completion does not duplicate rows or audit entries", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Dupla Sub", `loja-dupla-sub-onboarding-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;

    await saveBrandInfo(fx, tenantId, fx.userAOwner, {}, { commit: true });
    await saveBrandInfo(fx, tenantId, fx.userAOwner, {}, { commit: true }); // reenvio

    const rows = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.tenants where id = $1", [tenantId]),
    );
    expect(rows.rows).toHaveLength(1); // nenhuma linha duplicada

    const auditRows = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query(
        "select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_ONBOARDING_COMPLETED'",
        [tenantId],
      ),
    );
    expect(auditRows.rows).toHaveLength(1); // não duplica o log
  });

  // 15. RLS continua isolando tenants (inclusive as colunas novas desta etapa)
  it("RLS keeps isolating tenants — brand info of one tenant is invisible to another", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
      c.query("select id, segment, contact_email from public.tenants where id = $1", [fx.tenantB]),
    );
    expect(res.rows).toHaveLength(0);
  });
});
