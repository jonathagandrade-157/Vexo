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
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `update public.tenants
           set pix_enabled = true, pix_key = $1, pix_key_type = $2, pix_recipient_name = $3
           where id = $4
           returning pix_enabled, pix_key, pix_key_type, pix_recipient_name`,
          ["11999999999", "phone", "Loja Exemplo", fx.tenantA],
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

  it("anon consegue ler pix_key/pix_recipient_name (necessário para exibir no checkout)", async () => {
    await withSuperuser((c) =>
      c.query(
        "update public.tenants set pix_enabled = true, pix_key = '11999999999', pix_key_type = 'phone', pix_recipient_name = 'Loja Exemplo' where id = $1",
        [fx.tenantA],
      ),
    );
    const result = await asActor({ role: "anon" }, (c) =>
      c.query("select pix_key, pix_recipient_name from public.tenants where id = $1", [fx.tenantA]),
    );
    expect(result.rows[0]).toMatchObject({ pix_key: "11999999999", pix_recipient_name: "Loja Exemplo" });
    await withSuperuser((c) => c.query("update public.tenants set pix_enabled = false, pix_key = null, pix_key_type = null, pix_recipient_name = null where id = $1", [fx.tenantA]));
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
