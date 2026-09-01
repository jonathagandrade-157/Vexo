/**
 * D13.1 — galeria de imagens de produto: tabela `public.product_images`
 * (migration 20260817220096). Mesmo princípio de sempre neste projeto:
 * RLS testada diretamente via SQL (asActor), nunca invocando as Server
 * Actions do Next.js diretamente — `reorderProductGalleryAction`/
 * `setPrimaryProductGalleryImageAction` (features/products/actions.ts)
 * fazem exatamente os mesmos UPDATEs reproduzidos abaixo, com a validação
 * de "é uma permutação válida" já coberta por
 * tests/unit/product-gallery-logic.test.ts (pura, sem banco).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Galeria de imagens de produto (D13.1)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`gallery-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        fx.tenantA,
        userAOperator,
        fx.roleIds.OPERATOR,
      ]);

      const { rows: prodARows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantA, "Produto Galeria A", `produto-galeria-a-${runId}`, 10],
      );
      productA = prodARows[0]!.id;

      const { rows: prodBRows } = await client.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [fx.tenantB, "Produto Galeria B", `produto-galeria-b-${runId}`, 10],
      );
      productB = prodBRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  function galleryPath(tenantId: string, productId: string, imageId: string = randomUUID()) {
    return `${tenantId}/products/${productId}/gallery/${imageId}.jpg`;
  }

  // RLS de product_images / insert somente para produto do tenant
  it("OWNER with products.update can insert a gallery image for their own tenant's product", async () => {
    const result = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 0) returning id",
          [fx.tenantA, productA, galleryPath(fx.tenantA, productA)],
        ),
      { commit: true },
    );
    expect(result.rows).toHaveLength(1);
  });

  it("anon cannot insert into product_images", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          galleryPath(fx.tenantA, productA),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a member without products.update (OPERATOR) cannot insert a gallery image", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          galleryPath(fx.tenantA, productA),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  // tenant A não acessa/insere/atualiza/exclui imagens de tenant B (IDOR)
  it("a tenant A member cannot insert a gallery image under tenant B's product (cross-tenant)", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
          fx.tenantB,
          productB,
          galleryPath(fx.tenantB, productB),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("private.prevent_cross_tenant_product_image rejects tenant_id that doesn't match the product's real tenant, even as superuser (bypasses RLS but not the trigger)", async () => {
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
          fx.tenantA, // tenant_id de A
          productB, // mas product_id é de B
          galleryPath(fx.tenantA, productB),
        ]),
      ),
    );
    expect(err.message).toMatch(/must match the tenant of product_id/i);
  });

  it("a member of tenant B cannot read tenant A's gallery images", async () => {
    const path = galleryPath(fx.tenantA, productA);
    await withSuperuser((c) =>
      c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
        fx.tenantA,
        productA,
        path,
      ]),
    );

    const read = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.product_images where product_id = $1", [productA]),
    );
    expect(read.rows).toHaveLength(0);
  });

  it("a tenant A member cannot update or delete tenant B's gallery images", async () => {
    const path = galleryPath(fx.tenantB, productB, "existing");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3) returning id",
        [fx.tenantB, productB, path],
      ),
    );
    const imageId = inserted.rows[0]?.id as string;

    const updateResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update public.product_images set sort_order = 5 where id = $1", [imageId]),
    );
    expect(updateResult.rowCount).toBe(0); // RLS via USING — sem erro, só 0 linhas afetadas

    const deleteResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("delete from public.product_images where id = $1", [imageId]),
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  it("a member without products.delete (OPERATOR) cannot delete a gallery image", async () => {
    const path = galleryPath(fx.tenantA, productA, "op-delete-test");
    const inserted = await withSuperuser((c) =>
      c.query(
        "insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3) returning id",
        [fx.tenantA, productA, path],
      ),
    );
    const imageId = inserted.rows[0]?.id as string;

    const deleteResult = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("delete from public.product_images where id = $1", [imageId]),
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  // SELECT público — só produto ativo, de tenant publicamente visível (mesmo critério de `products`).
  it("SELECT on product_images is public only for images of an active product of a publicly visible tenant", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, $5) returning id", [
          fx.tenantA, "Produto Publico Galeria", `produto-publico-galeria-${runId}`, 10, "active",
        ]),
      { commit: true },
    );
    const publicProductId = created.rows[0]?.id as string;
    const path = galleryPath(fx.tenantA, publicProductId);
    await withSuperuser((c) =>
      c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
        fx.tenantA,
        publicProductId,
        path,
      ]),
    );

    const asAnon = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_images where product_id = $1", [publicProductId]),
    );
    expect(asAnon.rows).toHaveLength(1);

    // Produto inativo: mesma imagem deixa de ser visível a anon.
    await withSuperuser((c) => c.query("update public.products set status = 'inactive' where id = $1", [publicProductId]));
    const asAnonAfterInactive = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.product_images where product_id = $1", [publicProductId]),
    );
    expect(asAnonAfterInactive.rows).toHaveLength(0);
  });

  // "principal única" — sync_product_main_image mantém products.main_image = storage_path da linha de menor sort_order.
  describe("sync_product_main_image — products.main_image sempre reflete a imagem de menor sort_order", () => {
    it("inserir a primeira imagem da galeria preenche products.main_image", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
          fx.tenantA, "Produto Sync 1", `produto-sync-1-${runId}`, 10,
        ]),
        { commit: true },
      );
      const productId = created.rows[0]?.id as string;
      const path = galleryPath(fx.tenantA, productId);

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 0)", [
          fx.tenantA, productId, path,
        ]),
        { commit: true },
      );

      const row = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
      expect(row.rows[0]?.main_image).toBe(path);
    });

    it("reordenar (mudar quem tem sort_order 0) atualiza products.main_image para a nova primeira imagem", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
          fx.tenantA, "Produto Sync 2", `produto-sync-2-${runId}`, 10,
        ]),
        { commit: true },
      );
      const productId = created.rows[0]?.id as string;
      const pathFirst = galleryPath(fx.tenantA, productId, "first");
      const pathSecond = galleryPath(fx.tenantA, productId, "second");

      await withSuperuser(async (c) => {
        await c.query("insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 0)", [
          fx.tenantA, productId, pathFirst,
        ]);
        await c.query("insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 1)", [
          fx.tenantA, productId, pathSecond,
        ]);
      });

      const before = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
      expect(before.rows[0]?.main_image).toBe(pathFirst);

      // "Definir como principal" (setPrimaryProductGalleryImageAction) — mesmo UPDATE que a action faz.
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        async (c) => {
          await c.query("update public.product_images set sort_order = 0 where storage_path = $1", [pathSecond]);
          await c.query("update public.product_images set sort_order = 1 where storage_path = $1", [pathFirst]);
        },
        { commit: true },
      );

      const after = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
      expect(after.rows[0]?.main_image).toBe(pathSecond);
    });

    it("excluir a imagem principal promove a próxima da fila automaticamente", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
          fx.tenantA, "Produto Sync 3", `produto-sync-3-${runId}`, 10,
        ]),
        { commit: true },
      );
      const productId = created.rows[0]?.id as string;
      const pathFirst = galleryPath(fx.tenantA, productId, "first");
      const pathSecond = galleryPath(fx.tenantA, productId, "second");

      const rows = await withSuperuser(async (c) => {
        const r1 = await c.query(
          "insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 0) returning id",
          [fx.tenantA, productId, pathFirst],
        );
        await c.query("insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 1)", [
          fx.tenantA, productId, pathSecond,
        ]);
        return r1;
      });
      const firstImageId = rows.rows[0]?.id as string;

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.product_images where id = $1", [firstImageId]),
        { commit: true },
      );

      const after = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
      expect(after.rows[0]?.main_image).toBe(pathSecond);
    });

    it("excluir a única imagem da galeria limpa products.main_image (nunca deixa apontando para um arquivo removido)", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
          fx.tenantA, "Produto Sync 4", `produto-sync-4-${runId}`, 10,
        ]),
        { commit: true },
      );
      const productId = created.rows[0]?.id as string;
      const path = galleryPath(fx.tenantA, productId);

      const inserted = await withSuperuser((c) =>
        c.query(
          "insert into public.product_images (tenant_id, product_id, storage_path, sort_order) values ($1, $2, $3, 0) returning id",
          [fx.tenantA, productId, path],
        ),
      );
      const imageId = inserted.rows[0]?.id as string;

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.product_images where id = $1", [imageId]),
        { commit: true },
      );

      const after = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
      expect(after.rows[0]?.main_image).toBeNull();
    });
  });

  // Unique constraint — mesmo path duas vezes para o mesmo produto é rejeitado (também é o que torna o backfill idempotente).
  it("inserting the same (product_id, storage_path) twice is rejected by the unique constraint", async () => {
    const path = galleryPath(fx.tenantA, productA, "dup-test");
    await withSuperuser((c) =>
      c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
        fx.tenantA,
        productA,
        path,
      ]),
    );
    await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.product_images (tenant_id, product_id, storage_path) values ($1, $2, $3)", [
          fx.tenantA,
          productA,
          path,
        ]),
      ),
    );
  });

  // Backfill — produto com main_image pré-existente ganha a linha correspondente na galeria, sem duplicar/alterar o Storage.
  it("backfill: a product with a pre-existing main_image (simulating a legacy product before this migration) gets a matching product_images row after the migration's INSERT runs again", async () => {
    const legacyPath = `${fx.tenantA}/products/legacy-sim/main.jpg`;
    const created = await withSuperuser((c) =>
      c.query(
        "insert into public.products (tenant_id, name, slug, price, main_image) values ($1, $2, $3, $4, $5) returning id",
        [fx.tenantA, "Produto Legado Simulado", `produto-legado-simulado-${runId}`, 10, legacyPath],
      ),
    );
    const productId = created.rows[0]?.id as string;

    // O UPDATE acima já disparou o trigger de sync? Não — sync_product_main_image
    // só existe em product_images, não em products; um INSERT direto em
    // products com main_image já preenchido não cria uma linha na galeria
    // sozinho (é exatamente o cenário que o backfill da migration cobre).
    const beforeBackfill = await withSuperuser((c) =>
      c.query("select id from public.product_images where product_id = $1", [productId]),
    );
    expect(beforeBackfill.rows).toHaveLength(0);

    // Reaplica exatamente o INSERT de backfill da migration 20260817220096.
    await withSuperuser((c) =>
      c.query(
        `insert into public.product_images (tenant_id, product_id, storage_path, sort_order)
         select tenant_id, id, main_image, 0
         from public.products
         where id = $1 and main_image is not null
         on conflict (product_id, storage_path) do nothing`,
        [productId],
      ),
    );

    const afterBackfill = await withSuperuser((c) =>
      c.query("select storage_path from public.product_images where product_id = $1", [productId]),
    );
    expect(afterBackfill.rows).toHaveLength(1);
    expect(afterBackfill.rows[0]?.storage_path).toBe(legacyPath);

    // Idempotente: reaplicar de novo não duplica.
    await withSuperuser((c) =>
      c.query(
        `insert into public.product_images (tenant_id, product_id, storage_path, sort_order)
         select tenant_id, id, main_image, 0
         from public.products
         where id = $1 and main_image is not null
         on conflict (product_id, storage_path) do nothing`,
        [productId],
      ),
    );
    const afterSecondRun = await withSuperuser((c) =>
      c.query("select id from public.product_images where product_id = $1", [productId]),
    );
    expect(afterSecondRun.rows).toHaveLength(1);

    // O trigger sync_product_main_image, disparado pelo backfill, recalcula
    // products.main_image para o MESMO valor — nunca some/muda o arquivo.
    const productAfter = await withSuperuser((c) => c.query("select main_image from public.products where id = $1", [productId]));
    expect(productAfter.rows[0]?.main_image).toBe(legacyPath);
  });
});
