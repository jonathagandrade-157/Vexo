import { describe, expect, it } from "vitest";
import { buildStoreThemeStyle, DEFAULT_STORE_PRIMARY_COLOR, DEFAULT_STORE_SECONDARY_COLOR } from "@/lib/color/store-theme";

/**
 * Sprint 1 — Fase B2 §15.5/§15.6. `buildStoreThemeStyle` é a única função
 * que decide as cores da storefront — nunca uma classe Tailwind estática
 * (Tailwind compila em build time, não por tenant). Cobre exatamente os
 * dois casos de fallback exigidos: loja sem logo personalizado continua
 * funcionando (não é responsabilidade desta função — ver
 * `storefront-header.tsx`, que já trata `logoUrl` ausente renderizando o
 * nome da loja) e loja sem cores personalizadas usa os defaults do VEXO.
 */
describe("buildStoreThemeStyle", () => {
  it("usa as cores personalizadas do tenant quando presentes", () => {
    const style = buildStoreThemeStyle("#111111", "#222222");
    expect(style).toEqual({ "--store-primary": "#111111", "--store-secondary": "#222222" });
  });

  it("usa os defaults do VEXO quando o tenant não personalizou nenhuma cor (fallback obrigatório)", () => {
    const style = buildStoreThemeStyle(null, null);
    expect(style).toEqual({
      "--store-primary": DEFAULT_STORE_PRIMARY_COLOR,
      "--store-secondary": DEFAULT_STORE_SECONDARY_COLOR,
    });
  });

  it("aplica o default por cor individualmente (uma loja pode ter só uma das duas personalizada)", () => {
    const style = buildStoreThemeStyle("#111111", null);
    expect(style).toEqual({ "--store-primary": "#111111", "--store-secondary": DEFAULT_STORE_SECONDARY_COLOR });
  });

  it("nunca produz nenhuma outra propriedade além das duas custom properties escopadas à storefront", () => {
    const style = buildStoreThemeStyle("#111111", "#222222");
    expect(Object.keys(style).sort()).toEqual(["--store-primary", "--store-secondary"]);
  });
});
