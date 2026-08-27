/**
 * Fase D1 — fundação do modelo de recebimento de pedidos. Mesmo padrão
 * exato de `tests/integration/tenant-appearance.test.ts` (Sprint 1 Fase
 * A): RLS testada diretamente via SQL (asActor/withSuperuser), nunca
 * através dos Server Actions do Next.js.
 *
 * Escopo: só a migration desta fase (20260817220078 — coluna
 * checkout_mode em tenants) — não re-testa nada do resto de tenants já
 * coberto por outros arquivos (rls-isolation.test.ts, tenant-appearance.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("checkout_mode em tenants (Fase D1)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uma loja existente (criada antes desta fase) tem o default seguro 'vexo' — nenhuma loja quebra", async () => {
    const { rows } = await withSuperuser((c) => c.query("select checkout_mode from public.tenants where id = $1", [fx.tenantA]));
    expect(rows[0]).toMatchObject({ checkout_mode: "vexo" });
  });

  it("OWNER com settings.update consegue salvar cada um dos 3 modos válidos", async () => {
    for (const mode of ["whatsapp", "both", "vexo"]) {
      const result = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set checkout_mode = $1 where id = $2 returning checkout_mode", [mode, fx.tenantA]),
        { commit: false },
      );
      expect(result.rows[0]).toMatchObject({ checkout_mode: mode });
    }
  });

  it("ADMIN com settings.update também consegue salvar o modo", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("update public.tenants set checkout_mode = 'whatsapp' where id = $1 returning checkout_mode", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ checkout_mode: "whatsapp" });
  });

  it("MANAGER sem settings.update é bloqueado (RLS não afeta nenhuma linha)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("update public.tenants set checkout_mode = 'whatsapp' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um usuário sem membership no tenant (outsider) é bloqueado", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userOutsider },
      (c) => c.query("update public.tenants set checkout_mode = 'whatsapp' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um membro do tenant A não consegue alterar checkout_mode do tenant B (isolamento entre tenants)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.tenants set checkout_mode = 'whatsapp' where id = $1", [fx.tenantB]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("CHECK constraint rejeita qualquer valor fora de vexo/whatsapp/both", async () => {
    for (const invalid of ["pix", "manual", "VEXO", "", "whatsapp; drop table tenants;--"]) {
      const err = await expectPgError(
        withSuperuser((c) => c.query("update public.tenants set checkout_mode = $1 where id = $2", [invalid, fx.tenantA])),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514"); // check_violation
    }
  });

  it("checkout_mode nunca aceita NULL (NOT NULL) — sempre um valor concreto", async () => {
    const err = await expectPgError(
      withSuperuser((c) => c.query("update public.tenants set checkout_mode = null where id = $1", [fx.tenantA])),
    );
    expect((err as unknown as { code?: string }).code).toBe("23502"); // not_null_violation
  });
});
