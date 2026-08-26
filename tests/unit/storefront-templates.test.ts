import { describe, expect, it } from "vitest";
import { CommerceHome } from "@/components/storefront/templates/commerce/home";
import { EditorialHome } from "@/components/storefront/templates/editorial/home";
import { FashionHome } from "@/components/storefront/templates/fashion/home";
import { MinimalHome } from "@/components/storefront/templates/minimal/home";
import { PremiumHome } from "@/components/storefront/templates/premium/home";
import { getStorefrontHomeComponent } from "@/features/storefront/templates/registry";

/**
 * Sprint 1 — Fase B2 §15.2/§15.3. O registry é uma tabela de lookup pura
 * (`features/storefront/templates/registry.ts`) — este teste confirma que
 * cada um dos 5 valores de `storefront_template` resolve exatamente para
 * o componente esperado, e que qualquer valor fora dos 5 (incluindo
 * null/undefined, que nunca deveriam chegar aqui dado o NOT NULL + CHECK
 * de produção, mas são tratados defensivamente) cai em Commerce — nunca
 * quebra a página, nunca renderiza nada indefinido.
 */
describe("getStorefrontHomeComponent", () => {
  it("resolve cada um dos 5 templates para o componente correto", () => {
    expect(getStorefrontHomeComponent("commerce")).toBe(CommerceHome);
    expect(getStorefrontHomeComponent("premium")).toBe(PremiumHome);
    expect(getStorefrontHomeComponent("minimal")).toBe(MinimalHome);
    expect(getStorefrontHomeComponent("editorial")).toBe(EditorialHome);
    expect(getStorefrontHomeComponent("fashion")).toBe(FashionHome);
  });

  it("faz fallback seguro para Commerce com um valor desconhecido", () => {
    expect(getStorefrontHomeComponent("lookbook")).toBe(CommerceHome);
    expect(getStorefrontHomeComponent("nao-existe")).toBe(CommerceHome);
  });

  it("faz fallback seguro para Commerce com null/undefined", () => {
    expect(getStorefrontHomeComponent(null)).toBe(CommerceHome);
    expect(getStorefrontHomeComponent(undefined)).toBe(CommerceHome);
  });
});
