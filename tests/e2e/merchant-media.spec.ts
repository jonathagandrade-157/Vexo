import { expect, test } from "@playwright/test";
import { imageFile, login, newProduct, query, slug, tenantId, unique, visual, watchErrors } from "./local-commerce";

test.describe("mídia e aparência com Storage real isolado", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1", "Only disposable loopback services.");
  test("cria, edita, ordena, desativa e remove banners com persistência", async ({ page }, info) => {
    const errors = watchErrors(page); await login(page); await page.goto("/painel/aparencia");
    const tid = await tenantId(); const prefix = "Banner " + unique();
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Banners", exact: true }) });
    for (const suffix of ["A", "B"]) {
      await section.getByRole("button", { name: /adicionar banner/i }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles(await imageFile(page, suffix === "A" ? "png" : "webp"));
      await dialog.getByLabel("Título (opcional)", { exact: true }).fill(prefix + suffix);
      await dialog.getByLabel("Link (opcional)", { exact: true }).fill("#promocoes");
      await dialog.getByRole("button", { name: "Criar banner", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(section.getByText(prefix + suffix, { exact: true })).toBeVisible();
    }
    await page.reload();
    const ids = await page.locator('dialog input[name="title"]').evaluateAll(inputs => inputs.map(input => input.id));
    expect(new Set(ids).size).toBe(ids.length);
    const banners = await query("select id,title,image_path from public.storefront_banners where tenant_id=$1 and title like $2 order by sort_order,created_at", [tid, prefix + "%"]);
    expect(banners.rows.map(row => row.title)).toEqual([prefix + "A", prefix + "B"]);
    const card = (title: string) => section.getByText(title, { exact: true }).locator("xpath=../..");
    await card(prefix + "B").getByRole("button", { name: "Mover para cima", exact: true }).click();
    await expect.poll(async () => (await query("select title from public.storefront_banners where tenant_id=$1 and title like $2 order by sort_order,created_at", [tid, prefix + "%"])).rows.map(row => row.title)).toEqual([prefix + "B", prefix + "A"]);
    await card(prefix + "A").getByTitle("Editar", { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Título (opcional)", { exact: true }).fill(prefix + " editado");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(card(prefix + " editado")).toBeVisible();
    await card(prefix + "B").getByRole("button", { name: "Desativar", exact: true }).click();
    await expect(card(prefix + "B").locator("span").filter({hasText:/^Inativo$/})).toBeVisible();
    await page.reload();
    await expect(card(prefix + "B").locator("span").filter({hasText:/^Inativo$/})).toBeVisible();
    await visual(page, info, "banners-persistidos");
    for (const title of [prefix + "B", prefix + " editado"]) {
      await card(title).getByTitle("Excluir", { exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();
      await expect(section.getByText(title, { exact: true })).toHaveCount(0);
    }
    expect((await query("select count(*)::int as total from public.storefront_banners where tenant_id=$1 and title like $2", [tid, prefix + "%"])).rows[0].total).toBe(0);
    expect((await query("select count(*)::int as total from storage.objects where bucket_id='tenant-media' and name=any($1::text[])", [banners.rows.map(row => row.image_path)])).rows[0].total).toBe(0);
    expect(errors).toEqual([]);
  });
  test("salva cores e modelo, confere a loja pública e restaura a aparência", async ({ page }, info) => {
    const errors = watchErrors(page); await login(page);
    const tid = await tenantId();
    const original = (await query("select primary_color,secondary_color,storefront_template from public.tenants where id=$1", [tid])).rows[0];
    await page.goto("/painel/aparencia");
    await page.getByLabel("Cor primária", { exact: true }).fill("#336699");
    await page.getByLabel("Cor secundária", { exact: true }).fill("#996633");
    await page.getByRole("button", { name: /VEXO Minimal/i }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Alterações salvas.");
    await page.reload();
    expect((await query("select primary_color,secondary_color,storefront_template from public.tenants where id=$1", [tid])).rows[0]).toEqual({ primary_color: "#336699", secondary_color: "#996633", storefront_template: "minimal" });
    await page.goto("/loja/" + slug);
    await expect(page.getByText("Loja E2E", { exact: true }).first()).toBeVisible();
    expect(await page.locator("[style]").evaluateAll(elements => elements.some(element => (element.getAttribute("style") ?? "").includes("#336699")))).toBe(true);
    await visual(page, info, "aparencia-publica");
    await page.goto("/painel/aparencia");
    await page.getByLabel("Cor primária", { exact: true }).fill(original.primary_color ?? "");
    await page.getByLabel("Cor secundária", { exact: true }).fill(original.secondary_color ?? "");
    await page.getByRole("button", { name: new RegExp("VEXO " + original.storefront_template, "i") }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Alterações salvas.");
    expect((await query("select primary_color,secondary_color,storefront_template from public.tenants where id=$1", [tid])).rows[0]).toEqual(original);
    expect(errors).toEqual([]);
  });
  test("envia e substitui logo nos formatos aceitos, recarrega e remove", async ({ page }, info) => {
    const errors = watchErrors(page); await login(page); await page.goto("/painel/aparencia");
    const tid = await tenantId();
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Identidade visual", exact: true }) });
    for (const format of ["png", "jpeg", "webp"] as const) {
      await section.locator('input[type="file"]').setInputFiles(await imageFile(page, format));
      await expect.poll(async () => (await query("select logo_url from public.tenants where id=$1", [tid])).rows[0].logo_url).toMatch(new RegExp("\\." + (format === "jpeg" ? "jpg" : format) + "$"));
      await page.reload();
      await expect(section.getByText("Substituir", { exact: true })).toBeVisible();
    }
    await visual(page, info, "logo-persistida");
    await section.getByRole("button", { name: "Remover", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remover", exact: true }).click();
    await expect(section.getByText("Enviar logo", { exact: true })).toBeVisible();
    await page.reload();
    expect((await query("select logo_url from public.tenants where id=$1", [tid])).rows[0].logo_url).toBeNull();
    expect(errors).toEqual([]);
  });
  test("galeria aceita os formatos, ordena, define principal e remove; rejeita arquivos grandes", async ({ page }, info) => {
    const errors = watchErrors(page); await login(page);
    const productId = await newProduct(page);
    const media = page.locator("section").filter({ has: page.getByRole("heading", { name: /Mídia/ }) });
    const images = () => query("select id,storage_path,sort_order from public.product_images where product_id=$1 order by sort_order", [productId]);
    let expected = 0;
    for (const format of ["png", "jpeg", "webp"] as const) {
      await media.getByLabel("Adicionar imagens", { exact: true }).setInputFiles(await imageFile(page, format));
      expected += 1;
      await expect.poll(async () => (await images()).rows.length).toBe(expected);
      await page.reload();
    }
    const rows = (await images()).rows;
    expect(rows.map(row => row.storage_path.split(".").at(-1))).toEqual(["png", "jpg", "webp"]);
    await media.getByRole("button", { name: "Definir como principal", exact: true }).last().click();
    await expect.poll(async () => (await images()).rows[0].id).toBe(rows[2].id);
    await page.reload();
    expect((await query("select main_image from public.products where id=$1", [productId])).rows[0].main_image).toBe(rows[2].storage_path);
    await media.getByRole("button", { name: "Mover para a direita", exact: true }).first().click();
    await expect.poll(async () => (await images()).rows[0].id).toBe(rows[0].id);
    const tooLarge = await imageFile(page); tooLarge.buffer = Buffer.concat([tooLarge.buffer, Buffer.alloc(5 * 1024 * 1024)]);
    await media.getByLabel("Adicionar imagens", { exact: true }).setInputFiles(tooLarge);
    await expect(media.getByRole("alert")).toContainText("5MB");
    expect((await images()).rows).toHaveLength(3);
    await page.reload(); await media.scrollIntoViewIfNeeded();
    await visual(page, info, "produto-galeria");
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      await media.getByTitle("Excluir", { exact: true }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();
      await expect.poll(async () => (await images()).rows.length).toBe(remaining - 1);
    }
    await page.reload();
    expect((await query("select main_image from public.products where id=$1", [productId])).rows[0].main_image).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.afterEach(async({page},info)=>{
  if(info.status!==info.expectedStatus && info.project.name==="mobile-360") {
    await visual(page,info,"falha-midia");
    console.log("VEXO_FAILED_PAGE:"+(await page.locator("body").innerText()).slice(0,4000));
  }
});
