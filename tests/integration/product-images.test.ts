/**
 * Etapa 8 — Storage de imagem de produto (prompt Etapa 8 §18/§19).
 *
 * Mesmo padrão de sempre: RLS testada diretamente via SQL (asActor),
 * nunca invocando os Server Actions do Next.js diretamente (eles
 * dependem de `cookies()`/`next/headers`, fora de um request real — a
 * autoridade final de autorização é sempre a RLS, testada aqui; os
 * Server Actions só produzem uma mensagem de erro mais amigável em cima
 * da mesma checagem). `storage.objects`/`storage.buckets`/
 * `storage.foldername()` vêm do stub de teste (supabase-stub.sql) — uma
 * réplica simplificada do schema real do Supabase Storage, o suficiente
 * para exercitar as MESMAS policies da migration 20260817220028 que
 * valerão em produção. Upload/leitura de bytes reais do Storage não pode
 * ser validado neste sandbox (sem daemon Docker) — ver relatório final.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Storage de imagem de produto (Etapa 8)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`img-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );

      const { rows: prodARows } = await client.query<{ id: string }>(
        `insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id`,
        [fx.tenantA, "Produto A", `produto-a-${runId}`, 10],
      );
      productA = prodARows[0]!.id;

      const { rows: prodBRows } = await client.query<{ id: string }>(
        `insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id`,
        [fx.tenantB, "Produto B", `produto-b-${runId}`, 10],
      );
      productB = prodBRows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  function objectName(tenantId: string, productId: string, file = "main.jpg") {
    return `${tenantId}/products/${productId}/${file}`;
  }

  // 1/5 — usuário com products.update consegue "iniciar upload" (INSERT em storage.objects).
  it("OWNER with products.update can insert a product-media object for their own tenant", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("insert into storage.objects (bucket_id, name) values ($1, $2) returning id", [
        "product-media",
        objectName(fx.tenantA, productA),
      ]),
    );
    expect(result.rows).toHaveLength(1);
  });

  // 2 — não autenticado (anon) é bloqueado para escrever.
  it("anon cannot insert into product-media", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "product-media",
          objectName(fx.tenantA, productA),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  // 3 — autenticado sem membership no tenant é bloqueado.
  it("authenticated user without membership cannot insert into any tenant's product-media", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "product-media",
          objectName(fx.tenantA, productA),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  // 4 — membro sem products.create/products.update (OPERATOR) é bloqueado.
  it("a member without products.create/products.update (OPERATOR) cannot insert", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "product-media",
          objectName(fx.tenantA, productA),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  // 9/11 — tenant A não consegue inserir/associar imagem no path do tenant B (cross-tenant), mesmo tendo products.create em A.
  it("a tenant A member cannot insert an object under tenant B's path", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "product-media",
          objectName(fx.tenantB, productB),
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  // 17 — path malformado ("path traversal"-like) falha com segurança (nunca vira um bypass silencioso).
  it("a malformed/traversal-like path is rejected, not silently accepted", async () => {
    await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
          "product-media",
          `../${fx.tenantB}/products/${productB}/main.jpg`,
        ]),
      ),
    );
  });

  // 9/10 — tenant A não consegue excluir/alterar objeto do tenant B.
  it("tenant A cannot update or delete tenant B's product-media object", async () => {
    const bObjectName = objectName(fx.tenantB, productB, "existing.jpg");
    await withSuperuser((c) =>
      c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", ["product-media", bObjectName]),
    );

    const updateResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("update storage.objects set name = name where bucket_id = 'product-media' and name = $1", [
        bObjectName,
      ]),
    );
    // RLS bloqueia via USING — UPDATE não lança erro, só afeta 0 linhas.
    expect(updateResult.rowCount).toBe(0);

    const deleteResult = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("delete from storage.objects where bucket_id = 'product-media' and name = $1", [bObjectName]),
    );
    // RLS bloqueia via USING — DELETE não lança erro, só afeta 0 linhas.
    expect(deleteResult.rowCount).toBe(0);
  });

  // 12/13 — leitura é pública por design (bucket público, arquitetura §9.1) — anon e qualquer autenticado leem.
  it("SELECT on product-media is public by design (anon and any authenticated user)", async () => {
    const objName = objectName(fx.tenantA, productA);
    await withSuperuser((c) =>
      c.query(
        "insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing",
        ["product-media", objName],
      ),
    );

    const asAnon = await asActor({ role: "anon" }, (c) =>
      c.query("select 1 from storage.objects where bucket_id = 'product-media' and name = $1", [objName]),
    );
    expect(asAnon.rows).toHaveLength(1);

    const asOutsider = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select 1 from storage.objects where bucket_id = 'product-media' and name = $1", [objName]),
    );
    expect(asOutsider.rows).toHaveLength(1);
  });

  // 20 — auditoria: upload/substituição/remoção de imagem geram os 3 eventos distintos do prompt §14.
  it("changing products.main_image is audited as PRODUCT_IMAGE_UPLOADED/UPDATED/DELETED", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
          fx.tenantA, "Produto Auditoria Imagem", `produto-audit-imagem-${runId}`, 20,
        ]),
      { commit: true },
    );
    const auditedProductId = created.rows[0]?.id as string;

    // null -> path: PRODUCT_IMAGE_UPLOADED
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.products set main_image = $1 where id = $2", [
        objectName(fx.tenantA, auditedProductId), auditedProductId,
      ]),
      { commit: true },
    );
    // path -> outro path: PRODUCT_IMAGE_UPDATED
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.products set main_image = $1 where id = $2", [
        objectName(fx.tenantA, auditedProductId, "main.webp"), auditedProductId,
      ]),
      { commit: true },
    );
    // path -> null: PRODUCT_IMAGE_DELETED
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("update public.products set main_image = null where id = $1", [auditedProductId]),
      { commit: true },
    );

    const events = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select action from public.audit_logs where tenant_id = $1 and resource_id = $2 order by created_at", [
        fx.tenantA, auditedProductId,
      ]),
    );
    const actions = events.rows.map((r) => r.action as string);
    expect(actions).toContain("PRODUCT_IMAGE_UPLOADED");
    expect(actions).toContain("PRODUCT_IMAGE_UPDATED");
    expect(actions).toContain("PRODUCT_IMAGE_DELETED");
    // Nunca classificado como o PRODUCT_UPDATED genérico quando só main_image muda.
    expect(actions.filter((a) => a === "PRODUCT_UPDATED")).toHaveLength(0);
  });

  // 20 — a migration cria exatamente o bucket documentado na arquitetura, sem duplicar bucket.
  it("the product-media bucket is public with the documented 5MB limit and 3-mime allow-list", async () => {
    const { rows } = await withSuperuser((c) =>
      c.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-media'",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(true);
    expect(Number(rows[0]!.file_size_limit)).toBe(5 * 1024 * 1024);
    expect(rows[0]!.allowed_mime_types.sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});
