import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const isolated = process.env.E2E_ISOLATED_SUPABASE === "1";
const slug = process.env.E2E_STOREFRONT_SLUG;
const otherSlug = process.env.E2E_OTHER_STOREFRONT_SLUG;

async function query(sql: string, values: unknown[] = []) {
  if (!isolated || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
    throw new Error("Browser database assertions require the disposable loopback stack.");
  }
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    return await database.query(sql, values);
  } finally {
    await database.end();
  }
}

async function addProduct(page: Page, product = "principal") {
  await page.goto(`/loja/${slug}/produto/${product}`);
  await page.getByRole("button", { name: /adicionar ao carrinho/i }).click();
  await expect(page.getByRole("status").filter({ hasText: /adicionado ao carrinho/i })).toBeVisible();
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

test.describe("comércio com Supabase descartável", () => {
  test.skip(!isolated, "Executado somente pelo runner Supabase local, sem produção ou gateways externos.");

  test("mantém itens, quantidades e totais após reload e navegação", async ({ page }) => {
    const errors = collectErrors(page);
    await addProduct(page);
    await addProduct(page, "adicional");
    await page.goto(`/loja/${slug}/carrinho`);
    await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
    const nameWidth = await page.getByText("Produto E2E principal", { exact: true }).evaluate((element) => ({
      content: element.scrollWidth, available: element.clientWidth,
    }));
    expect(nameWidth.content).toBeLessThanOrEqual(nameWidth.available);
    await expect(page.getByText("Produto E2E adicional", { exact: true })).toBeVisible();
    await expect(page.getByText(/R\$\s*135,00/)).toBeVisible();

    await page.getByRole("button", { name: "Aumentar quantidade" }).first().click();
    await expect(page.getByText(/R\$\s*235,00/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/R\$\s*235,00/)).toBeVisible();
    await page.getByRole("link", { name: "Continuar comprando", exact: true }).click();
    await page.goto(`/loja/${slug}/carrinho`);
    await expect(page.getByText(/R\$\s*235,00/)).toBeVisible();

    await page.getByRole("button", { name: "Remover", exact: true }).last().click();
    await expect(page.getByText("Produto E2E adicional", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/R\$\s*200,00/).first()).toBeVisible();
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
    expect(errors).toEqual([]);
  });

  test("recusa segredo alterado e cookie reaproveitado em outra loja", async ({ page, browser }) => {
    await addProduct(page);
    const cookie = (await page.context().cookies()).find((value) => value.name === `vexo_cart_${slug}`)!;
    const [version, cartId, token] = cookie.value.split(".");
    if (!cartId || !token) throw new Error("The browser did not receive valid cart credentials.");
    const persisted = await query("select owner_token_hash from public.carts where id = $1", [cartId]);
    expect(persisted.rows[0].owner_token_hash).toBe(createHash("sha256").update(token).digest("hex"));

    const attacker = await browser.newContext();
    try {
      await attacker.addCookies([{ ...cookie, value: `${version}.${cartId}.${randomBytes(32).toString("base64url")}` }]);
      const visitor = await attacker.newPage();
      await visitor.goto(`http://127.0.0.1:3100/loja/${slug}/carrinho`);
      await expect(visitor.getByRole("heading", { name: /seu carrinho está vazio/i })).toBeVisible();
      await attacker.addCookies([{ ...cookie, name: `vexo_cart_${otherSlug}` }]);
      await visitor.goto(`http://127.0.0.1:3100/loja/${otherSlug}/carrinho`);
      await expect(visitor.getByRole("heading", { name: /seu carrinho está vazio/i })).toBeVisible();
    } finally {
      await attacker.close();
    }
    await page.goto(`/loja/${slug}/carrinho`);
    await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
  });

  test("cria pedido externo, baixa estoque uma vez e exibe o pedido ao lojista", async ({ page, browser }) => {
    const errors = collectErrors(page);
    await addProduct(page);
    const cookie = (await page.context().cookies()).find((value) => value.name === `vexo_cart_${slug}`)!;
    const cartId = cookie.value.split(".")[1];
    const customerEmail = `cliente-${cartId}@example.test`;
    const stockBefore = await query(
      "select i.stock_quantity from public.product_inventory i join public.cart_items c on c.product_id = i.product_id where c.cart_id = $1",
      [cartId],
    );
    // Only CEP autofill is simulated. Server Actions, Auth, cart, checkout,
    // inventory and merchant reads all use the real local Supabase stack.
    await page.route("**/api/address/cep?*", (route) => route.fulfill({ json: { status: "not_found" } }));
    await page.goto(`/loja/${slug}/checkout`);
    await page.getByRole("button", { name: "Continuar no WhatsApp", exact: true }).click();
    const customerName = page.getByLabel("Nome completo", { exact: true });
    await expect(customerName).toBeFocused();
    expect(await customerName.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    expect((await query("select checkout_order_id from public.carts where id = $1", [cartId])).rows[0].checkout_order_id).toBeNull();
    await page.getByLabel("Nome completo", { exact: true }).fill("Cliente E2E Sintético");
    await page.getByLabel("E-mail", { exact: true }).fill(customerEmail);
    await page.getByLabel("Telefone / WhatsApp", { exact: true }).fill("11999999999");
    await page.getByLabel("CEP", { exact: true }).fill("01310100");
    await expect(page.getByRole("button", { name: "Continuar no WhatsApp", exact: true })).toBeEnabled();
    await page.getByLabel("Endereço", { exact: true }).fill("Rua de Teste");
    await page.getByLabel("Número", { exact: true }).fill("100");
    await page.getByLabel("Bairro", { exact: true }).fill("Centro");
    await page.getByLabel("Cidade", { exact: true }).fill("São Paulo");
    await page.getByLabel("Estado", { exact: true }).selectOption("SP");
    await expect(page.getByLabel("Complemento (opcional)")).not.toHaveAttribute("required", "");
    await page.locator('input[name="paymentPreference"][value="cash"]').check();
    await page.getByRole("button", { name: "Continuar no WhatsApp", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pedido criado com sucesso!" })).toBeVisible();
    const orderId = page.url().split("/").at(-1)!;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pedido criado com sucesso!" })).toBeVisible();

    const order = await query(
      `select o.id, o.total, o.payment_status, o.order_source, c.checkout_order_id,
              i.stock_quantity, (select count(*)::int from public.orders where customer_email = o.customer_email) as order_count
       from public.carts c join public.orders o on o.id = c.checkout_order_id
       join public.order_items oi on oi.order_id = o.id
       join public.product_inventory i on i.product_id = oi.product_id where c.id = $1`,
      [cartId],
    );
    expect(order.rows).toHaveLength(1);
    expect(order.rows[0]).toMatchObject({ id: orderId, total: "100.00", payment_status: "EXTERNAL", order_source: "whatsapp", checkout_order_id: orderId, order_count: 1 });
    expect(order.rows[0].stock_quantity).toBe(stockBefore.rows[0].stock_quantity - 1);

    const merchant = await browser.newContext();
    try {
      const panel = await merchant.newPage();
      const panelErrors = collectErrors(panel);
      await panel.goto("http://127.0.0.1:3100/login");
      await panel.getByLabel("E-mail", { exact: true }).fill(process.env.E2E_OWNER_EMAIL!);
      await panel.getByLabel("Senha", { exact: true }).fill(process.env.E2E_OWNER_PASSWORD!);
      await panel.getByRole("button", { name: "Entrar no VEXO", exact: true }).click();
      await expect(panel).toHaveURL(/\/painel$/);
      await panel.goto(`http://127.0.0.1:3100/painel/pedidos/${orderId}`);
      await expect(panel.getByText("Cliente E2E Sintético", { exact: true })).toBeVisible();
      expect(panelErrors).toEqual([]);
    } finally {
      await merchant.close();
    }
    expect(errors).toEqual([]);
  });
});
