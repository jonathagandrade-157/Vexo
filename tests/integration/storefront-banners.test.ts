/**
 * Sprint 1 — Fase C2. Mesmo padrão exato de `shipping.test.ts`: RLS
 * testada diretamente via SQL (`asActor`/`withSuperuser`), sem passar
 * pela Action (`"use server"`, fora do alcance direto de um teste, mesma
 * limitação de qualquer outra Action deste projeto — o limite de 5
 * banners, que É lógica de aplicação e não de RLS, é coberto à parte em
 * `tests/unit/banner-storage.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Banners do storefront (Sprint 1 — Fase C2)", () => {
  let fx: Fixtures;

  async function insertBanner(
    tenantId: string,
    opts: { title?: string; status?: string; sortOrder?: number; imagePath?: string } = {},
  ): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.storefront_banners (tenant_id, image_path, title, status, sort_order)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          tenantId,
          opts.imagePath ?? `${tenantId}/banners/${randomUUID()}.jpg`,
          opts.title ?? `Banner ${randomUUID().slice(0, 6)}`,
          opts.status ?? "active",
          opts.sortOrder ?? 0,
        ],
      );
      return rows[0]!.id;
    });
  }

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  // Criação — só settings.update (OWNER/ADMIN); MANAGER (sem a permissão) é negado.
  it("RLS: only settings.update can insert a banner; a tenant member without it is denied", async () => {
    const denied = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
        c.query("insert into public.storefront_banners (tenant_id, image_path) values ($1, $2)", [
          fx.tenantA,
          `${fx.tenantA}/banners/x.jpg`,
        ]),
      ),
    );
    expect(denied.message).toMatch(/row-level security|permission denied/i);

    let insertedId = "";
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.storefront_banners (tenant_id, image_path, title) values ($1, $2, $3) returning id",
          [fx.tenantA, `${fx.tenantA}/banners/owner.jpg`, `Criado-${runId}`],
        );
        insertedId = rows[0]!.id;
      },
      { commit: true },
    );
    expect(insertedId).not.toBe("");
  });

  // Edição/exclusão — mesma permissão, mesmo tenant.
  it("RLS: settings.update can update and delete its own tenant's banner", async () => {
    const bannerId = await insertBanner(fx.tenantA, { title: `Original-${runId}` });

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.storefront_banners set title = $1 where id = $2", [`Editado-${runId}`, bannerId]),
      { commit: true },
    );
    const afterUpdate = await withSuperuser((c) => c.query("select title from public.storefront_banners where id = $1", [bannerId]));
    expect(afterUpdate.rows[0]!.title).toBe(`Editado-${runId}`);

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("delete from public.storefront_banners where id = $1", [bannerId]),
      { commit: true },
    );
    const afterDelete = await withSuperuser((c) => c.query("select 1 from public.storefront_banners where id = $1", [bannerId]));
    expect(afterDelete.rows).toHaveLength(0);
  });

  // Isolamento entre tenants — tenant B nunca escreve nem lê banners do tenant A pela via de staff.
  it("RLS: isolates banners between tenants — tenant B cannot write or read tenant A's banners", async () => {
    const bannerId = await insertBanner(fx.tenantA, { title: `Isolado-${runId}` });

    // UPDATE (diferente de INSERT): a cláusula `using` de RLS filtra a
    // linha ANTES da operação — não é um erro, é 0 linhas afetadas
    // (mesma semântica de qualquer UPDATE cujo WHERE não bate com nada).
    const updateResult = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("update public.storefront_banners set title = 'hackeado' where id = $1", [bannerId]),
    );
    expect(updateResult.rowCount).toBe(0);
    const stillOriginal = await withSuperuser((c) => c.query("select title from public.storefront_banners where id = $1", [bannerId]));
    expect(stillOriginal.rows[0]!.title).toBe(`Isolado-${runId}`);

    const deniedInsert = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
        c.query("insert into public.storefront_banners (tenant_id, image_path) values ($1, $2)", [
          fx.tenantA,
          `${fx.tenantA}/banners/hack.jpg`,
        ]),
      ),
    );
    expect(deniedInsert.message).toMatch(/row-level security|permission denied/i);

    const readAsTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.storefront_banners where id = $1", [bannerId]),
    );
    expect(readAsTenantB.rows).toHaveLength(0);
  });

  // Leitura de staff — qualquer membro do tenant vê TODOS os status (inclusive inativos), diferente do anon.
  it("RLS: any tenant member (staff) can view banners of any status, including inactive", async () => {
    const activeId = await insertBanner(fx.tenantA, { status: "active", title: `Staff-ativo-${runId}` });
    const inactiveId = await insertBanner(fx.tenantA, { status: "inactive", title: `Staff-inativo-${runId}` });

    const staffView = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
      c.query("select id from public.storefront_banners where tenant_id = $1 and id = any($2)", [fx.tenantA, [activeId, inactiveId]]),
    );
    expect(staffView.rows.map((r: { id: string }) => r.id).sort()).toEqual([activeId, inactiveId].sort());
  });

  // Leitura pública — anon só vê banners ativos, nunca inativos.
  it("RLS: anon only sees active banners, never inactive ones", async () => {
    const activeId = await insertBanner(fx.tenantA, { status: "active", title: `Publico-ativo-${runId}` });
    const inactiveId = await insertBanner(fx.tenantA, { status: "inactive", title: `Publico-inativo-${runId}` });

    const anonView = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.storefront_banners where tenant_id = $1 and id = any($2)", [fx.tenantA, [activeId, inactiveId]]),
    );
    const visibleIds = anonView.rows.map((r: { id: string }) => r.id);
    expect(visibleIds).toContain(activeId);
    expect(visibleIds).not.toContain(inactiveId);
  });

  // Ordenação — sort_order crescente é respeitado na leitura pública (mesma query de getStorefrontBanners).
  it("public query returns active banners ordered by sort_order ascending", async () => {
    const third = await insertBanner(fx.tenantA, { status: "active", sortOrder: 2, title: `Ordem-C-${runId}` });
    const first = await insertBanner(fx.tenantA, { status: "active", sortOrder: 0, title: `Ordem-A-${runId}` });
    const second = await insertBanner(fx.tenantA, { status: "active", sortOrder: 1, title: `Ordem-B-${runId}` });

    const ordered = await asActor({ role: "anon" }, (c) =>
      c.query(
        "select id from public.storefront_banners where tenant_id = $1 and id = any($2) order by sort_order asc, created_at asc",
        [fx.tenantA, [third, first, second]],
      ),
    );
    expect(ordered.rows.map((r: { id: string }) => r.id)).toEqual([first, second, third]);
  });

  // 0/1/N — loja nova sem banner nenhum não quebra a query pública (retorna vazio, não erro).
  it("public query returns an empty list for a tenant with zero banners", async () => {
    const freshTenant = await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by, onboarding_completed_at) values ($1, $2, $3, now()) returning id",
        [`Loja sem banner ${runId}`, `sem-banner-${runId}`, fx.userAOwner],
      );
      return rows[0]!.id;
    });

    const anonView = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.storefront_banners where tenant_id = $1", [freshTenant]),
    );
    expect(anonView.rows).toHaveLength(0);
  });

  // status só aceita active/inactive.
  it("storefront_banners_status_check rejects an invalid status", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.storefront_banners (tenant_id, image_path, status) values ($1, $2, 'draft')", [
          fx.tenantA,
          `${fx.tenantA}/banners/invalid.jpg`,
        ]),
      ),
    );
    expect(err.message).toMatch(/check constraint|storefront_banners/i);
  });

  // tenant_id é imutável (mesmo trigger genérico já usado em categories/shipping_methods).
  it("tenant_id cannot be changed after insert", async () => {
    const bannerId = await insertBanner(fx.tenantA);
    const err = await expectPgError(
      withSuperuser((c) => c.query("update public.storefront_banners set tenant_id = $1 where id = $2", [fx.tenantB, bannerId])),
    );
    expect(err.message).toMatch(/tenant_id/i);
  });
});
