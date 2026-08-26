/**
 * Sprint 1 — Fase A (Aparência da loja). Mesmo padrão exato de
 * `tests/integration/product-images.test.ts` (Etapa 8) — RLS testada
 * diretamente via SQL (asActor/withSuperuser), nunca através dos Server
 * Actions do Next.js. `storage.objects`/`storage.buckets`/
 * `storage.foldername()` vêm do stub de teste (supabase-stub.sql), a
 * mesma réplica simplificada já usada para validar as policies de
 * product-media.
 *
 * Escopo: as duas migrations novas desta Sprint (20260817220075 —
 * colunas de aparência em tenants; 20260817220076 — bucket tenant-media)
 * e nada além disso — não re-testa nada do resto de tenants/products já
 * coberto por outros arquivos.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Aparência da loja — tenants + tenant-media (Sprint 1 Fase A)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  function logoObjectName(tenantId: string, file = "logo.png") {
    return `${tenantId}/logo/${file}`;
  }

  it("uma loja existente, sem nenhuma personalização, tem os defaults seguros (storefront_template='commerce', logo/cores NULL)", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query(
        "select logo_url, primary_color, secondary_color, storefront_template from public.tenants where id = $1",
        [fx.tenantA],
      ),
    );
    expect(rows[0]).toMatchObject({
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      storefront_template: "commerce",
    });
  });

  it("OWNER com settings.update consegue salvar logo_url/primary_color/secondary_color/storefront_template", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `update public.tenants
           set logo_url = $1, primary_color = $2, secondary_color = $3, storefront_template = $4
           where id = $5
           returning logo_url, primary_color, secondary_color, storefront_template`,
          [logoObjectName(fx.tenantA), "#7C3AED", "#3B82F6", "premium", fx.tenantA],
        ),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({
      logo_url: logoObjectName(fx.tenantA),
      primary_color: "#7C3AED",
      secondary_color: "#3B82F6",
      storefront_template: "premium",
    });
  });

  it("ADMIN com settings.update também consegue salvar aparência", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) =>
        c.query("update public.tenants set storefront_template = 'minimal' where id = $1 returning storefront_template", [
          fx.tenantA,
        ]),
      { commit: false },
    );
    expect(result.rows[0]).toMatchObject({ storefront_template: "minimal" });
  });

  it("MANAGER sem settings.update é bloqueado (RLS não afeta nenhuma linha)", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAManager },
      (c) => c.query("update public.tenants set storefront_template = 'fashion' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("um usuário sem membership no tenant (outsider) é bloqueado", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userOutsider },
      (c) => c.query("update public.tenants set storefront_template = 'fashion' where id = $1", [fx.tenantA]),
      { commit: false },
    );
    expect(result.rowCount).toBe(0);
  });

  it("CHECK constraint rejeita cor fora do formato #RRGGBB — nunca aceita CSS arbitrário", async () => {
    for (const invalid of ["red", "url(javascript:alert(1))", "#12345", "#GGGGGG"]) {
      const err = await expectPgError(
        withSuperuser((c) => c.query("update public.tenants set primary_color = $1 where id = $2", [invalid, fx.tenantA])),
      );
      expect((err as unknown as { code?: string }).code).toBe("23514"); // check_violation
    }
  });

  it("CHECK constraint rejeita storefront_template fora dos 5 modelos definidos", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("update public.tenants set storefront_template = $1 where id = $2", ["lookbook", fx.tenantA]),
      ),
    );
    expect((err as unknown as { code?: string }).code).toBe("23514");
  });

  it("o bucket tenant-media é público com o limite de 5MB e allow-list de 3 mimes documentados", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'tenant-media'",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(true);
    expect(Number(rows[0]!.file_size_limit)).toBe(5 * 1024 * 1024);
    expect(rows[0]!.allowed_mime_types.sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("OWNER com settings.update consegue inserir a logo do próprio tenant em tenant-media", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("insert into storage.objects (bucket_id, name) values ($1, $2) returning id", [
        "tenant-media",
        logoObjectName(fx.tenantA),
      ]),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("anon não consegue inserir em tenant-media", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", ["tenant-media", logoObjectName(fx.tenantA)]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("MANAGER sem settings.update não consegue inserir em tenant-media do próprio tenant", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", ["tenant-media", logoObjectName(fx.tenantA)]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("um membro do tenant A (com settings.update em A) não consegue inserir sob o prefixo do tenant B", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "tenant-media",
          logoObjectName(fx.tenantB),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("tenant A não consegue atualizar/remover o objeto de logo do tenant B", async () => {
    const bObjectName = logoObjectName(fx.tenantB, "existing.png");
    await withSuperuser((c) =>
      c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", ["tenant-media", bObjectName]),
    );

    const updateResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update storage.objects set name = name where bucket_id = 'tenant-media' and name = $1", [bObjectName]),
    );
    expect(updateResult.rowCount).toBe(0);

    const deleteResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("delete from storage.objects where bucket_id = 'tenant-media' and name = $1", [bObjectName]),
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  it("leitura de tenant-media é pública por design (bucket público) — anon e qualquer autenticado leem", async () => {
    const objName = logoObjectName(fx.tenantA, "public-read-check.png");
    await withSuperuser((c) =>
      c.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [
        "tenant-media",
        objName,
      ]),
    );

    const asAnon = await asActor({ role: "anon" }, (c) =>
      c.query("select 1 from storage.objects where bucket_id = 'tenant-media' and name = $1", [objName]),
    );
    expect(asAnon.rows).toHaveLength(1);

    const asOutsider = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select 1 from storage.objects where bucket_id = 'tenant-media' and name = $1", [objName]),
    );
    expect(asOutsider.rows).toHaveLength(1);
  });
});
