import { expect, test, type Page } from "@playwright/test";

const storefrontSlug = process.env.E2E_STOREFRONT_SLUG;

function collectUnexpectedErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  return errors;
}

test.describe("vitrine pública", () => {
  test.skip(!storefrontSlug, "Defina E2E_STOREFRONT_SLUG para testar uma loja real.");

  test("carrega sem hidratação quebrada nem links internos inexistentes", async ({ page, request }) => {
    const errors = collectUnexpectedErrors(page);
    await page.goto(`/loja/${storefrontSlug}`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const internalHrefs = await page.locator("a[href]").evaluateAll((links) =>
      Array.from(
        new Set(
          links
            .map((link) => {
              const href = link.getAttribute("href");
              if (!href) return null;
              const url = new URL(href, document.baseURI);
              if (url.origin !== location.origin || url.hash) return null;
              return `${url.pathname}${url.search}`;
            })
            .filter((href): href is string => Boolean(href)),
        ),
      ),
    );

    for (const href of internalHrefs) {
      const response = await request.get(href);
      expect(response.status(), `Link interno inexistente: ${href}`).not.toBe(404);
    }

    const missingAnchors = await page.locator("a[href]").evaluateAll((links) =>
      links.flatMap((link) => {
        const href = link.getAttribute("href");
        if (!href) return [];
        const url = new URL(href, document.baseURI);
        if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return [];
        const targetId = decodeURIComponent(url.hash.slice(1));
        return document.getElementById(targetId) ? [] : [href];
      }),
    );
    expect(missingAnchors, "Âncoras internas sem destino na vitrine").toEqual([]);

    expect(errors, "Erros inesperados no console da vitrine").toEqual([]);
  });

  test("carrinho persiste e checkout mantém complemento opcional", async ({ page }) => {
    const errors = collectUnexpectedErrors(page);
    const cartPath = `/loja/${storefrontSlug}/carrinho`;

    try {
      await page.goto(`/loja/${storefrontSlug}`);

      const productHrefs = await page.locator(`a[href^="/loja/${storefrontSlug}/produto/"]`).evaluateAll((links) =>
        Array.from(new Set(links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)))),
      );
      expect(productHrefs.length).toBeGreaterThan(0);

      let added = false;
      for (const href of productHrefs) {
        await page.goto(href);
        const addButton = page.getByRole("button", { name: /adicionar ao carrinho/i });
        if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
          await addButton.click();
          const success = page.getByRole("status").filter({ hasText: /adicionado ao carrinho/i });
          await expect(success).toBeVisible({ timeout: 15_000 });
          added = true;
          break;
        }
      }
      expect(added, "Nenhum produto da vitrine pôde ser adicionado ao carrinho").toBe(true);

      const cartCookie = (await page.context().cookies()).find(
        (cookie) => cookie.name === `vexo_cart_${storefrontSlug}`,
      );
      expect(cartCookie, "A Server Action confirmou a inclusão, mas não emitiu o cookie de posse do carrinho").toMatchObject({
        httpOnly: true,
        sameSite: "Lax",
        secure: true,
      });
      expect(cartCookie?.value).toMatch(/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);

      await page.goto(cartPath);
      await expect(page.getByRole("heading", { level: 1, name: /seu carrinho/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /finalizar compra/i })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("link", { name: /finalizar compra/i })).toBeVisible();

      await page.goto(`/loja/${storefrontSlug}/checkout`);
      await expect(page.getByLabel("Complemento (opcional)")).not.toHaveAttribute("required", "");
      expect(errors, "Erros inesperados no console do fluxo de compra").toEqual([]);
    } finally {
      await page.goto(cartPath);
      const clearCart = page.getByRole("button", { name: /limpar carrinho/i });
      if (await clearCart.isVisible()) {
        await clearCart.click();
        await page.locator("dialog").getByRole("button", { name: "Limpar" }).click();
        await expect(page.getByRole("heading", { level: 2, name: /carrinho está vazio/i })).toBeVisible();
      }
    }
  });
});
