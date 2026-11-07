import { expect, type Page, type TestInfo } from "@playwright/test";
import pg from "pg";
import { randomBytes } from "node:crypto";

export const slug = process.env.E2E_STOREFRONT_SLUG!;
export const otherSlug = process.env.E2E_OTHER_STOREFRONT_SLUG!;
export const unique = () => randomBytes(6).toString("hex");

export async function query(sql: string, values: unknown[] = [], actorId?: string) {
  if (process.env.E2E_ISOLATED_SUPABASE !== "1" || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Only disposable loopback SQL is permitted.");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actorId ? { sub: actorId, role: "authenticated" } : { role: "service_role" })]);
    if (actorId) await db.query("set local role authenticated");
    const result = await db.query(sql, values);
    await db.query("commit");
    return result;
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
export async function login(page: Page, email = process.env.E2E_OWNER_EMAIL!) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Entrar no VEXO", exact: true }).click();
  await expect(page).toHaveURL(/\/painel$/);
}
export async function imageFile(page: Page, format: "png" | "jpeg" | "webp" = "png", color = "#663399") {
  const base64 = await page.evaluate(({ format, color }) => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/" + format).split(",")[1]!;
  }, { format, color });
  return { name: "synthetic." + format, mimeType: "image/" + format, buffer: Buffer.from(base64, "base64") };
}
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => {
    if (response.status() >= 400 && new URL(response.url()).origin === "http://127.0.0.1:3100") errors.push("HTTP " + response.status() + " " + new URL(response.url()).pathname);
  });
  return errors;
}
export async function visual(page: Page, info: TestInfo, label: string) {
  await page.screenshot({ path: info.outputPath(label + ".png"), fullPage: true });
  // Only synthetic, authenticated loopback pages. A bounded viewport image
  // lets the reviewer inspect CI evidence through GitHub without local files.
  if (info.project.name === "mobile-360") {
    const bytes = await page.screenshot({ fullPage: false });
    console.log("VEXO_VISUAL:" + label + ":" + bytes.toString("base64"));
  }
}
export async function tenantId() {
  return (await query("select id from public.tenants where slug=$1", [slug])).rows[0].id as string;
}
export async function newProduct(page: Page, name = "Produto sintético " + unique()) {
  await page.goto("/painel/produtos/novo");
  await page.getByLabel("Nome do produto", { exact: true }).fill(name);
  await page.getByLabel("Preço de venda", { exact: true }).fill("95");
  await page.getByLabel("Quantidade em estoque", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page).toHaveURL(/\/painel\/produtos\/[a-f0-9-]+\/editar$/);
  return new URL(page.url()).pathname.split("/")[3]!;
}

export async function seedBuyerProduct(stock: number, variant = false) {
  const tid = await tenantId(); const suffix = unique(); const productSlug = "buyer-" + suffix;
  const product = (await query("insert into public.products(tenant_id,name,slug,price,status) values($1,$2,$3,120,'active') returning id", [tid, "Produto comprador " + suffix, productSlug])).rows[0].id as string;
  let variantId: string | null = null;
  if (variant) {
    const option = (await query("insert into public.product_options(tenant_id,product_id,name,position) values($1,$2,'Cor',0) returning id", [tid,product])).rows[0].id;
    const value = (await query("insert into public.product_option_values(tenant_id,product_option_id,value,position) values($1,$2,'Preto',0) returning id", [tid,option])).rows[0].id;
    variantId = (await query("insert into public.product_variants(tenant_id,product_id,sku,price,promotional_price,option_value_ids,is_active) values($1,$2,$3,120,90,array[$4]::uuid[],true) returning id", [tid,product,"SKU-"+suffix,value])).rows[0].id as string;
  }
  await query("insert into public.product_inventory(tenant_id,product_id,variant_id,stock_quantity) values($1,$2,$3,$4)",[tid,product,variantId,stock]);
  return { tenantId: tid, productId: product, productSlug, variantId, name: "Produto comprador " + suffix };
}
export async function addBuyerProduct(page: Page, productSlug: string, variant = false) {
  await page.goto("/loja/" + slug + "/produto/" + productSlug);
  if (variant) await page.getByRole("button", { name: "Preto", exact: true }).click();
  await page.getByRole("button", { name: /adicionar ao carrinho/i }).click();
  await expect(page.getByRole("status").filter({ hasText: /adicionado ao carrinho/i })).toBeVisible();
}
export async function fillCheckout(page: Page, email = "buyer-" + unique() + "@example.test") {
  await page.route("**/api/address/cep?*", route => route.fulfill({ json: { status: "not_found" } }));
  await page.goto("/loja/" + slug + "/checkout");
  await page.getByLabel("Nome completo", { exact: true }).fill("Cliente sintético " + email.split("@")[0]);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Telefone / WhatsApp", { exact: true }).fill("11999999999");
  await page.getByLabel("CEP", { exact: true }).fill("01310100");
  await expect(page.getByRole("button", { name: "Continuar no WhatsApp", exact: true })).toBeEnabled();
  await page.getByLabel("Endereço", { exact: true }).fill("Rua Sintética");
  await page.getByLabel("Número", { exact: true }).fill("10");
  await page.getByLabel("Bairro", { exact: true }).fill("Centro");
  await page.getByLabel("Cidade", { exact: true }).fill("São Paulo");
  await page.getByLabel("Estado", { exact: true }).selectOption("SP");
  await page.locator('input[name="paymentPreference"][value="cash"]').check();
  return email;
}
export function actionRequest(page: Page) {
  return page.waitForRequest(request => request.method() === "POST" && Boolean(request.headers()["next-action"]));
}
export async function replayAction(page: Page, request: import("@playwright/test").Request) {
  const headers = request.headers();
  return page.context().request.post(request.url(), {
    headers: { "next-action": headers["next-action"]!, "content-type": headers["content-type"]!, origin: "http://127.0.0.1:3100" },
    data: request.postDataBuffer()!, maxRedirects: 0,
  });
}
export async function lockedInventory(productId: string) {
  if (process.env.E2E_ISOLATED_SUPABASE !== "1" || !["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Only disposable inventory locks.");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect(); await db.query("begin");
  await db.query("select id from public.product_inventory where product_id=$1 for update", [productId]);
  return { release: async () => { await db.query("commit"); await db.end(); } };
}
