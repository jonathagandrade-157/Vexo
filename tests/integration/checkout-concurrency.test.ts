import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

/**
 * Concorrência real do checkout/estoque: cada comprador, lojista e "trava"
 * usa uma conexão PostgreSQL própria do pool (equivalente a instâncias
 * serverless distintas falando com o mesmo banco). Nenhum cenário depende
 * de botão desabilitado ou de ordem de chegada por sorte: uma conexão
 * extra segura a linha de estoque (SELECT ... FOR UPDATE), o teste espera
 * até TODAS as transações concorrentes estarem bloqueadas nela
 * (pg_blocking_pids) e só então libera — a disputa acontece de fato.
 */

const runId = randomUUID().slice(0, 8);
const ADDRESS = {
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

interface CheckoutResult {
  orderId: string;
  created: boolean;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Concorrência de checkout e estoque (conexões independentes)", { timeout: 30_000 }, () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);
      await client.query("update public.shipping_settings set enabled = false where tenant_id in ($1, $2)", [fx.tenantA, fx.tenantB]);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createProduct(stock: number | null, label: string): Promise<string> {
    return withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.products (tenant_id, name, slug, price, status)
         values ($1, $2, $3, 50, 'active') returning id`,
        [fx.tenantA, `Concorrência ${label}`, `concorrencia-${label}-${runId}-${randomUUID().slice(0, 6)}`],
      );
      if (stock !== null) {
        await client.query(
          "insert into public.product_inventory (tenant_id, product_id, stock_quantity) values ($1, $2, $3)",
          [fx.tenantA, rows[0]!.id, stock],
        );
      }
      return rows[0]!.id;
    });
  }

  async function createVariant(productId: string, value: string, stock: number): Promise<string> {
    return withSuperuser(async (client) => {
      const existing = await client.query<{ id: string }>(
        "select id from public.product_options where product_id = $1 and name = 'Cor'",
        [productId],
      );
      const optionId =
        existing.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            "insert into public.product_options (tenant_id, product_id, name, position) values ($1, $2, 'Cor', 0) returning id",
            [fx.tenantA, productId],
          )
        ).rows[0]!.id;
      const valueId = (
        await client.query<{ id: string }>(
          "insert into public.product_option_values (tenant_id, product_option_id, value, position) values ($1, $2, $3, 0) returning id",
          [fx.tenantA, optionId, value],
        )
      ).rows[0]!.id;
      const variantId = (
        await client.query<{ id: string }>(
          `insert into public.product_variants (tenant_id, product_id, price, option_value_ids, is_active)
           values ($1, $2, 60, array[$3::uuid], true) returning id`,
          [fx.tenantA, productId, valueId],
        )
      ).rows[0]!.id;
      await client.query(
        "insert into public.product_inventory (tenant_id, product_id, variant_id, stock_quantity) values ($1, $2, $3, $4)",
        [fx.tenantA, productId, variantId, stock],
      );
      return variantId;
    });
  }

  async function createCart(lines: Array<{ productId: string; variantId?: string; quantity: number }>) {
    const cartId = randomUUID();
    const ownerHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    await asActor(
      { role: "service_role" },
      async (client) => {
        await client.query("insert into public.carts (id, tenant_id, owner_token_hash) values ($1, $2, $3)", [cartId, fx.tenantA, ownerHash]);
        for (const line of lines) {
          await client.query(
            "insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity) values ($1, $2, $3, $4, $5)",
            [cartId, fx.tenantA, line.productId, line.variantId ?? null, line.quantity],
          );
        }
      },
      { commit: true },
    );
    return { cartId, ownerHash };
  }

  function checkoutSql(client: PoolClient, cart: { cartId: string; ownerHash: string }, email: string) {
    return client.query<{ result: CheckoutResult }>(
      `select public.checkout_cart_secure(
         $1::uuid, $2::uuid, $3::text, 'Cliente concorrente', $4::text, '+5511999999999',
         $5::jsonb, 'whatsapp', 'external', 'pix', null::numeric,
         'none', null::uuid, null::numeric, null::text, null::text, null::numeric, null::integer
       ) as result`,
      [fx.tenantA, cart.cartId, cart.ownerHash, email, JSON.stringify(ADDRESS)],
    );
  }

  async function checkout(cart: { cartId: string; ownerHash: string }, email: string, statementTimeoutMs?: number) {
    const { rows } = await asActor(
      { role: "service_role" },
      async (client) => {
        if (statementTimeoutMs) await client.query(`set local statement_timeout = ${Number(statementTimeoutMs)}`);
        return checkoutSql(client, cart, email);
      },
      { commit: true },
    );
    return rows[0]!.result;
  }

  async function stockOf(productId: string, variantId: string | null = null): Promise<number> {
    const { rows } = await withSuperuser((client) =>
      client.query<{ stock_quantity: number }>(
        "select stock_quantity from public.product_inventory where product_id = $1 and variant_id is not distinct from $2",
        [productId, variantId],
      ),
    );
    return rows[0]!.stock_quantity;
  }

  async function countOrderItems(productId: string, variantId: string | null = null): Promise<number> {
    const { rows } = await withSuperuser((client) =>
      client.query<{ total: number }>(
        "select count(*)::int as total from public.order_items where product_id = $1 and variant_id is not distinct from $2",
        [productId, variantId],
      ),
    );
    return rows[0]!.total;
  }

  /** Segura a(s) linha(s) de estoque numa conexão própria até `release()`. */
  async function holdInventory(productId: string) {
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select id from public.product_inventory where product_id = $1 for update", [productId]);
    const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
    return {
      pid: rows[0]!.pid,
      async release() {
        await holder.query("rollback").catch(() => {});
        holder.release();
      },
    };
  }

  /**
   * Espera até `expected` transações estarem paradas em lock de linha atrás
   * do detentor. Com vários esperando a mesma linha, só o primeiro aparece
   * bloqueado diretamente pelo detentor; os demais esperam o tuple lock do
   * primeiro — por isso conta a cadeia inteira, não só `pg_blocking_pids`
   * apontando para o detentor.
   */
  async function waitUntilBlocked(holderPid: number, expected: number) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await withSuperuser((client) =>
        client.query<{ total: number }>(
          `with recursive chain(pid) as (
             select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
             union
             select a.pid from pg_stat_activity a join chain c on c.pid = any(pg_blocking_pids(a.pid))
           )
           select count(distinct pid)::int as total from chain`,
          [holderPid],
        ),
      );
      if (rows[0]!.total >= expected) return;
      if (Date.now() > deadline) throw new Error(`only ${rows[0]!.total}/${expected} transactions reached the lock`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("cinco compradores simultâneos na última unidade: um pedido, estoque zero, quatro recusas sem resíduo", async () => {
    const productId = await createProduct(1, "ultima");
    const carts = await Promise.all(Array.from({ length: 5 }, () => createCart([{ productId, quantity: 1 }])));
    const lock = await holdInventory(productId);
    const attempts = carts.map((cart, index) =>
      checkout(cart, `ultima-${runId}-${index}@example.com`).then(
        (value) => ({ ok: true as const, value }),
        (error: Error) => ({ ok: false as const, error }),
      ),
    );
    try {
      await waitUntilBlocked(lock.pid, carts.length);
    } finally {
      await lock.release();
    }
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failures = results.filter((result) => !result.ok);
    expect(failures).toHaveLength(4);
    for (const failure of failures) expect(failure.error.message).toMatch(/insufficient stock/i);
    expect(await stockOf(productId)).toBe(0);
    expect(await countOrderItems(productId)).toBe(1);

    // Rollback dos perdedores: carrinho intacto, sem pedido apontado.
    const losers = carts.filter((_, index) => !results[index]!.ok).map((cart) => cart.cartId);
    const { rows } = await withSuperuser((client) =>
      client.query<{ items: number; linked: number }>(
        `select (select count(*)::int from public.cart_items where cart_id = any($1::uuid[])) as items,
                (select count(*)::int from public.carts where id = any($1::uuid[]) and checkout_order_id is not null) as linked`,
        [losers],
      ),
    );
    expect(rows[0]).toEqual({ items: 4, linked: 0 });
  });

  it("variantes do mesmo produto: estoque é por variante; a disputa na mesma variante nunca consome a outra", async () => {
    const productId = await createProduct(null, "variantes");
    const black = await createVariant(productId, `Preto ${runId}`, 1);
    const white = await createVariant(productId, `Branco ${runId}`, 1);
    const carts = await Promise.all([
      createCart([{ productId, variantId: black, quantity: 1 }]),
      createCart([{ productId, variantId: black, quantity: 1 }]),
      createCart([{ productId, variantId: white, quantity: 1 }]),
    ]);
    const lock = await holdInventory(productId);
    const attempts = carts.map((cart, index) =>
      checkout(cart, `variante-${runId}-${index}@example.com`).then(
        () => true,
        () => false,
      ),
    );
    try {
      await waitUntilBlocked(lock.pid, carts.length);
    } finally {
      await lock.release();
    }
    const outcome = await Promise.all(attempts);

    expect(outcome.slice(0, 2).filter(Boolean)).toHaveLength(1);
    expect(outcome[2]).toBe(true);
    expect(await stockOf(productId, black)).toBe(0);
    expect(await stockOf(productId, white)).toBe(0);
    expect(await countOrderItems(productId, black)).toBe(1);
    expect(await countOrderItems(productId, white)).toBe(1);
  });

  it("carrinho com duas variantes, uma sem estoque suficiente: rollback total, inclusive da variante que tinha estoque", async () => {
    const productId = await createProduct(null, "rollback-variantes");
    const enough = await createVariant(productId, `Azul ${runId}`, 5);
    const scarce = await createVariant(productId, `Verde ${runId}`, 1);
    const cart = await createCart([
      { productId, variantId: enough, quantity: 2 },
      { productId, variantId: scarce, quantity: 2 },
    ]);
    const error = await expectPgError(checkout(cart, `rollback-${runId}@example.com`));
    expect(error.message).toMatch(/insufficient stock/i);
    expect(await stockOf(productId, enough)).toBe(5);
    expect(await stockOf(productId, scarce)).toBe(1);
    expect(await countOrderItems(productId, enough)).toBe(0);
  });

  it("envio duplicado do mesmo carrinho em conexões distintas, liberado junto: um pedido, uma baixa", async () => {
    const productId = await createProduct(3, "duplo");
    const cart = await createCart([{ productId, quantity: 2 }]);
    const lock = await holdInventory(productId);
    const email = `duplo-${runId}@example.com`;
    // A primeira trava o carrinho e espera o estoque; a segunda espera o carrinho.
    const attempts = [checkout(cart, email), checkout(cart, email)];
    try {
      await waitUntilBlocked(lock.pid, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await lock.release();
    }
    const results = await Promise.all(attempts);
    expect(new Set(results.map((result) => result.orderId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await stockOf(productId)).toBe(1);
    expect(await countOrderItems(productId)).toBe(1);
  });

  it("reenvio após timeout: tentativa cancelada não deixa resíduo, reenvio cria um único pedido e repetições devolvem o mesmo", async () => {
    const productId = await createProduct(2, "timeout");
    const cart = await createCart([{ productId, quantity: 1 }]);
    const email = `timeout-${runId}@example.com`;
    const lock = await holdInventory(productId);
    try {
      const timedOut = await expectPgError(checkout(cart, email, 300));
      expect(timedOut.message).toMatch(/statement timeout|canceling statement/i);
    } finally {
      await lock.release();
    }
    expect(await stockOf(productId)).toBe(2);
    expect(await countOrderItems(productId)).toBe(0);

    const first = await checkout(cart, email);
    expect(first.created).toBe(true);
    // Resposta "perdida" depois do commit: o cliente reenvia duas vezes em paralelo.
    const replays = await Promise.all([checkout(cart, email), checkout(cart, email)]);
    expect(replays.every((replay) => replay.orderId === first.orderId && replay.created === false)).toBe(true);
    expect(await stockOf(productId)).toBe(1);
    expect(await countOrderItems(productId)).toBe(1);
  });

  async function cancelAs(orderId: string) {
    return asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (client) => client.query("select public.update_order_status($1, $2, 'CANCELLED', 'teste de concorrência')", [fx.tenantA, orderId]),
      { commit: true },
    );
  }

  it("cancelamentos simultâneos e repetidos do mesmo pedido devolvem o estoque exatamente uma vez", async () => {
    const productId = await createProduct(5, "cancelamento");
    const variantProduct = await createProduct(null, "cancelamento-variante");
    const variantId = await createVariant(variantProduct, `Cinza ${runId}`, 4);
    const cart = await createCart([
      { productId, quantity: 3 },
      { productId: variantProduct, variantId, quantity: 2 },
    ]);
    const { orderId } = await checkout(cart, `cancelamento-${runId}@example.com`);
    expect(await stockOf(productId)).toBe(2);
    expect(await stockOf(variantProduct, variantId)).toBe(2);

    // Duas sessões do lojista cancelando ao mesmo tempo, com a linha do pedido travada até ambas chegarem.
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select id from public.orders where id = $1 for update", [orderId]);
    const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const attempts = [cancelAs(orderId), cancelAs(orderId)].map((attempt) =>
      attempt.then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, error }),
      ),
    );
    try {
      await waitUntilBlocked(holderPid, 2);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    expect(loser && !loser.ok ? loser.error.message : "").toMatch(/changed concurrently|invalid order status transition/i);

    // Repetição sequencial depois de cancelado: recusada e sem nova devolução.
    const repeated = await expectPgError(cancelAs(orderId));
    expect(repeated.message).toMatch(/invalid order status transition/i);

    expect(await stockOf(productId)).toBe(5);
    expect(await stockOf(variantProduct, variantId)).toBe(4);
    const { rows } = await withSuperuser((client) =>
      client.query<{ status: string }>("select status from public.orders where id = $1", [orderId]),
    );
    expect(rows[0]!.status).toBe("CANCELLED");
  });

  it("estoque devolvido por cancelamento concorrente com nova compra nunca fica negativo nem duplicado", async () => {
    const productId = await createProduct(1, "cancela-compra");
    const firstCart = await createCart([{ productId, quantity: 1 }]);
    const { orderId } = await checkout(firstCart, `cancela-compra-a-${runId}@example.com`);
    expect(await stockOf(productId)).toBe(0);

    const nextCart = await createCart([{ productId, quantity: 1 }]);
    const lock = await holdInventory(productId);
    const cancel = cancelAs(orderId).then(() => true, () => false);
    let purchasedWhileCancelPending: boolean;
    try {
      await waitUntilBlocked(lock.pid, 1);
      // Com o cancelamento ainda pendente, a unidade não existe: a compra é
      // recusada de imediato (o UPDATE condicional não encontra linha com
      // estoque suficiente) em vez de "contar" com uma devolução não confirmada.
      purchasedWhileCancelPending = await checkout(nextCart, `cancela-compra-b-${runId}@example.com`).then(() => true, () => false);
    } finally {
      await lock.release();
    }
    expect(purchasedWhileCancelPending).toBe(false);
    expect(await cancel).toBe(true);
    expect(await stockOf(productId)).toBe(1);

    // Depois da devolução confirmada, a mesma unidade é vendida uma única vez.
    const retry = await checkout(nextCart, `cancela-compra-b-${runId}@example.com`);
    expect(retry.created).toBe(true);
    const thirdCart = await createCart([{ productId, quantity: 1 }]);
    await expect(checkout(thirdCart, `cancela-compra-c-${runId}@example.com`)).rejects.toThrow(/insufficient stock/i);
    expect(await stockOf(productId)).toBe(0);
    expect(await countOrderItems(productId)).toBe(2);
  });
});
