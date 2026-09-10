/**
 * D20.5 — checkout com variantes (product_variants, D20.2/D20.4 já
 * aplicadas). Mesmo padrão de checkout.test.ts/product-inventory.test.ts/
 * order-management.test.ts: RLS/trigger/RPC testados diretamente via SQL
 * (asActor/withSuperuser), nunca chamando features/checkout/actions.ts
 * diretamente.
 *
 * Escopo específico deste arquivo (não duplicado dos três acima, que já
 * cobrem o caminho de produto simples e continuam passando sem alteração
 * depois desta migration): tudo que create_order_from_cart/
 * update_order_status/get_order_confirmation passam a fazer quando
 * cart_items.variant_id/order_items.variant_id estão preenchidos —
 * preço da variante, snapshot (variant_sku/variant_label/variant_options),
 * e a correção do bug crítico da auditoria D20.5 Fase 1 §B.1 (o
 * decremento de estoque deixava de ser escopado por variant_id e podia
 * atingir todas as linhas de product_inventory de um produto com
 * variantes numa única compra).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

const address = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

interface VariantOptionInput {
  optionName: string;
  position: number;
  value: string;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Checkout com variantes (D20.5)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
    await withSuperuser((client) => giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]));
  });

  afterAll(async () => {
    await pool.end();
  });

  function slugify(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function insertProduct(tenantId: string, name: string, price: number): Promise<string> {
    return withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.products (tenant_id, name, slug, price) values ($1, $2, $3, $4) returning id",
        [tenantId, name, `${slugify(name)}-${runId}-${randomUUID().slice(0, 6)}`, price],
      );
      return rows[0]!.id;
    });
  }

  /**
   * Cria N option_value_ids (reaproveitando product_options/
   * product_option_values já existentes para o MESMO (product_id, name)/
   * (product_option_id, value), respeitando os índices únicos de D20.1 —
   * várias variantes do mesmo produto compartilhando a mesma opção, ex.:
   * "Cor", são o caso normal) e uma product_variants apontando para eles
   * — array canônico (ordenado por uuid) montado no próprio SQL, nunca no
   * client, exatamente como o CHECK de D20.2 exige.
   */
  async function insertVariant(
    tenantId: string,
    productId: string,
    options: VariantOptionInput[],
    price: number,
    overrides: { sku?: string; promotionalPrice?: number; isActive?: boolean } = {},
  ): Promise<string> {
    return withSuperuser(async (c) => {
      const valueIds: string[] = [];
      for (const opt of options) {
        const { rows: existingOpt } = await c.query<{ id: string }>(
          "select id from public.product_options where product_id = $1 and lower(name) = lower($2)",
          [productId, opt.optionName],
        );
        const optionId =
          existingOpt[0]?.id ??
          (
            await c.query<{ id: string }>(
              "insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, $3, $4) returning id",
              [tenantId, productId, opt.optionName, opt.position],
            )
          ).rows[0]!.id;

        const { rows: existingVal } = await c.query<{ id: string }>(
          "select id from public.product_option_values where product_option_id = $1 and lower(value) = lower($2)",
          [optionId, opt.value],
        );
        const valueId =
          existingVal[0]?.id ??
          (
            await c.query<{ id: string }>(
              "insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, $3, 0) returning id",
              [tenantId, optionId, opt.value],
            )
          ).rows[0]!.id;

        valueIds.push(valueId);
      }
      const { rows } = await c.query<{ id: string }>(
        `insert into public.product_variants (tenant_id, product_id, sku, price, promotional_price, option_value_ids, is_active)
         values ($1, $2, $3, $4, $5, (select array_agg(v order by v) from unnest($6::uuid[]) as v), $7)
         returning id`,
        [tenantId, productId, overrides.sku ?? null, price, overrides.promotionalPrice ?? null, valueIds, overrides.isActive ?? true],
      );
      return rows[0]!.id;
    });
  }

  async function setInventory(tenantId: string, productId: string, variantId: string | null, stock: number): Promise<void> {
    await withSuperuser((c) =>
      c.query("insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, $4)", [
        tenantId,
        productId,
        variantId,
        stock,
      ]),
    );
  }

  async function createCartWithVariantItem(tenantId: string, productId: string, variantId: string, quantity = 1): Promise<string> {
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, tenantId]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)", [
          cartId,
          tenantId,
          productId,
          variantId,
          quantity,
        ]),
      { commit: true },
    );
    return cartId;
  }

  function callCreateOrder(tenantId: string, cartId: string) {
    return asActor(
      { role: "anon" },
      (c) =>
        c.query<{ create_order_from_cart: string }>("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          tenantId,
          cartId,
          "Cliente Variante",
          "variante@example.com",
          "11999999999",
          JSON.stringify(address),
        ]),
      { commit: true },
    );
  }

  function cancelOrder(tenantId: string, orderId: string, actorUserId: string) {
    return asActor(
      { role: "authenticated", userId: actorUserId },
      (c) => c.query("select update_order_status($1, $2, 'CANCELLED', null)", [tenantId, orderId]),
      { commit: true },
    );
  }

  async function stockOf(productId: string, variantId: string | null): Promise<number> {
    const { rows } = await withSuperuser((c) =>
      c.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where product_id = $1 and variant_id is not distinct from $2",
        [productId, variantId],
      ),
    );
    return rows[0]!.stock_quantity;
  }

  async function orderItemsOf(orderId: string) {
    const { rows } = await withSuperuser((c) =>
      c.query(
        "select variant_id, variant_sku, variant_label, variant_options, unit_price, subtotal, stock_reserved from public.order_items where order_id = $1",
        [orderId],
      ),
    );
    return rows;
  }

  // ---------------------------------------------------------------------
  // INTEGRATION
  // ---------------------------------------------------------------------

  it("checkout com variante: usa o preço da VARIANTE (nunca o do produto-pai), grava variant_id/variant_sku/variant_label/variant_options, e decrementa SÓ o estoque da variante comprada — não o de outras variantes do mesmo produto", async () => {
    const productId = await insertProduct(fx.tenantA, "Camiseta D20.5", 50);
    const variantPreto = await insertVariant(
      fx.tenantA,
      productId,
      [
        { optionName: "Cor", position: 0, value: "Preto" },
        { optionName: "Tamanho", position: 1, value: "M" },
      ],
      80,
      { sku: "CAM-PRT-M" },
    );
    // Segunda variante do MESMO produto, reaproveitando a opção "Cor" já
    // criada mas com um valor novo — sua própria linha de estoque,
    // separada, é o que prova a correção do bug crítico §B.1.
    const productOptionRows = await withSuperuser((c) =>
      c.query<{ id: string; product_id: string }>("select id from public.product_options where product_id = $1 and name = 'Cor'", [
        productId,
      ]),
    );
    const corOptionId = productOptionRows.rows[0]!.id;
    const tamanhoOptionRows = await withSuperuser((c) =>
      c.query<{ id: string }>("select id from public.product_options where product_id = $1 and name = 'Tamanho'", [productId]),
    );
    const tamanhoOptionId = tamanhoOptionRows.rows[0]!.id;
    const brancoValue = await withSuperuser((c) =>
      c.query<{ id: string }>(
        "insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, 'Branco', 1) returning id",
        [fx.tenantA, corOptionId],
      ),
    );
    const mValue = await withSuperuser((c) =>
      c.query<{ id: string }>("select id from public.product_option_values where product_option_id = $1 and value = 'M'", [
        tamanhoOptionId,
      ]),
    );
    const variantBranco = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.product_variants (tenant_id, product_id, price, option_value_ids)
         values ($1, $2, 90, (select array_agg(v order by v) from unnest(array[$3, $4]::uuid[]) as v))
         returning id`,
        [fx.tenantA, productId, brancoValue.rows[0]!.id, mValue.rows[0]!.id],
      );
      return rows[0]!.id;
    });

    await setInventory(fx.tenantA, productId, variantPreto, 5);
    await setInventory(fx.tenantA, productId, variantBranco, 5);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantPreto, 2);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const items = await orderItemsOf(orderId);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.variant_id).toBe(variantPreto);
    expect(item.variant_sku).toBe("CAM-PRT-M");
    expect(item.variant_label).toBe("Preto / M"); // ordem por product_options.position (Cor=0, Tamanho=1)
    expect(item.variant_options).toEqual([
      { option: "Cor", value: "Preto" },
      { option: "Tamanho", value: "M" },
    ]);
    expect(Number(item.unit_price)).toBe(80); // preço da VARIANTE, nunca o do produto-pai (50)
    expect(Number(item.subtotal)).toBe(160);
    expect(item.stock_reserved).toBe(true);

    // A correção do bug crítico: só o estoque da variante Preto foi tocado.
    expect(await stockOf(productId, variantPreto)).toBe(3); // 5 - 2
    expect(await stockOf(productId, variantBranco)).toBe(5); // intacto
  });

  it("preço promocional da variante prevalece sobre o preço normal da variante (nunca o do produto-pai)", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Promo Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Vermelho" }], 100, {
      promotionalPrice: 70,
    });

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const items = await orderItemsOf(orderId);
    expect(Number(items[0]!.unit_price)).toBe(70);
  });

  it("produto simples continua com variant_id/variant_sku/variant_label/variant_options todos NULL (comportamento de Etapa 10 preservado)", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Simples D20.5", 33);
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [
        cartId,
        fx.tenantA,
        productId,
      ]),
      { commit: true },
    );

    const result = await callCreateOrder(fx.tenantA, cartId);
    const items = await orderItemsOf(result.rows[0]!.create_order_from_cart);
    expect(items[0]).toMatchObject({ variant_id: null, variant_sku: null, variant_label: null, variant_options: null });
    expect(Number(items[0]!.unit_price)).toBe(33);
  });

  it("MEDIUM-1 (revisão independente Fase 3): produto passa a exigir variante DEPOIS que um item simples já estava no carrinho — checkout rejeita o pedido inteiro, sem consumir estoque, sem order/order_items parcial, carrinho preservado", async () => {
    // 1. Produto criado SEM nenhuma variante ainda.
    const productId = await insertProduct(fx.tenantA, "Produto Passa A Exigir Variante", 40);
    await setInventory(fx.tenantA, productId, null, 10);

    // 2. Item simples (variant_id NULL) adicionado ao carrinho — válido
    // no momento em que foi feito, o produto ainda não tinha variantes.
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [
        cartId,
        fx.tenantA,
        productId,
      ]),
      { commit: true },
    );

    // 3. Lojista cadastra uma variante para esse produto DEPOIS — o item
    // antigo do carrinho continua com variant_id NULL (nada revalida
    // cart_items retroativamente).
    await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Turquesa" }], 45);

    // 4/5. Tenta finalizar com o item antigo (ainda variant_id NULL).
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/requires selecting a variant/i);

    // 6. Nenhum consumo de estoque — nem da linha "produto simples"...
    expect(await stockOf(productId, null)).toBe(10);

    // 7. Nenhum order/order_items parcial criado para este carrinho.
    const orders = await withSuperuser((c) =>
      c.query("select o.id from public.orders o join public.order_items oi on oi.order_id = o.id where oi.product_id = $1", [productId]),
    );
    expect(orders.rows).toHaveLength(0);

    // 8. Carrinho preservado (comportamento transacional existente —
    // mesmo padrão já usado para produto inativo/estoque insuficiente).
    const cartItems = await withSuperuser((c) => c.query("select quantity from public.cart_items where cart_id = $1", [cartId]));
    expect(cartItems.rows).toHaveLength(1);
    expect(cartItems.rows[0]?.quantity).toBe(1);
  });

  it("MEDIUM-1: produto REALMENTE simples (nunca teve variante) continua vendendo normalmente — a correção não bloqueia o caso legítimo", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Genuinamente Simples", 22);
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, quantity) values ($1, $2, $3, 1)", [
        cartId,
        fx.tenantA,
        productId,
      ]),
      { commit: true },
    );

    const result = await callCreateOrder(fx.tenantA, cartId);
    expect(result.rows[0]!.create_order_from_cart).toBeTruthy();
  });

  it("variante inexistente: cart_items nunca consegue referenciar um variant_id que não existe (FK) — estruturalmente impossível chegar ao checkout nesse estado", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto FK Variante", 10);
    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
          cartId,
          fx.tenantA,
          productId,
          randomUUID(),
        ]),
      ),
    );
    // O trigger de cart_items roda ANTES da FK ser checada e já rejeita
    // aqui — o SELECT contra product_variants não encontra nada (id
    // aleatório), então cai na mesma checagem de "não pertence ao mesmo
    // product_id/tenant_id" usada para variante de outro produto/tenant.
    expect(err.message).toMatch(/must belong to the same product|must belong to the same tenant/i);
  });

  it("variante inativa entre add-to-cart e checkout: rejeita O PEDIDO INTEIRO (nunca remove só o item), preserva o carrinho, nenhum estoque tocado", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Desativado Depois", 25);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Cinza" }], 30);
    await setInventory(fx.tenantA, productId, variantId, 10);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    await withSuperuser((c) => c.query("update public.product_variants set is_active = false where id = $1", [variantId]));

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/no longer available/i);

    const cartItems = await withSuperuser((c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(cartItems.rows).toHaveLength(1); // carrinho preservado
    expect(await stockOf(productId, variantId)).toBe(10); // nenhum decremento parcial
  });

  it("variante não pode ser reatribuída para outro produto depois de criada — bloqueada pelo próprio trigger de product_variants (validate_product_variant_option_values, D20.2), camada abaixo de cart_items/checkout", async () => {
    const productX = await insertProduct(fx.tenantA, "Produto X Reatribuicao", 40);
    const productY = await insertProduct(fx.tenantA, "Produto Y Reatribuicao", 60);
    const variantId = await insertVariant(fx.tenantA, productX, [{ optionName: "Cor", position: 0, value: "Verde" }], 45);

    // Tentar "mover" a variante para outro produto do mesmo tenant já é
    // barrado na origem: option_value_ids continua apontando para
    // valores de opções do produto X, e o trigger reexecuta a validação
    // completa em TODO update (não só quando option_value_ids muda) —
    // nunca chega perto de cart_items/checkout.
    const err = await expectPgError(
      withSuperuser((c) => c.query("update public.product_variants set product_id = $1 where id = $2", [productY, variantId])),
    );
    expect(err.message).toMatch(/does not exist, or does not belong to the same product\/tenant/i);
  });

  it("variante de outro produto: tentativa de inserir direto em cart_items é bloqueada pelo próprio trigger de cart_items, antes de chegar ao checkout", async () => {
    const productX = await insertProduct(fx.tenantA, "Produto X Cross Product", 40);
    const productY = await insertProduct(fx.tenantA, "Produto Y Cross Product", 60);
    const variantOfY = await insertVariant(fx.tenantA, productY, [{ optionName: "Cor", position: 0, value: "Roxo" }], 65);

    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
          cartId,
          fx.tenantA,
          productX,
          variantOfY,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same product/i);
  });

  it("variante de outro tenant: bloqueada pelo trigger de cart_items no INSERT — checkout nunca chega a vê-la", async () => {
    const productA = await insertProduct(fx.tenantA, "Produto A Cross Tenant", 40);
    const productB = await insertProduct(fx.tenantB, "Produto B Cross Tenant", 40);
    const variantB = await insertVariant(fx.tenantB, productB, [{ optionName: "Cor", position: 0, value: "Preto" }], 45);

    const cartId = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartId, fx.tenantA]), {
      commit: true,
    });
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
          cartId,
          fx.tenantA,
          productA,
          variantB,
        ]),
      ),
    );
    expect(err.message).toMatch(/must belong to the same tenant|must belong to the same product/i);
  });

  it("estoque insuficiente para a variante: rejeita, reverte por completo (nenhum order/order_items), estoque intacto, carrinho preservado", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Sem Estoque Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Amarelo" }], 25);
    await setInventory(fx.tenantA, productId, variantId, 0);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/insufficient stock/i);

    expect(await stockOf(productId, variantId)).toBe(0);
    const cartItems = await withSuperuser((c) => c.query("select 1 from public.cart_items where cart_id = $1", [cartId]));
    expect(cartItems.rows).toHaveLength(1);
  });

  it("carrinho de outro tenant (variante): p_tenant_id não bate com o dono do carrinho — rejeitado antes de tocar estoque", async () => {
    const productB = await insertProduct(fx.tenantB, "Produto B Tenant Hop", 40);
    const variantB = await insertVariant(fx.tenantB, productB, [{ optionName: "Cor", position: 0, value: "Preto" }], 45);
    await setInventory(fx.tenantB, productB, variantB, 5);

    const cartId = await createCartWithVariantItem(fx.tenantB, productB, variantB, 1);
    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart not found/i);
    expect(await stockOf(productB, variantB)).toBe(5);
  });

  it("preço sempre lido AO VIVO da variante no momento do checkout, nunca um preço vindo do cliente (a RPC não aceita nenhum parâmetro de preço)", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Preco Vivo Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Prata" }], 100);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    await withSuperuser((c) => c.query("update public.product_variants set price = 250 where id = $1", [variantId]));

    const result = await callCreateOrder(fx.tenantA, cartId);
    const items = await orderItemsOf(result.rows[0]!.create_order_from_cart);
    expect(Number(items[0]!.unit_price)).toBe(250); // preço vivo no momento do checkout, não os 100 de quando foi adicionado

    // A assinatura da função é fixa (10 parâmetros, nenhum de preço) —
    // qualquer tentativa de "injetar" um preço extra falha por
    // incompatibilidade de assinatura, não por regra de negócio.
    const cartId2 = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const err = await expectPgError(
      asActor({ role: "anon" }, (c) =>
        c.query("select create_order_from_cart($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
          fx.tenantA,
          cartId2,
          "X",
          "x@example.com",
          "11999999999",
          JSON.stringify(address),
          "vexo_checkout",
          "gateway",
          null,
          null,
          1, // 11º parâmetro: "preço" hipotético — não existe na assinatura
        ]),
      ),
    );
    expect(err.message).toMatch(/function.*does not exist/i);
  });

  it("cancelamento de pedido com variante: restaura exatamente a linha de estoque da variante comprada, nunca a de uma variante irmã", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Cancelamento Variante", 20);
    const variantX = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Verde" }], 30);
    const variantY = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Vinho" }], 30);
    await setInventory(fx.tenantA, productId, variantX, 10);
    await setInventory(fx.tenantA, productId, variantY, 10);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantX, 4);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    expect(await stockOf(productId, variantX)).toBe(6); // 10 - 4
    expect(await stockOf(productId, variantY)).toBe(10); // intacto

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);

    expect(await stockOf(productId, variantX)).toBe(10); // restaurado por completo
    expect(await stockOf(productId, variantY)).toBe(10); // continua intacto
  });

  it("variante excluída depois do pedido: variant_id vira NULL (ON DELETE SET NULL), mas variant_sku/variant_label/variant_options do snapshot sobrevivem — e cancelar NÃO restaura estoque em nenhuma linha (a linha de inventory da variante também foi excluída em cascata)", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Variante Excluida", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Laranja" }], 35, {
      sku: "LAR-01",
    });
    await setInventory(fx.tenantA, productId, variantId, 8);
    // Uma linha de estoque de PRODUTO SIMPLES também existe para este
    // produto (cenário deliberado: se a restauração não filtrasse
    // corretamente, ela acabaria recebendo o estoque da variante excluída).
    // Como este produto TEM variante, uma linha "simples" não pode
    // coexistir de verdade (produto com variante sempre exige variant_id
    // no cart_items) — o ponto deste teste é garantir que, mesmo sem
    // nenhuma linha candidata, nada é somado incorretamente em lugar nenhum.

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 2);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;
    expect(await stockOf(productId, variantId)).toBe(6); // 8 - 2

    // Exclui a variante — product_inventory.variant_id é ON DELETE
    // CASCADE (D20.3): a linha de estoque da variante desaparece junto.
    await withSuperuser((c) => c.query("delete from public.product_variants where id = $1", [variantId]));

    const items = await orderItemsOf(orderId);
    expect(items[0]!.variant_id).toBeNull(); // SET NULL
    expect(items[0]!.variant_sku).toBe("LAR-01"); // snapshot sobrevive
    expect(items[0]!.variant_label).toBe("Laranja"); // snapshot sobrevive
    expect(items[0]!.variant_options).toEqual([{ option: "Cor", value: "Laranja" }]); // snapshot sobrevive

    const invGone = await withSuperuser((c) => c.query("select 1 from public.product_inventory where product_id = $1", [productId]));
    expect(invGone.rows).toHaveLength(0); // a própria linha de estoque também sumiu (cascade)

    await cancelOrder(fx.tenantA, orderId, fx.userAOwner);
    // Comportamento conservador: nada para restaurar, nenhuma linha nova
    // criada, nenhum estoque "inventado" em lugar nenhum.
    const invAfterCancel = await withSuperuser((c) => c.query("select 1 from public.product_inventory where product_id = $1", [productId]));
    expect(invAfterCancel.rows).toHaveLength(0);
  });

  it("preservação do snapshot: alterar preço/sku/valor de opção do catálogo DEPOIS da compra nunca muda o pedido já criado", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Snapshot Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Ciano" }], 60, {
      sku: "CIA-ORIGINAL",
    });

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    await withSuperuser(async (c) => {
      await c.query("update public.product_variants set price = 999, sku = 'MUDOU' where id = $1", [variantId]);
      await c.query(
        "update public.product_option_values set value = 'Nome Totalmente Diferente' where product_option_id = (select id from public.product_options where product_id = $1)",
        [productId],
      );
    });

    const items = await orderItemsOf(orderId);
    expect(Number(items[0]!.unit_price)).toBe(60);
    expect(items[0]!.variant_sku).toBe("CIA-ORIGINAL");
    expect(items[0]!.variant_label).toBe("Ciano");
    expect(items[0]!.variant_options).toEqual([{ option: "Cor", value: "Ciano" }]);
  });

  it("get_order_confirmation expõe variantId/variantSku/variantLabel/variantOptions para o cliente (anon), null para item simples", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Confirmacao Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Bege" }], 40, {
      sku: "BEG-01",
    });

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const result = await callCreateOrder(fx.tenantA, cartId);
    const orderId = result.rows[0]!.create_order_from_cart;

    const confirmation = await asActor({ role: "anon" }, (c) =>
      c.query<{ get_order_confirmation: Record<string, unknown> }>("select get_order_confirmation($1, $2)", [fx.tenantA, orderId]),
    );
    const items = confirmation.rows[0]!.get_order_confirmation.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      variantId,
      variantSku: "BEG-01",
      variantLabel: "Bege",
      variantOptions: [{ option: "Cor", value: "Bege" }],
    });
  });

  // ---------------------------------------------------------------------
  // CONCURRENCY
  // ---------------------------------------------------------------------

  it("concorrência real: dois checkouts simultâneos para a MESMA variante com estoque = 1 — exatamente um sucede, o outro falha com estoque insuficiente, nunca negativo, e a variante IRMÃ (estoque próprio) não é afetada", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Concorrencia Variante", 20);
    const variantLimited = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Dourado" }], 30);
    const variantSibling = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Prateado" }], 30);
    await setInventory(fx.tenantA, productId, variantLimited, 1);
    await setInventory(fx.tenantA, productId, variantSibling, 5);

    const cartX = await createCartWithVariantItem(fx.tenantA, productId, variantLimited, 1);
    const cartY = await createCartWithVariantItem(fx.tenantA, productId, variantLimited, 1);

    const results = await Promise.allSettled([callCreateOrder(fx.tenantA, cartX), callCreateOrder(fx.tenantA, cartY)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/insufficient stock/i);

    expect(await stockOf(productId, variantLimited)).toBe(0);
    expect(await stockOf(productId, variantSibling)).toBe(5); // nunca tocada — prova direta da correção do bug §B.1
  });

  it("compras simultâneas de VARIANTES DISTINTAS do mesmo produto, em ordem cruzada entre dois carrinhos: sem deadlock, sem overselling, estoque final correto para cada uma", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto M1 Variantes", 20);
    const variantP = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "P-Cor" }], 30);
    const variantQ = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Q-Cor" }], 30);
    await setInventory(fx.tenantA, productId, variantP, 5);
    await setInventory(fx.tenantA, productId, variantQ, 5);

    const cartX = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartX, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cartX,
        fx.tenantA,
        productId,
        variantP,
      ]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cartX,
        fx.tenantA,
        productId,
        variantQ,
      ]),
      { commit: true },
    );

    const cartY = randomUUID();
    await asActor({ role: "anon" }, (c) => c.query("insert into public.carts (id, tenant_id) values ($1, $2)", [cartY, fx.tenantA]), {
      commit: true,
    });
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cartY,
        fx.tenantA,
        productId,
        variantQ,
      ]),
      { commit: true },
    );
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cartY,
        fx.tenantA,
        productId,
        variantP,
      ]),
      { commit: true },
    );

    const results = await Promise.allSettled([callCreateOrder(fx.tenantA, cartX), callCreateOrder(fx.tenantA, cartY)]);
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as Error).message).not.toMatch(/deadlock|40P01/i);
      }
    }
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await stockOf(productId, variantP)).toBe(3); // 5 - 1 - 1
    expect(await stockOf(productId, variantQ)).toBe(3); // 5 - 1 - 1
  });

  it("cancelamentos concorrentes de dois pedidos diferentes compartilhando as mesmas variantes: sem deadlock, cada estoque restaurado corretamente", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Cancel Concorrente Variante", 20);
    const variantR = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "R-Cor" }], 30);
    const variantS = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "S-Cor" }], 30);
    await setInventory(fx.tenantA, productId, variantR, 10);
    await setInventory(fx.tenantA, productId, variantS, 10);

    const cart1 = await createCartWithVariantItem(fx.tenantA, productId, variantR, 2);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cart1,
        fx.tenantA,
        productId,
        variantS,
      ]),
      { commit: true },
    );
    const cart2 = await createCartWithVariantItem(fx.tenantA, productId, variantS, 3);
    await asActor(
      { role: "anon" },
      (c) => c.query("insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, 1)", [
        cart2,
        fx.tenantA,
        productId,
        variantR,
      ]),
      { commit: true },
    );

    const order1 = (await callCreateOrder(fx.tenantA, cart1)).rows[0]!.create_order_from_cart;
    const order2 = (await callCreateOrder(fx.tenantA, cart2)).rows[0]!.create_order_from_cart;

    const results = await Promise.allSettled([
      cancelOrder(fx.tenantA, order1, fx.userAOwner),
      cancelOrder(fx.tenantA, order2, fx.userAOwner),
    ]);
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
      if (r.status === "rejected") expect((r.reason as Error).message).not.toMatch(/deadlock|40P01/i);
    }

    expect(await stockOf(productId, variantR)).toBe(10); // 10 -2 -1 +2 +1
    expect(await stockOf(productId, variantS)).toBe(10); // 10 -1 -3 +1 +3
  });

  it("retry/dupla submissão do mesmo carrinho com variante: nunca cria um segundo pedido", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Retry Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Retry" }], 30);
    await setInventory(fx.tenantA, productId, variantId, 5);

    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const first = await callCreateOrder(fx.tenantA, cartId);
    expect(first.rows[0]!.create_order_from_cart).toBeTruthy();

    const err = await expectPgError(callCreateOrder(fx.tenantA, cartId));
    expect(err.message).toMatch(/cart is empty/i);
    expect(await stockOf(productId, variantId)).toBe(4); // decrementado uma única vez
  });

  // ---------------------------------------------------------------------
  // SECURITY
  // ---------------------------------------------------------------------

  it("SECURITY DEFINER/search_path/grants das 3 funções continuam exatamente como antes de D20.5", async () => {
    const rows = await withSuperuser((c) =>
      c.query<{ proname: string; prosecdef: boolean; search_path: string | null }>(
        `select p.proname, p.prosecdef,
                (select option_value from unnest(p.proconfig) as option_value where option_value like 'search_path=%') as search_path
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('create_order_from_cart', 'update_order_status', 'get_order_confirmation')`,
      ),
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.search_path).toBe('search_path=""');
    }
  });

  it("create_order_from_cart/get_order_confirmation continuam anon-only, update_order_status continua authenticated-only — nenhum grant novo foi aberto por D20.5", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto Grants Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "Grant" }], 30);
    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);

    const errAuth = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
        c.query("select create_order_from_cart($1, $2, $3, $4, $5, $6)", [
          fx.tenantA,
          cartId,
          "X",
          "x@example.com",
          "11999999999",
          JSON.stringify(address),
        ]),
      ),
    );
    expect(errAuth.message).toMatch(/permission denied/i);

    const order = await withSuperuser(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.orders (tenant_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, total, status)
         values ($1, $2, 'X', 'x@example.com', '11999999999', $3, 10, 10, 'PENDING') returning id`,
        [fx.tenantA, `PED-GRANT-${runId}`, address],
      );
      return rows[0]!.id;
    });
    for (const actor of [{ role: "anon" as const }, { role: "service_role" as const }]) {
      const err = await expectPgError(
        asActor(actor, (c) => c.query("select update_order_status($1, $2, 'CANCELLED', null)", [fx.tenantA, order])),
      );
      expect(err.message).toMatch(/permission denied/i);
    }
  });

  it("RLS: order_items com colunas de variante continuam invisíveis para anon e para staff de outro tenant", async () => {
    const productId = await insertProduct(fx.tenantA, "Produto RLS Variante", 20);
    const variantId = await insertVariant(fx.tenantA, productId, [{ optionName: "Cor", position: 0, value: "RLS" }], 30);
    const cartId = await createCartWithVariantItem(fx.tenantA, productId, variantId, 1);
    const orderId = (await callCreateOrder(fx.tenantA, cartId)).rows[0]!.create_order_from_cart;

    const asAnon = await asActor({ role: "anon" }, (c) => c.query("select 1 from public.order_items where order_id = $1", [orderId]));
    expect(asAnon.rows).toHaveLength(0);

    const asTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.order_items where order_id = $1", [orderId]),
    );
    expect(asTenantB.rows).toHaveLength(0);

    const asTenantA = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select variant_id, variant_label from public.order_items where order_id = $1", [orderId]),
    );
    expect(asTenantA.rows).toHaveLength(1);
    expect(asTenantA.rows[0]?.variant_label).toBe("RLS");
  });
});
