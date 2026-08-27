import { describe, expect, it } from "vitest";
import { buildWhatsappLink } from "@/lib/whatsapp/link";

describe("buildWhatsappLink", () => {
  it("monta o link no formato wa.me/{telefone}?text={mensagem}", () => {
    const link = buildWhatsappLink("5511999999999", "Olá");
    expect(link).toBe("https://wa.me/5511999999999?text=Ol%C3%A1");
  });

  it("faz URL-encode de quebras de linha e caracteres especiais da mensagem", () => {
    const link = buildWhatsappLink("5511999999999", "Linha 1\nLinha 2 — R$ 10,00");
    expect(link).not.toContain("\n");
    expect(link).not.toContain(" ");
    const url = new URL(link);
    expect(url.searchParams.get("text")).toBe("Linha 1\nLinha 2 — R$ 10,00");
  });

  it("nunca inclui nada além do telefone normalizado no path", () => {
    const link = buildWhatsappLink("5511999999999", "qualquer coisa");
    expect(link.startsWith("https://wa.me/5511999999999?")).toBe(true);
  });
});
