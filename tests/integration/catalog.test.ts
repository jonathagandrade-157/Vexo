/**
 * Etapa 7 — catálogo: categorias e produtos (prompt Etapa 7 §22/§23).
 *
 * Mesmo harness e fixtures de sempre (buildFixtures). Os 30 cenários
 * pedidos no prompt estão mapeados nos comentários de cada teste — vários
 * setups (fixtures extras de OPERATOR/SUPPORT, categoria/produto prontos)
 * ficam no beforeAll para não repetir em cada teste.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Catálogo — categorias e produtos (Etapa 7)", () => {
  let fx: Fixtures;
  let userAOperator: string;
  let userASupport: string;
  /** categoria + produto "prontos" em tenant A, reutilizados por vários testes de leitura/isolamento. */
  let readyCategoryId: string;
  let readyProductId: string;
  let readyProductSlug: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      // Etapa 16: os produtos/categorias criados abaixo testam catálogo,
      // não enforcement de plano — PRO evita que o novo trigger de limite
      // bloqueie os inserts de fixture (o enforcement em si é testado em
      // commercial-foundation.test.ts, com tenants BASIC/INTERMEDIATE dedicados).
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`catalog-operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );

      const { rows: supRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`catalog-support-${runId}@fixtures.test`],
      );
      userASupport = supRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userASupport, fx.roleIds.SUPPORT],
      );

      const { rows: catRows } = await client.query<{ id: string }>(
        `insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id`,
        [fx.tenantA, "Perfumes", `perfumes-${runId}`],
      );
      readyCategoryId = catRows[0]!.id;

      const { rows: prodRows } = await client.query<{ id: string; slug: string }>(
        `insert into public.products (tenant_id, category_id, name, slug, description, price, promotional_price)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, slug`,
        [fx.tenantA, readyCategoryId, "Perfume Autoral", `perfume-autoral-${runId}`, "Fragrância exclusiva.", 199.9, 149.9],
      );
      readyProductId = prodRows[0]!.id;
      readyProductSlug = prodRows[0]!.slug;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1/9 — OWNER cria categoria e produto.
  it("OWNER can create a category and a product", async () => {
    const category = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id", [
        fx.tenantA, "Roupas", `roupas-owner-${runId}`,
      ]),
    );
    expect(category.rows).toHaveLength(1);

    const product = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
        fx.tenantA, "Camiseta", `camiseta-owner-${runId}`, 79.9,
      ]),
    );
    expect(product.rows).toHaveLength(1);
  });

  // 2/10 — ADMIN cria categoria e produto.
  it("ADMIN can create a category and a product", async () => {
    const category = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id", [
        fx.tenantA, "Acessórios", `acessorios-admin-${runId}`,
      ]),
    );
    expect(category.rows).toHaveLength(1);

    const product = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
        fx.tenantA, "Boné", `bone-admin-${runId}`, 59.9,
      ]),
    );
    expect(product.rows).toHaveLength(1);
  });

  // 3/11 — sem permission (OPERATOR, SUPPORT, outsider) não cria nem categoria nem produto.
  it("users without categories.create/products.create cannot create either", async () => {
    for (const userId of [userAOperator, userASupport, fx.userOutsider]) {
      const catErr = await expectPgError(
        asActor({ role: "authenticated", userId }, (c) =>
          c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3)", [
            fx.tenantA, "Sem Permissão", `sem-permissao-${userId.slice(0, 6)}-${runId}`,
          ]),
        ),
      );
      expect(catErr.message).toMatch(/row-level security|permission denied/i);

      const prodErr = await expectPgError(
        asActor({ role: "authenticated", userId }, (c) =>
          c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4)", [
            fx.tenantA, "Sem Permissão", `sem-permissao-prod-${userId.slice(0, 6)}-${runId}`, 10,
          ]),
        ),
      );
      expect(prodErr.message).toMatch(/row-level security|permission denied/i);
    }
  });

  // 4/12 — categoria/produto pertencem ao tenant correto.
  it("created category and product belong to the correct tenant", async () => {
    const category = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select tenant_id from public.categories where id = $1", [readyCategoryId]),
    );
    expect(category.rows[0]?.tenant_id).toBe(fx.tenantA);

    const product = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select tenant_id from public.products where id = $1", [readyProductId]),
    );
    expect(product.rows[0]?.tenant_id).toBe(fx.tenantA);
  });

  // 5/14 — categoria/produto de outro tenant não podem ser acessados.
  it("a category and product from another tenant are invisible to a non-member", async () => {
    const category = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.categories where id = $1", [readyCategoryId]),
    );
    expect(category.rows).toHaveLength(0);

    const product = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select id from public.products where id = $1", [readyProductId]),
    );
    expect(product.rows).toHaveLength(0);
  });

  // 6 — categoria duplicada (mesmo nome -> mesmo slug) é rejeitada.
  it("a duplicate category name (same slug) is rejected", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3)", [
          fx.tenantA, "Perfumes Novamente", `perfumes-${runId}`,
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique/i);
  });

  // 7 — slug duplicado (produto) é rejeitado, mesmo mecanismo, tabela diferente.
  it("a duplicate product slug is rejected", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4)", [
          fx.tenantA, "Outro Nome", readyProductSlug, 50,
        ]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique/i);
  });

  // 8 — slug inválido (formato) é rejeitado, em ambas as tabelas.
  it("an invalid slug format is rejected for categories and products", async () => {
    const catErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3)", [
          fx.tenantA, "Categoria Inválida", "Slug Inválido!!",
        ]),
      ),
    );
    expect(catErr.message).toMatch(/check constraint|categories_slug_format/i);

    const prodErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4)", [
          fx.tenantA, "Produto Inválido", "Slug Inválido!!", 10,
        ]),
      ),
    );
    expect(prodErr.message).toMatch(/check constraint|products_slug_format/i);
  });

  // 13 — produto não pode usar categoria de outro tenant.
  it("a product cannot use a category belonging to another tenant", async () => {
    const otherCategory = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id", [
        fx.tenantB, "Categoria B", `categoria-b-${runId}`,
      ]),
      { commit: true },
    );
    const categoryBId = otherCategory.rows[0]?.id as string;

    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.products (tenant_id, category_id, name, slug, price) values ($1, $2, $3, $4, $5)", [
          fx.tenantA, categoryBId, "Produto Cross Tenant", `produto-cross-tenant-${runId}`, 10,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant/i);
  });

  // 15/16 — preço inválido (negativo, ou promocional acima do normal) é rejeitado.
  it("a negative price and a promotional price above the normal price are both rejected", async () => {
    const negativeErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4)", [
          fx.tenantA, "Preço Negativo", `preco-negativo-${runId}`, -10,
        ]),
      ),
    );
    expect(negativeErr.message).toMatch(/check constraint/i);

    const promoErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query(
          "insert into public.products (tenant_id, name, slug, price, promotional_price) values ($1, $2, $3, $4, $5)",
          [fx.tenantA, "Promo Maior", `promo-maior-${runId}`, 50, 80],
        ),
      ),
    );
    expect(promoErr.message).toMatch(/check constraint/i);
  });

  // 17 — atualização de produto funciona.
  it("updating a product persists the new values", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
        fx.tenantA, "Produto Editável", `produto-editavel-${runId}`, 100,
      ]),
      { commit: true },
    );
    const productId = created.rows[0]?.id as string;

    const updated = await asActor(
      { role: "authenticated", userId: fx.userAAdmin },
      (c) => c.query("update public.products set name = $1, price = $2 where id = $3 returning name, price", [
        "Produto Editado", 120, productId,
      ]),
      { commit: true },
    );
    expect(updated.rows[0]?.name).toBe("Produto Editado");
    expect(Number(updated.rows[0]?.price)).toBe(120);
  });

  // 18 — exclusão de produto funciona.
  it("deleting a product works for a user with products.delete", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
        fx.tenantA, "Produto Deletável", `produto-deletavel-${runId}`, 30,
      ]),
      { commit: true },
    );
    const productId = created.rows[0]?.id as string;

    const deleted = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("delete from public.products where id = $1", [productId]),
      { commit: true },
    );
    expect(deleted.rowCount).toBe(1);

    const check = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.products where id = $1", [productId]),
    );
    expect(check.rows).toHaveLength(0);
  });

  // 19 — categoria com produtos não pode ser excluída (produtos órfãos evitados pelo próprio banco).
  it("a category with linked products cannot be deleted (no orphan products)", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("delete from public.categories where id = $1", [readyCategoryId]),
      ),
    );
    expect(err.message).toMatch(/foreign key|violates/i);

    const stillThere = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.products where id = $1", [readyProductId]),
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  // 20/29 — status do produto funciona e gera PRODUCT_STATUS_CHANGED em audit_logs.
  it("toggling a product's status persists and is audited", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id", [
        fx.tenantB, "Produto Toggle", `produto-toggle-${runId}`, 40,
      ]),
      { commit: true },
    );
    const productId = created.rows[0]?.id as string;

    await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("update public.products set status = 'inactive' where id = $1", [productId]),
      { commit: true },
    );

    const check = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select status from public.products where id = $1", [productId]),
    );
    expect(check.rows[0]?.status).toBe("inactive");

    const events = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select action from public.audit_logs where tenant_id = $1 and resource_id = $2", [
        fx.tenantB, productId,
      ]),
    );
    const actions = events.rows.map((r) => r.action as string);
    expect(actions).toContain("PRODUCT_CREATED");
    expect(actions).toContain("PRODUCT_STATUS_CHANGED");
  });

  // 21/29 — status da categoria funciona e é auditado.
  it("toggling a category's status persists and is audited", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id", [
        fx.tenantB, "Categoria Toggle", `categoria-toggle-${runId}`,
      ]),
      { commit: true },
    );
    const categoryId = created.rows[0]?.id as string;

    await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("update public.categories set status = 'inactive' where id = $1", [categoryId]),
      { commit: true },
    );

    const check = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select status from public.categories where id = $1", [categoryId]),
    );
    expect(check.rows[0]?.status).toBe("inactive");

    const events = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select action from public.audit_logs where tenant_id = $1 and resource_id = $2 order by created_at", [
        fx.tenantB, categoryId,
      ]),
    );
    const actions = events.rows.map((r) => r.action as string);
    expect(actions).toContain("CATEGORY_CREATED");
    expect(actions).toContain("CATEGORY_UPDATED");
  });

  // 22/23 — double submit / slug concorrente: duas inserções com o mesmo
  // slug (disparadas juntas, simulando concorrência real) — só uma
  // sobrevive, a outra falha com 23505, nunca duas linhas.
  it("concurrent inserts with the same slug never create two rows (double submit / race condition)", async () => {
    const slug = `produto-concorrente-${runId}`;
    const attempt = () =>
      asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4)", [
          fx.tenantA, "Produto Concorrente", slug, 25,
        ]),
        { commit: true },
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rows = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.products where tenant_id = $1 and slug = $2", [fx.tenantA, slug]),
    );
    expect(rows.rows).toHaveLength(1);
  });

  // 24/25/26/27 — storefront (anon) só vê produto/categoria ativos, com
  // projeção sem tenant_id/campo administrativo nenhum.
  it("anon (storefront) only sees active products/categories, with a public-safe column set", async () => {
    const inactiveProduct = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.products (tenant_id, name, slug, price, status) values ($1, $2, $3, $4, 'inactive') returning id", [
        fx.tenantA, "Produto Inativo", `produto-inativo-${runId}`, 15,
      ]),
      { commit: true },
    );

    const active = await asActor({ role: "anon" }, (c) =>
      c.query("select id, name, slug, price, promotional_price, main_image from public.products where id = $1", [
        readyProductId,
      ]),
    );
    expect(active.rows).toHaveLength(1);
    expect(Object.keys(active.rows[0]!).sort()).toEqual(
      ["id", "main_image", "name", "price", "promotional_price", "slug"].sort(),
    );

    const inactive = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.products where id = $1", [inactiveProduct.rows[0]?.id]),
    );
    expect(inactive.rows).toHaveLength(0);

    // tenant_id nunca faz parte de nenhuma projeção pública real (a
    // aplicação nunca faz select * para anon) — confirmado aqui
    // explicitamente pedindo a coluna e checando que ela NÃO aparece
    // quando a query (como a real) não a inclui.
    const publicShapeQuery = await asActor({ role: "anon" }, (c) =>
      c.query("select id, name, slug from public.categories where id = $1", [readyCategoryId]),
    );
    expect(Object.keys(publicShapeQuery.rows[0]!)).not.toContain("tenant_id");
  });

  // Sprint 1 — Fase B2 §15.4 — `getStorefrontPromotions` (features/storefront/promotions.ts)
  // é só um filtro `promotional_price is not null` sobre o mesmo produto
  // público de sempre, nunca uma tabela/coluna nova. Confirma que o filtro
  // separa corretamente quem tem promoção de quem não tem, sem vazar
  // produto inativo.
  it("promotional_price correctly identifies which active products belong in the storefront promotions section", async () => {
    const nonPromoProduct = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "insert into public.products (tenant_id, name, slug, price, promotional_price) values ($1, $2, $3, $4, null) returning id",
          [fx.tenantA, "Produto Sem Promoção", `produto-sem-promocao-${runId}`, 89.9],
        ),
      { commit: true },
    );

    const promotional = await asActor({ role: "anon" }, (c) =>
      c.query("select id, promotional_price from public.products where tenant_id = $1 and promotional_price is not null", [
        fx.tenantA,
      ]),
    );
    const promotionalIds = promotional.rows.map((r) => r.id as string);
    expect(promotionalIds).toContain(readyProductId);
    expect(promotionalIds).not.toContain(nonPromoProduct.rows[0]?.id);
  });

  // 27 (reforço) — anon não acessa tabelas administrativas relacionadas ao catálogo.
  it("anon cannot write to categories/products at all (only the public SELECT policy exists for anon)", async () => {
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("update public.products set price = 0 where id = $1", [readyProductId]),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);
  });

  // 28 — usuário autenticado não consegue "se passar pelo storefront" para
  // escapar da RLS administrativa. A policy pública (migration
  // 20260817220026) é `to anon` só — de propósito, mesma correção da
  // Etapa 6: cobrir `authenticated` também alargaria a visibilidade para
  // QUALQUER uso autenticado da tabela, não só o storefront. Por isso um
  // usuário autenticado sem membership/permission NÃO enxerga nem o
  // produto ativo (que `anon` veria sem problema) rodando a mesma query —
  // ele só teria essa visibilidade indo pelo cliente público de verdade
  // (createSupabasePublicClient, que autentica como anon), nunca pela
  // própria sessão. Resultado esperado aqui é 0 linhas, não 1.
  it("an authenticated user without membership gets zero rows, never the anon-only public view", async () => {
    const asOutsider = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select id, name, slug from public.products where id = $1 and status = 'active'", [readyProductId]),
    );
    expect(asOutsider.rows).toHaveLength(0);

    // O que precisa continuar bloqueado: nenhuma coluna/linha administrativa extra.
    const adminAttempt = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("select id from public.tenant_members where tenant_id = $1", [fx.tenantA]),
    );
    expect(adminAttempt.rows).toHaveLength(0);
  });

  // 30 — usuário sem membership não altera catálogo (UPDATE/DELETE).
  it("a user with no membership cannot update or delete another tenant's catalog", async () => {
    const updateAttempt = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("update public.products set name = 'Invadido' where id = $1 returning id", [readyProductId]),
    );
    expect(updateAttempt.rows).toHaveLength(0);

    const deleteAttempt = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query("delete from public.categories where id = $1 returning id", [readyCategoryId]),
    );
    expect(deleteAttempt.rows).toHaveLength(0);
  });
});
