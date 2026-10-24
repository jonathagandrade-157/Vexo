import { describe, expect, it } from "vitest";

import { bannerFieldsSchema } from "@/features/settings/banner-schema";

function parseLink(linkUrl: string) {
  return bannerFieldsSchema.safeParse({ linkUrl, status: "active", title: "Oferta" });
}

describe("bannerFieldsSchema — destino do banner", () => {
  it.each(["#promocoes", "/produtos", "/loja/minha-loja?categoria=ofertas#produtos", "https://example.com/oferta"])(
    "aceita destino seguro: %s",
    (linkUrl) => {
      expect(parseLink(linkUrl).success).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//example.com/oferta",
    "http://example.com/oferta",
    "nao-e-uma-url",
    "#",
  ])("rejeita destino inseguro ou inválido: %s", (linkUrl) => {
    expect(parseLink(linkUrl).success).toBe(false);
  });

  it("mantém o link opcional", () => {
    const result = parseLink("   ");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.linkUrl).toBeNull();
  });
});
