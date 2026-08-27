/**
 * Fase D2-B.1 — "WhatsApp para pedidos" edita a mesma coluna já existente,
 * `tenants.whatsapp_phone` (Etapa 4) — nenhuma coluna/tabela nova, então
 * nenhuma RLS/policy nova. Este arquivo confirma que o modelo de
 * permissão de sempre (`settings.update`, isolamento por tenant)
 * continua valendo para essa coluna mesmo depois de o campo ter saído de
 * "Minha Loja" para sua própria seção — RLS não muda por causa de qual
 * tela do painel faz o UPDATE.
 *
 * Os testes de "Minha Loja" (`painel.test.ts`/`onboarding.test.ts`) já
 * cobrem os demais campos (nome/segmento/descrição/Instagram/e-mail)
 * continuando a funcionar exatamente como antes — não duplicados aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("WhatsApp para pedidos — tenants.whatsapp_phone (Fase D2-B.1)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("OWNER com settings.update consegue salvar o número (já normalizado, como a Action sempre envia)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query("update public.tenants set whatsapp_phone = $1 where id = $2 returning whatsapp_phone", [
          "5511999999999",
          fx.tenantA,
        ]),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ whatsapp_phone: "5511999999999" });
  });

  it("ADMIN com settings.update também consegue salvar", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) =>
        c.query("update public.tenants set whatsapp_phone = $1 where id = $2 returning whatsapp_phone", [
          "5511988887777",
          fx.tenantA,
        ]),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ whatsapp_phone: "5511988887777" });
  });

  it("MANAGER sem settings.update é bloqueado (RLS não afeta nenhuma linha)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("update public.tenants set whatsapp_phone = $1 where id = $2", ["5511977776666", fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um usuário sem membership no tenant (outsider) é bloqueado", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userOutsider },
      (c) => c.query("update public.tenants set whatsapp_phone = $1 where id = $2", ["5511977776666", fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um membro do tenant A não consegue alterar o WhatsApp do tenant B (isolamento entre tenants)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.tenants set whatsapp_phone = $1 where id = $2", ["5511977776666", fx.tenantB]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("o número salvo é lido de volta exatamente como gravado (banco recebe o valor já normalizado pela Action, nunca reformata)", async () => {
    await withSuperuser((c) => c.query("update public.tenants set whatsapp_phone = $1 where id = $2", ["5511999999999", fx.tenantA]));
    const { rows } = await withSuperuser((c) => c.query("select whatsapp_phone from public.tenants where id = $1", [fx.tenantA]));
    expect(rows[0]).toMatchObject({ whatsapp_phone: "5511999999999" });
  });
});
