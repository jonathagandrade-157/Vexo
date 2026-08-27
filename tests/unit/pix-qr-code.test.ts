import { describe, expect, it } from "vitest";
import { buildPixPayload } from "@/lib/pix/payload";
import { renderPixQrCodeSvg } from "@/lib/pix/qr-code";

describe("renderPixQrCodeSvg", () => {
  const payload = buildPixPayload({
    pixKey: "11999999999",
    pixKeyType: "phone",
    recipientName: "Loja Exemplo",
    city: "São Paulo",
    amount: 150,
    txid: "PED000123",
  });

  it("gera um SVG válido e não vazio a partir do payload", async () => {
    const svg = await renderPixQrCodeSvg(payload);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("o SVG gerado é sempre o mesmo para o mesmo payload (determinístico)", async () => {
    const a = await renderPixQrCodeSvg(payload);
    const b = await renderPixQrCodeSvg(payload);
    expect(a).toBe(b);
  });

  it("payloads diferentes geram QR Codes diferentes", async () => {
    const otherPayload = buildPixPayload({
      pixKey: "11999999999",
      pixKeyType: "phone",
      recipientName: "Loja Exemplo",
      city: "São Paulo",
      amount: 999,
      txid: "PED000999",
    });
    const a = await renderPixQrCodeSvg(payload);
    const b = await renderPixQrCodeSvg(otherPayload);
    expect(a).not.toBe(b);
  });
});
