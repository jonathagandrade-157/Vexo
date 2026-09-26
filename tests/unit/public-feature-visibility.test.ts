import { describe, expect, it } from "vitest";

import { visiblePublicFeatureNames } from "@/features/commercial/public-feature-visibility";

describe("public feature visibility", () => {
  it("keeps features that are available in the product", () => {
    expect(
      visiblePublicFeatureNames([
        { key: "storefront", name: "Loja online" },
        { key: "inventory", name: "Estoque" },
        { key: "payment_mercadopago", name: "Pagamento — Mercado Pago" },
      ]),
    ).toEqual(["Loja online", "Estoque", "Pagamento — Mercado Pago"]);
  });

  it("hides catalog entries that are not implemented yet", () => {
    expect(
      visiblePublicFeatureNames([
        { key: "vexo_ai", name: "Vexo AI" },
        { key: "reports", name: "Relatórios" },
        { key: "payment_stripe", name: "Pagamento — Stripe" },
        { key: "api_access", name: "Acesso à API" },
        { key: "products", name: "Produtos" },
      ]),
    ).toEqual(["Produtos"]);
  });
});
