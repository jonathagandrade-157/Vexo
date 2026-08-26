import { describe, expect, it } from "vitest";
import { buildLogoPath, sniffLogoMime } from "@/features/settings/logo-storage";

/**
 * Sprint 1 — Fase A. Mesma bateria de casos de
 * `tests/unit/asaas-gateway.test.ts`-style para bytes mágicos, adaptada
 * de `features/products/image-storage.ts` (Etapa 8) — a lógica é uma
 * cópia deliberada (ver comentário em logo-storage.ts), então precisa da
 * mesma cobertura para nunca divergir silenciosamente em segurança.
 */
describe("sniffLogoMime", () => {
  it("detecta JPEG pelos bytes mágicos (FF D8 FF), ignorando extensão/Content-Type", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00]);
    expect(sniffLogoMime(bytes)).toBe("image/jpeg");
  });

  it("detecta PNG pela assinatura completa de 8 bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffLogoMime(bytes)).toBe("image/png");
  });

  it("detecta WebP (RIFF....WEBP)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffLogoMime(bytes)).toBe("image/webp");
  });

  it("rejeita um SVG disfarçado de imagem (nunca aceita por extensão/MIME declarado)", () => {
    const svgBytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(sniffLogoMime(svgBytes)).toBeNull();
  });

  it("rejeita um PDF/executável/arquivo malicioso disfarçado", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    expect(sniffLogoMime(pdfBytes)).toBeNull();
  });

  it("rejeita bytes vazios/curtos demais", () => {
    expect(sniffLogoMime(new Uint8Array([]))).toBeNull();
    expect(sniffLogoMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("buildLogoPath", () => {
  it("gera um path fixo por tenant, sem segmento de entidade filha (1 logo por loja)", () => {
    expect(buildLogoPath("tenant-abc", "image/png")).toBe("tenant-abc/logo/logo.png");
    expect(buildLogoPath("tenant-abc", "image/jpeg")).toBe("tenant-abc/logo/logo.jpg");
    expect(buildLogoPath("tenant-abc", "image/webp")).toBe("tenant-abc/logo/logo.webp");
  });

  it("isola tenants diferentes em prefixos diferentes (checado pela RLS de storage.objects a partir do 1º segmento)", () => {
    const pathA = buildLogoPath("tenant-a", "image/png");
    const pathB = buildLogoPath("tenant-b", "image/png");
    expect(pathA).not.toBe(pathB);
    expect(pathA.split("/")[0]).toBe("tenant-a");
    expect(pathB.split("/")[0]).toBe("tenant-b");
  });
});
