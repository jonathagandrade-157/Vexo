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
  page.on("pageerror", (error) => errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${new URL(page.url()).pathname}: ${message.text()}`); });
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

  test("abre as páginas do lojista sem falhas de console, HTTP ou overflow", async ({ page, isMobile }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.getByLabel("E-mail", { exact: true }).fill(process.env.E2E_OWNER_EMAIL!);
    await page.getByLabel("Senha", { exact: true }).fill(process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("button", { name: "Entrar no VEXO", exact: true }).click();
    await expect(page).toHaveURL(/\/painel$/);

    const paths = [
      "/painel", "/painel/pedidos", "/painel/produtos", "/painel/categorias", "/painel/clientes",
      "/painel/aparencia", "/painel/equipe", "/painel/historico", "/painel/configuracoes",
      "/painel/configuracoes/pedidos", "/painel/configuracoes/pagamentos", "/painel/configuracoes/entrega",
      "/painel/configuracoes/dominio", "/painel/assinatura", "/painel/suporte", "/painel/marketing", "/painel/vexo-ai",
    ];
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      // Explicitly blocked/coming-soon modules use their own readable
      // state heading. They are not implemented features under this test.
      await expect(page.locator("main").getByRole("heading").first(), path).toBeVisible();
      const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.scroll, `Overflow horizontal em ${path}`).toBeLessThanOrEqual(size.width);
    }
    await page.goto("/painel/configuracoes");
    // Logout must own a separate form: nesting it in the profile form
    // makes the browser repair the HTML and breaks React hydration.
    const settingsLogout = page.locator("main").getByRole("button", { name: /sair da conta/i, includeHidden: true });
    expect(await settingsLogout.evaluate((button) => button.closest("form")?.querySelector('[name="storeName"]') === null)).toBe(true);
    const logout = isMobile ? settingsLogout : page.getByRole("button", { name: /logout/i });
    await logout.click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test("valida e persiste perfil e endereço da loja sem enviar o formulário de saída", async ({ page }) => {
    const errors = collectErrors(page);
    const original = (await query("select name, address_zip, address_street, address_number, address_neighborhood, address_city, address_state from public.tenants where slug = $1", [slug])).rows[0];
    await page.goto("/login");
    await page.getByLabel("E-mail", { exact: true }).fill(process.env.E2E_OWNER_EMAIL!);
    await page.getByLabel("Senha", { exact: true }).fill(process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole("button", { name: "Entrar no VEXO", exact: true }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto("/painel/configuracoes");

    await page.getByLabel("Nome da loja", { exact: true }).fill("");
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByText("Informe o nome da loja", { exact: true })).toBeVisible();
    expect((await query("select name from public.tenants where slug = $1", [slug])).rows[0].name).toBe(original.name);

    await page.getByLabel("Nome da loja", { exact: true }).fill("Loja E2E Editada");
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Alterações salvas." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Nome da loja", { exact: true })).toHaveValue("Loja E2E Editada");
    expect((await query("select name from public.tenants where slug = $1", [slug])).rows[0].name).toBe("Loja E2E Editada");

    await page.getByLabel("CEP", { exact: true }).fill("01310-100");
    await page.getByLabel("Logradouro", { exact: true }).fill("Rua de Teste");
    await page.getByLabel("Número", { exact: true }).fill("100");
    await page.getByLabel("Bairro", { exact: true }).fill("Centro");
    await page.getByLabel("Cidade", { exact: true }).fill("São Paulo");
    await page.getByLabel("Estado", { exact: true }).selectOption("SP");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Endereço salvo.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("01310-100");
    await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue("São Paulo");
    expect((await query("select address_zip, address_city, address_state from public.tenants where slug = $1", [slug])).rows[0])
      .toEqual({ address_zip: "01310100", address_city: "São Paulo", address_state: "SP" });

    // Restore through the same UI even though this database is disposable.
    await page.getByLabel("Nome da loja", { exact: true }).fill(original.name);
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Alterações salvas." })).toBeVisible();
    for (const [label, column] of [["CEP", "address_zip"], ["Logradouro", "address_street"], ["Número", "address_number"], ["Bairro", "address_neighborhood"], ["Cidade", "address_city"]] as const) {
      await page.getByLabel(label, { exact: true }).fill(original[column] ?? "");
    }
    await page.getByLabel("Estado", { exact: true }).selectOption(original.address_state ?? "");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Endereço salvo.", { exact: true })).toBeVisible();
    expect((await query("select name, address_zip, address_street, address_number, address_neighborhood, address_city, address_state from public.tenants where slug = $1", [slug])).rows[0]).toEqual(original);
    expect(errors).toEqual([]);
  });

  test("cadastra um lojista sintético, retoma o onboarding e publica a loja local", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const suffix = randomBytes(6).toString("hex");
    const storeName = `Loja E2E Cadastro ${suffix}`;
    const email = `cadastro-${suffix}@example.test`;
    // Random checksum-valid fixture, never submitted outside loopback.
    const digits = Array.from(randomBytes(9), (value) => value % 10);
    for (const length of [9, 10]) {
      const remainder = digits.reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) % 11;
      digits.push(remainder < 2 ? 0 : 11 - remainder);
    }
    const document = digits.join("");
    const password = `Cadastro-local-${suffix}-A9!`;
    await page.goto("/cadastro");
    await page.getByLabel("Nome da loja", { exact: true }).fill(storeName);
    await page.getByLabel("Nome completo", { exact: true }).fill("Lojista E2E Sintético");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Telefone", { exact: true }).fill("11999999999");
    await page.getByLabel("CPF / CNPJ", { exact: true }).fill(document);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByLabel("Confirmar senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Começar teste grátis", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("É necessário aceitar os termos para continuar.");
    expect((await query("select count(*)::int as total from auth.users where email = $1", [email])).rows[0].total).toBe(0);
    await page.locator('input[name="acceptTerms"]').check();
    await page.getByLabel("Confirmar senha", { exact: true }).fill("Senha-diferente-A9!");
    await page.getByRole("button", { name: "Começar teste grátis", exact: true }).click();
    await expect(page.getByText("As senhas não coincidem", { exact: true })).toBeVisible();
    expect((await query("select count(*)::int as total from auth.users where email = $1", [email])).rows[0].total).toBe(0);
    await page.getByLabel("Confirmar senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Começar teste grátis", exact: true }).click();
    await expect(page).toHaveURL(/\/trial\/sucesso\?tenant=/);
    await expect(page.getByRole("heading", { name: /seu teste grátis começou/i })).toBeVisible();
    const tenantId = new URL(page.url()).searchParams.get("tenant")!;
    const signup = (await query(
      `select p.cpf_hash, t.slug, t.onboarding_completed_at,
              (select count(*)::int from public.trial_records tr where tr.tenant_id = t.id) as trials,
              (select count(*)::int from public.tenant_members tm join public.roles r on r.id = tm.role_id where tm.tenant_id = t.id and tm.user_id = u.id and r.key = 'OWNER') as owners
       from auth.users u join public.profiles p on p.id = u.id join public.tenants t on t.created_by = u.id where u.email = $1 and t.id = $2`,
      [email, tenantId],
    )).rows[0];
    expect(signup).toMatchObject({ trials: 1, owners: 1, onboarding_completed_at: null });
    expect(signup.cpf_hash).not.toBe(document);
    expect(signup.cpf_hash).toMatch(/^[a-f0-9]{64}$/);
    await page.getByRole("link", { name: /configurar minha loja/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/segmento$/);
    await page.getByRole("button", { name: /continuar/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/seu-negocio$/);
    // Required steps cannot be bypassed by typing the publish URL.
    await page.goto("/onboarding/publicar");
    await expect(page).toHaveURL(/\/onboarding\/seu-negocio$/);
    await page.getByLabel("Segmento", { exact: true }).selectOption("apparel");
    await page.getByLabel("Instagram", { exact: true }).fill("loja_e2e");
    await page.getByLabel("WhatsApp", { exact: true }).fill("11999999999");
    await page.getByLabel("E-mail comercial", { exact: true }).fill(email);
    await page.getByRole("button", { name: /salvar e continuar/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/revisar$/);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/onboarding\/revisar$/);
    await page.getByRole("button", { name: /continuar/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/publicar$/);
    await page.getByRole("button", { name: /publicar loja/i }).click();
    await expect(page).toHaveURL(/\/painel$/);
    const completion = (await query("select onboarding_completed_at from public.tenants where id = $1", [tenantId])).rows[0];
    expect(completion.onboarding_completed_at).not.toBeNull();
    const response = await page.goto(`/loja/${signup.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(storeName, { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
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

      // This is a disposable cash order, not a gateway charge or a real
      // receipt. Exercise the merchant's real status/audit workflow.
      await panel.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
      const dialog = panel.locator("dialog[open]");
      await dialog.getByLabel("Motivo/observação", { exact: true }).fill("Validação sintética de CI; nenhum recebimento real.");
      await dialog.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
      await expect(panel.getByText("Pagamento confirmado.", { exact: true })).toBeVisible();
      await panel.getByLabel("Novo status", { exact: true }).selectOption("PREPARING");
      await panel.getByLabel("Nota interna (opcional)", { exact: true }).fill("Pedido sintético em preparação.");
      await panel.getByRole("button", { name: "Avançar status", exact: true }).click();
      await expect(panel.getByText("Em preparação", { exact: true }).first()).toBeVisible();
      await panel.reload();
      await expect(panel.getByText("Em preparação", { exact: true }).first()).toBeVisible();

      const finalOrder = await query(
        `select o.status, o.payment_status, i.stock_quantity,
                (select count(*)::int from public.audit_logs where resource_id = o.id::text and action = 'ORDER_PAYMENT_CONFIRMED') as confirmations,
                (select count(*)::int from public.audit_logs where resource_id = o.id::text and action = 'ORDER_STATUS_CHANGED') as transitions
         from public.orders o join public.order_items oi on oi.order_id = o.id
         join public.product_inventory i on i.product_id = oi.product_id where o.id = $1`,
        [orderId],
      );
      expect(finalOrder.rows[0]).toMatchObject({ status: "PREPARING", payment_status: "APPROVED", confirmations: 1 });
      expect(finalOrder.rows[0].transitions).toBeGreaterThanOrEqual(1);
      expect(finalOrder.rows[0].stock_quantity).toBe(stockBefore.rows[0].stock_quantity - 1);
      expect(panelErrors).toEqual([]);
    } finally {
      await merchant.close();
    }
    expect(errors).toEqual([]);
  });
});
