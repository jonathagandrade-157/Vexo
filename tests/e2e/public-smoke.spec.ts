import { expect, test } from "@playwright/test";

test.describe("jornada pública essencial", () => {
  test("landing apresenta o produto e leva para login e cadastro", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sua loja online");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Começar", exact: true })).toBeVisible();

    await header.getByRole("link", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: /Bem-vindo de volta/ })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();

    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Começar", exact: true }).click();
    await expect(page).toHaveURL(/\/cadastro$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Crie sua conta" })).toBeVisible();
    await expect(page.getByLabel("Nome da loja")).toBeVisible();
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Termos de Uso" })).toHaveAttribute("href", "/termos");
    await expect(page.getByRole("link", { name: "Política de Privacidade" })).toHaveAttribute(
      "href",
      "/privacidade",
    );
  });

  test("preferência de tema é aplicada e persistida", async ({ page }, testInfo) => {
    await page.goto("/");

    const isMobile = testInfo.project.name === "mobile-chromium";
    await page
      .getByRole("button", { name: isMobile ? /alternar para claro/i : "Usar tema claro" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page
      .getByRole("button", { name: isMobile ? /alternar para escuro/i : "Usar tema escuro" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("metadados públicos não expõem rotas privadas para indexação", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBeTruthy();
    const robotsText = await robots.text();
    expect(robotsText).toContain("Disallow: /painel/");
    expect(robotsText).toContain("Disallow: /master/");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBeTruthy();
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain("<loc>");
    expect(sitemapText).toContain("/termos");
    expect(sitemapText).toContain("/privacidade");

    const terms = await request.get("/termos");
    expect(terms.ok()).toBeTruthy();
    expect(await terms.text()).toContain("Termos de Uso");

    const privacy = await request.get("/privacidade");
    expect(privacy.ok()).toBeTruthy();
    expect(await privacy.text()).toContain("Política de Privacidade");

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBeTruthy();
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");

    const icon = await request.get("/icon");
    expect(icon.ok()).toBeTruthy();
    expect(icon.headers()["content-type"]).toContain("image/png");

    const openGraphImage = await request.get("/opengraph-image");
    expect(openGraphImage.ok()).toBeTruthy();
    expect(openGraphImage.headers()["content-type"]).toContain("image/png");
  });
});
