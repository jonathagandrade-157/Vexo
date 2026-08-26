/**
 * Etapa 6 — storefront público (arquitetura §4/§9/§19 do prompt desta
 * etapa; docs/architecture/etapa-6-storefront.md).
 *
 * Mesmo harness e fixtures de sempre (buildFixtures). A única mudança de
 * schema desta etapa é uma nova policy de SELECT em `tenants` para
 * `anon`/`authenticated` — os testes aqui simulam exatamente essa
 * consulta (papel `anon`, mesma projeção de colunas que
 * `resolveStorefrontTenant` usa), não uma segunda implementação da regra.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

const PUBLIC_COLUMNS =
  "name, slug, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at, logo_url, primary_color, secondary_color, storefront_template";

async function findBySlug(slug: string) {
  return asActor({ role: "anon" }, (c) =>
    c.query(`select ${PUBLIC_COLUMNS} from public.tenants where slug = $1`, [slug]),
  );
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Storefront público (Etapa 6)", () => {
  let fx: Fixtures;
  /** tenant A com onboarding concluído e todos os campos de contato preenchidos, para os testes de conteúdo. */
  let readyTenantSlug: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ slug: string }>(
        `update public.tenants
           set onboarding_completed_at = now(), segment = 'apparel',
               description = 'Moda autoral feita à mão.',
               instagram_handle = 'lojaA', whatsapp_phone = '11999998888',
               contact_email = 'contato@lojaa.com.br'
         where id = $1
         returning slug`,
        [fx.tenantA],
      );
      readyTenantSlug = rows[0]!.slug;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1/2/8/10/11/12 — slug válido resolve a loja certa, com os dados reais certos.
  it("a valid slug resolves the correct configured tenant with real data", async () => {
    const res = await findBySlug(readyTenantSlug);
    expect(res.rows).toHaveLength(1);
    const tenant = res.rows[0]!;
    expect(tenant.name).toBe("Tenant A");
    expect(tenant.segment).toBe("apparel");
    expect(tenant.description).toBe("Moda autoral feita à mão.");
    expect(tenant.instagram_handle).toBe("lojaA");
    expect(tenant.whatsapp_phone).toBe("11999998888");
    expect(tenant.contact_email).toBe("contato@lojaa.com.br");
    expect(tenant.onboarding_completed_at).not.toBeNull();
  });

  // Sprint 1 — Fase B2 §15.1/§15.5/§15.6: a lacuna da auditoria B1 era
  // exatamente esta — a leitura pública nunca expunha logo/cores/template.
  // Uma loja sem nenhuma personalização (fixture padrão) precisa continuar
  // resolvendo com os defaults seguros, nunca quebrando.
  it("a tenant with no appearance customization exposes the safe defaults publicly (logo/colors null, template commerce)", async () => {
    const res = await findBySlug(readyTenantSlug);
    const tenant = res.rows[0]!;
    expect(tenant.logo_url).toBeNull();
    expect(tenant.primary_color).toBeNull();
    expect(tenant.secondary_color).toBeNull();
    expect(tenant.storefront_template).toBe("commerce");
  });

  // Sprint 1 — Fase B2 §15.1 — uma vez personalizada (mesmo UPDATE que
  // updateStoreAppearanceAction/uploadStoreLogoAction fazem), a leitura
  // pública passa a expor os valores reais.
  it("a customized tenant exposes its real logo/colors/template publicly", async () => {
    await withSuperuser((client) =>
      client.query(
        `update public.tenants
         set logo_url = $1, primary_color = $2, secondary_color = $3, storefront_template = $4
         where id = $5`,
        [`${fx.tenantA}/logo/logo.png`, "#111111", "#222222", "fashion", fx.tenantA],
      ),
    );

    const res = await findBySlug(readyTenantSlug);
    const tenant = res.rows[0]!;
    expect(tenant.logo_url).toBe(`${fx.tenantA}/logo/logo.png`);
    expect(tenant.primary_color).toBe("#111111");
    expect(tenant.secondary_color).toBe("#222222");
    expect(tenant.storefront_template).toBe("fashion");

    // Restaura para não afetar os demais testes deste arquivo, que assumem os defaults.
    await withSuperuser((client) =>
      client.query(
        `update public.tenants
         set logo_url = null, primary_color = null, secondary_color = null, storefront_template = 'commerce'
         where id = $1`,
        [fx.tenantA],
      ),
    );
  });

  // 3/9 — slug inexistente não retorna linha nenhuma (StorefrontNotFound trata isso).
  it("a nonexistent slug returns zero rows", async () => {
    const res = await findBySlug(`slug-que-nunca-existiu-${runId}`);
    expect(res.rows).toHaveLength(0);
  });

  // 7 — onboarding incompleto é identificável (StorefrontNotFound vs "ainda sendo configurada").
  it("a tenant with pending onboarding is publicly visible but flagged as not configured", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Pendente", `loja-pendente-${runId}`]),
      { commit: true },
    );
    const slug = created.rows[0]?.slug as string;

    const res = await findBySlug(slug);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.onboarding_completed_at).toBeNull();
  });

  // Suspensa/excluída tratadas como inexistente (a RLS já filtra a linha inteira).
  it("a suspended tenant is invisible to the public, same as a nonexistent slug", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Suspensa", `loja-suspensa-${runId}`]),
      { commit: true },
    );
    const slug = created.rows[0]?.slug as string;

    // Só um platform admin muda `status` (trigger da Etapa 2,
    // prevent_unauthorized_tenant_status_change — continua valendo,
    // withSuperuser sozinho não basta porque o trigger checa
    // is_platform_admin() via auth.uid(), não o papel de conexão).
    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.tenants set status = 'suspended' where slug = $1", [slug]),
      { commit: true },
    );

    const res = await findBySlug(slug);
    expect(res.rows).toHaveLength(0);
  });

  it("a deleted tenant is invisible to the public, same as a nonexistent slug", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Excluida", `loja-excluida-${runId}`]),
      { commit: true },
    );
    const slug = created.rows[0]?.slug as string;

    await asActor(
      { role: "authenticated", userId: fx.userMaster },
      (c) => c.query("update public.tenants set status = 'deleted' where slug = $1", [slug]),
      { commit: true },
    );

    const res = await findBySlug(slug);
    expect(res.rows).toHaveLength(0);
  });

  // 4 — a nova policy é só de leitura: escrita pública continua bloqueada
  // exatamente como antes desta etapa (a mesma garantia já testada em
  // onboarding.test.ts, reconfirmada aqui porque uma policy nova em
  // `tenants` é justamente o tipo de mudança que poderia, por engano,
  // afrouxar mais do que o pretendido).
  it("adding public SELECT does not grant public UPDATE", async () => {
    // Sem GRANT de UPDATE para anon (só SELECT) — mesmo comportamento
    // documentado desde a Etapa 4 (permission denied no nível de
    // privilégio, antes de qualquer RLS).
    await expect(
      asActor({ role: "anon" }, (c) =>
        c.query("update public.tenants set name = 'hacked' where slug = $1", [readyTenantSlug]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  // 5/6/18 — a projeção pública nunca inclui id/created_by/CPF-CNPJ (que
  // nem mora em tenants, mas o teste confirma que nada além dos 8 campos
  // esperados sai da query).
  it("the public projection never leaks id, created_by, or any column beyond the public allowlist", async () => {
    const res = await findBySlug(readyTenantSlug);
    const keys = Object.keys(res.rows[0]!).sort();
    expect(keys).toEqual(
      [
        "contact_email",
        "description",
        "instagram_handle",
        "logo_url",
        "name",
        "onboarding_completed_at",
        "primary_color",
        "secondary_color",
        "segment",
        "slug",
        "storefront_template",
        "whatsapp_phone",
      ].sort(),
    );
  });

  // 13 — mudança feita "pelo painel" (mesmo UPDATE que updateStoreProfileAction faz) aparece na leitura pública.
  it("a change made through the settings update path is visible in the public read", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Editavel", `loja-editavel-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;
    const slug = created.rows[0]?.slug as string;
    await withSuperuser((client) =>
      client.query("update public.tenants set onboarding_completed_at = now() where id = $1", [tenantId]),
    );

    await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) =>
        c.query("update public.tenants set name = $1, contact_email = $2 where id = $3", [
          "Nome Editado no Painel",
          "editado@painel.com.br",
          tenantId,
        ]),
      { commit: true },
    );

    const res = await findBySlug(slug);
    expect(res.rows[0]?.name).toBe("Nome Editado no Painel");
    expect(res.rows[0]?.contact_email).toBe("editado@painel.com.br");
  });

  // 16 — audit_logs continua inacessível ao público (proteção da Etapa 2, intocada por esta etapa).
  it("audit_logs remains inaccessible to anon", async () => {
    const res = await asActor({ role: "anon" }, (c) => c.query("select id from public.audit_logs limit 1"));
    expect(res.rows).toHaveLength(0);
  });

  // 17 — roles/permissions continuam sem policy para anon.
  it("roles and permissions remain inaccessible to anon", async () => {
    const roles = await asActor({ role: "anon" }, (c) => c.query("select id from public.roles limit 1"));
    expect(roles.rows).toHaveLength(0);

    const permissions = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.permissions limit 1"),
    );
    expect(permissions.rows).toHaveLength(0);
  });

  // 18 — CPF/CNPJ (profiles.cpf_hash) continua inacessível ao público.
  it("profiles (which holds cpf_hash) remains inaccessible to anon", async () => {
    const res = await asActor({ role: "anon" }, (c) => c.query("select id from public.profiles limit 1"));
    expect(res.rows).toHaveLength(0);
  });

  // tenant_members também continua fora do alcance do público.
  it("tenant_members remains inaccessible to anon", async () => {
    const res = await asActor({ role: "anon" }, (c) => c.query("select id from public.tenant_members limit 1"));
    expect(res.rows).toHaveLength(0);
  });
});
