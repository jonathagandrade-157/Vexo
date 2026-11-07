import { expect, test } from "@playwright/test";
import { login, query, slug, visual, watchErrors } from "./local-commerce";

test.describe("carrinho após adicionar produto", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1", "Only disposable loopback services.");
  for (const audience of ["visitante", "lojista autenticado"] as const) {
    test("mantém o item no carrinho do " + audience + " após navegação e reload", async ({ page }, info) => {
      const errors = watchErrors(page);
      if (audience === "lojista autenticado") await login(page);
      await page.goto("/loja/" + slug + "/produto/principal");
      await page.getByRole("button", { name: /adicionar ao carrinho/i }).click();
      await expect(page.getByRole("status").filter({ hasText: /adicionado ao carrinho/i })).toBeVisible();
      const cookie = (await page.context().cookies()).find(value => value.name === "vexo_cart_" + slug);
      expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe("Lax");
      const cartId = cookie!.value.split(".")[1]!;
      const persisted = await query("select ci.quantity,p.name from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=$1", [cartId]);
      expect(persisted.rows).toEqual([{ quantity: 1, name: "Produto E2E principal" }]);
      await page.locator('header a[href="/loja/' + slug + '/carrinho"]').click();
      await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
      await expect(page.getByText(/R\$\s*100,00/).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Aumentar quantidade", exact: true }).click();
      await expect(page.getByText(/R\$\s*200,00/).first()).toBeVisible();
      await page.reload();
      expect((await query("select quantity from public.cart_items where cart_id=$1", [cartId])).rows).toEqual([{ quantity: 2 }]);
      await visual(page, info, "carrinho-" + (audience === "visitante" ? "visitante" : "autenticado"));
      expect(errors).toEqual([]);
    });
  }
});
