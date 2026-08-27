/**
 * Fase D2-B.2 — endereço/origem da loja em `tenants` (migration
 * 20260817220084). Mesmo padrão de `tests/integration/tenant-pix-
 * settings.test.ts`: RLS testada diretamente via SQL (asActor/
 * withSuperuser), nunca através dos Server Actions do Next.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Endereço da loja em tenants (Fase D2-B.2)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uma loja existente tem o default seguro: todas as colunas de endereço NULL", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query(
        "select address_zip, address_street, address_number, address_complement, address_neighborhood, address_city, address_state from public.tenants where id = $1",
        [fx.tenantA],
      ),
    );
    expect(rows[0]).toMatchObject({
      address_zip: null,
      address_street: null,
      address_number: null,
      address_complement: null,
      address_neighborhood: null,
      address_city: null,
      address_state: null,
    });
  });

  it("OWNER com settings.update consegue salvar um endereço completo", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `update public.tenants
           set address_zip = $1, address_street = $2, address_number = $3, address_complement = $4,
               address_neighborhood = $5, address_city = $6, address_state = $7
           where id = $8
           returning address_zip, address_city, address_state`,
          ["01001000", "Praça da Sé", "100", "Sala 4", "Sé", "São Paulo", "SP", fx.tenantA],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ address_zip: "01001000", address_city: "São Paulo", address_state: "SP" });
  });

  it("permite endereço incompleto (só CEP e cidade, sem quebrar nenhuma constraint)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.tenants set address_zip = $1, address_city = $2 where id = $3 returning address_zip, address_city", ["01001000", "São Paulo", fx.tenantA]),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ address_zip: "01001000", address_city: "São Paulo" });
  });

  it("MANAGER sem settings.update é bloqueado (RLS não afeta nenhuma linha)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("update public.tenants set address_city = 'São Paulo' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um membro do tenant A não consegue alterar o endereço do tenant B (isolamento)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.tenants set address_city = 'São Paulo' where id = $1", [fx.tenantB]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("anon consegue ler o endereço (necessário para o futuro gerador de BR Code no checkout)", async () => {
    await withSuperuser((c) => c.query("update public.tenants set address_city = 'São Paulo', address_state = 'SP' where id = $1", [fx.tenantA]));
    const result = await asActor({ role: "anon" }, (c) => c.query("select address_city, address_state from public.tenants where id = $1", [fx.tenantA]));
    expect(result.rows[0]).toMatchObject({ address_city: "São Paulo", address_state: "SP" });
    await withSuperuser((c) => c.query("update public.tenants set address_city = null, address_state = null where id = $1", [fx.tenantA]));
  });

  it("CHECK rejeita address_zip fora do formato de 8 dígitos", async () => {
    const err = await expectPgError(withSuperuser((c) => c.query("update public.tenants set address_zip = '123' where id = $1", [fx.tenantA])));
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  it("CHECK rejeita address_state fora da lista de UFs reais", async () => {
    const err = await expectPgError(withSuperuser((c) => c.query("update public.tenants set address_state = 'XX' where id = $1", [fx.tenantA])));
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  it("CHECK rejeita address_city acima do tamanho máximo", async () => {
    const err = await expectPgError(withSuperuser((c) => c.query("update public.tenants set address_city = $1 where id = $2", ["a".repeat(101), fx.tenantA])));
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  describe("cruzamento com PIX (tenants_pix_enabled_requires_key_check estendida)", () => {
    it("CHECK rejeita pix_enabled=true sem address_city, mesmo com pix_key/pix_key_type/pix_recipient_name preenchidos", async () => {
      const err = await expectPgError(
        withSuperuser((c) =>
          c.query(
            `update public.tenants
             set pix_enabled = true, pix_key = '11999999999', pix_key_type = 'phone', pix_recipient_name = 'Loja Exemplo',
                 address_city = null
             where id = $1`,
            [fx.tenantA],
          ),
        ),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514");
    });

    it("permite pix_enabled=true quando address_city também está preenchida", async () => {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            `update public.tenants
             set pix_enabled = true, pix_key = '11999999999', pix_key_type = 'phone', pix_recipient_name = 'Loja Exemplo',
                 address_city = 'São Paulo'
             where id = $1
             returning pix_enabled, address_city`,
            [fx.tenantA],
          ),
        { commit: false },
      );
      expect(result.rows[0]).toMatchObject({ pix_enabled: true, address_city: "São Paulo" });
    });

    it("CHECK rejeita apagar address_city enquanto pix_enabled continua true", async () => {
      await withSuperuser((c) =>
        c.query(
          `update public.tenants
           set pix_enabled = true, pix_key = '11999999999', pix_key_type = 'phone', pix_recipient_name = 'Loja Exemplo',
               address_city = 'São Paulo'
           where id = $1`,
          [fx.tenantA],
        ),
      );
      const err = await expectPgError(withSuperuser((c) => c.query("update public.tenants set address_city = null where id = $1", [fx.tenantA])));
      expect((err as unknown as { code?: string }).code).toBe("23514");
      await withSuperuser((c) =>
        c.query("update public.tenants set pix_enabled = false, pix_key = null, pix_key_type = null, pix_recipient_name = null, address_city = null where id = $1", [
          fx.tenantA,
        ]),
      );
    });
  });

  describe("regressão — shipping_settings.origin_zip continua intocado", () => {
    it("origin_zip continua existindo e aceitando o mesmo formato de sempre, independente de address_zip", async () => {
      const result = await withSuperuser((c) =>
        c.query(
          `insert into public.shipping_settings (tenant_id, enabled, origin_zip) values ($1, true, '01001000')
           on conflict (tenant_id) do update set origin_zip = excluded.origin_zip
           returning origin_zip`,
          [fx.tenantA],
        ),
      );
      expect(result.rows[0]).toMatchObject({ origin_zip: "01001000" });
      await withSuperuser((c) => c.query("delete from public.shipping_settings where tenant_id = $1", [fx.tenantA]));
    });
  });
});
