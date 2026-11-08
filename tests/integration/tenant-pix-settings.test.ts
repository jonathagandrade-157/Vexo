/**
 * Fase D2-B (revisão final) — configuração de PIX direto em `tenants`
 * (migration 20260817220083). Mesmo padrão de
 * `tests/integration/tenant-checkout-mode.test.ts`: RLS testada
 * diretamente via SQL (asActor/withSuperuser), nunca através dos Server
 * Actions do Next.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("PIX direto em tenants (Fase D2-B)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uma loja existente tem o default seguro: pix_enabled=false, demais campos NULL", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query("select pix_enabled, pix_key, pix_key_type, pix_recipient_name from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(rows[0]).toMatchObject({ pix_enabled: false, pix_key: null, pix_key_type: null, pix_recipient_name: null });
  });

  it("OWNER com settings.update consegue configurar e habilitar o PIX direto", async () => {
    // Fase D2-B.2 — pix_enabled=true agora também exige address_city
    // preenchida (tenants_pix_enabled_requires_key_check estendida na
    // migration 084, ver tests/integration/tenant-store-address.test.ts).
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `update public.tenants
           set pix_enabled = true, pix_key = $1, pix_key_type = $2, pix_recipient_name = $3, address_city = $4
           where id = $5
           returning pix_enabled, pix_key, pix_key_type, pix_recipient_name`,
          ["11999999999", "phone", "Loja Exemplo", "São Paulo", fx.tenantA],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({
      pix_enabled: true,
      pix_key: "11999999999",
      pix_key_type: "phone",
      pix_recipient_name: "Loja Exemplo",
    });
  });

  it("MANAGER sem settings.update é bloqueado (RLS não afeta nenhuma linha)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("update public.tenants set pix_enabled = true, pix_key = 'x', pix_key_type = 'random', pix_recipient_name = 'x' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um membro do tenant A não consegue alterar a configuração de PIX do tenant B", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.tenants set pix_enabled = true, pix_key = 'x', pix_key_type = 'random', pix_recipient_name = 'x' where id = $1", [fx.tenantB]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("anon continua lendo exatamente as colunas da vitrine (resolveStorefrontTenant e roteamento por host)", async () => {
    const storefrontColumns =
      "id, name, slug, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at, logo_url, primary_color, secondary_color, storefront_template, checkout_mode";
    const result = await asActor({ role: "anon" }, (c) => c.query(`select ${storefrontColumns} from public.tenants where id = $1`, [fx.tenantA]));
    expect(result.rows).toHaveLength(1);
    const byHost = await asActor({ role: "anon" }, (c) => c.query("select slug, status from public.tenants where id = $1", [fx.tenantA]));
    expect(byHost.rows).toHaveLength(1);
  });

  it("anon NÃO lê pix_key/pix_recipient_name pela API; o servidor (service_role) lê para o checkout", async () => {
    await withSuperuser((c) =>
      c.query(
        "update public.tenants set pix_enabled = true, pix_key = '11999999999', pix_key_type = 'phone', pix_recipient_name = 'Loja Exemplo', address_city = 'São Paulo' where id = $1",
        [fx.tenantA],
      ),
    );
    for (const column of ["pix_key", "pix_key_type", "pix_recipient_name", "pix_enabled", "created_by"]) {
      const error = await expectPgError(asActor({ role: "anon" }, (c) => c.query(`select ${column} from public.tenants where slug is not null`)));
      expect(error.message, column).toMatch(/permission denied/i);
    }
    const server = await asActor({ role: "service_role" }, (c) =>
      c.query("select pix_key, pix_recipient_name from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(server.rows[0]).toMatchObject({ pix_key: "11999999999", pix_recipient_name: "Loja Exemplo" });
    await withSuperuser((c) =>
      c.query(
        "update public.tenants set pix_enabled = false, pix_key = null, pix_key_type = null, pix_recipient_name = null, address_city = null where id = $1",
        [fx.tenantA],
      ),
    );
  });


  it("CHECK rejeita pix_key_type fora de cpf_cnpj/email/phone/random", async () => {
    const err = await expectPgError(
      withSuperuser((c) => c.query("update public.tenants set pix_key_type = 'boleto' where id = $1", [fx.tenantA])),
    );
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  it("CHECK rejeita pix_enabled=true sem os 3 campos preenchidos", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("update public.tenants set pix_enabled = true, pix_key = null, pix_key_type = null, pix_recipient_name = null where id = $1", [
          fx.tenantA,
        ]),
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });
});
