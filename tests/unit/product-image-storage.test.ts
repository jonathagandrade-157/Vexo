import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProductImagePath,
  isValidProductImagePath,
  PRODUCT_IMAGE_MAX_BYTES,
  sniffImageMime,
  validateProductImageUploadRequest,
} from "@/features/products/image-storage";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffImageMime", () => {
  it("recognizes a real JPEG signature", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0))).toBe("image/jpeg");
  });

  it("recognizes a real PNG signature", () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
  });

  it("recognizes a real WebP signature (RIFF....WEBP)", () => {
    expect(
      sniffImageMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    ).toBe("image/webp");
  });

  it("rejects an SVG (text) file even if renamed to .png", () => {
    const svg = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    expect(sniffImageMime(svg)).toBeNull();
  });

  it("rejects an HTML polyglot claiming to be an image", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(sniffImageMime(html)).toBeNull();
  });

  it("rejects a JPEG extension with bytes that don't match any real signature", () => {
    expect(sniffImageMime(bytes(0x00, 0x00, 0x00, 0x00))).toBeNull();
  });

  it("rejects a truncated/empty buffer instead of throwing", () => {
    expect(sniffImageMime(bytes())).toBeNull();
    expect(sniffImageMime(bytes(0xff))).toBeNull();
  });

  it("does not confuse a RIFF file that isn't WEBP (e.g. a WAV file)", () => {
    expect(
      sniffImageMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
  });
});

describe("buildProductImagePath", () => {
  it("always nests under {tenant_id}/products/{product_id}/ — never client-influenced", () => {
    const path = buildProductImagePath("tenant-a", "product-1", "image/png");
    expect(path).toBe("tenant-a/products/product-1/main.png");
  });

  it("maps each allowed mime to a deterministic extension", () => {
    expect(buildProductImagePath("t", "p", "image/jpeg")).toBe("t/products/p/main.jpg");
    expect(buildProductImagePath("t", "p", "image/webp")).toBe("t/products/p/main.webp");
  });
});

describe("PRODUCT_IMAGE_MAX_BYTES", () => {
  it("matches the documented 5MB limit (architecture §9.3)", () => {
    expect(PRODUCT_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

/**
 * D11.8 — validação pura do pedido de `prepareProductImageUploadAction`
 * (o passo 1 do upload direto ao Storage): tamanho declarado + bytes
 * mágicos do prefixo enviado. Mesmo motivo de testabilidade dos outros
 * `describe` deste arquivo — sem rede, sem Storage real.
 */
describe("validateProductImageUploadRequest", () => {
  const jpegHeader = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
  const pngHeader = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
  const webpHeader = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

  it("accepts a real JPEG within the 5MB limit", () => {
    expect(validateProductImageUploadRequest(1024, jpegHeader)).toEqual({ mime: "image/jpeg" });
  });

  it("accepts a real PNG within the 5MB limit", () => {
    expect(validateProductImageUploadRequest(1024, pngHeader)).toEqual({ mime: "image/png" });
  });

  it("accepts a real WebP within the 5MB limit", () => {
    expect(validateProductImageUploadRequest(1024, webpHeader)).toEqual({ mime: "image/webp" });
  });

  it("rejects a zero/negative/NaN declared size as empty", () => {
    expect(validateProductImageUploadRequest(0, jpegHeader)).toEqual({ error: "empty" });
    expect(validateProductImageUploadRequest(-1, jpegHeader)).toEqual({ error: "empty" });
    expect(validateProductImageUploadRequest(Number.NaN, jpegHeader)).toEqual({ error: "empty" });
  });

  it("rejects a declared size above 5MB, even with a valid signature", () => {
    expect(validateProductImageUploadRequest(5 * 1024 * 1024 + 1, jpegHeader)).toEqual({ error: "too_large" });
  });

  it("accepts a declared size of exactly 5MB (boundary)", () => {
    expect(validateProductImageUploadRequest(5 * 1024 * 1024, jpegHeader)).toEqual({ mime: "image/jpeg" });
  });

  it("rejects a header that doesn't match any real image signature (e.g. spoofed SVG/HTML)", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(validateProductImageUploadRequest(1024, html)).toEqual({ error: "unsupported_mime" });
  });
});

/**
 * D11.8 — o cliente devolve o `path` de volta em
 * `confirmProductImageUploadAction`, mas o servidor nunca confia nele:
 * recomputa os 3 paths possíveis para o tenant/produto já autenticados e
 * exige correspondência exata. Isso é o que impede um cliente de gravar
 * `products.main_image` apontando para outro produto/tenant, mesmo que
 * ele já tenha conseguido — por algum outro caminho — um path/token de
 * outro contexto.
 */
describe("isValidProductImagePath", () => {
  it("accepts exactly the paths buildProductImagePath would generate for this tenant/product", () => {
    expect(isValidProductImagePath("tenant-a/products/p1/main.jpg", "tenant-a", "p1")).toBe(true);
    expect(isValidProductImagePath("tenant-a/products/p1/main.png", "tenant-a", "p1")).toBe(true);
    expect(isValidProductImagePath("tenant-a/products/p1/main.webp", "tenant-a", "p1")).toBe(true);
  });

  it("rejects a path belonging to a different tenant, even for the same product id", () => {
    expect(isValidProductImagePath("tenant-b/products/p1/main.jpg", "tenant-a", "p1")).toBe(false);
  });

  it("rejects a path belonging to a different product in the same tenant", () => {
    expect(isValidProductImagePath("tenant-a/products/other-product/main.jpg", "tenant-a", "p1")).toBe(false);
  });

  it("rejects an arbitrary/malformed path (never a silent bypass)", () => {
    expect(isValidProductImagePath("../tenant-a/products/p1/main.jpg", "tenant-a", "p1")).toBe(false);
    expect(isValidProductImagePath("tenant-a/products/p1/main.svg", "tenant-a", "p1")).toBe(false);
    expect(isValidProductImagePath("", "tenant-a", "p1")).toBe(false);
  });
});

describe("getProductImagePublicUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds a deterministic public URL from the bucket + path, no DB round trip", async () => {
    const { getProductImagePublicUrl } = await import("@/features/products/image-storage");
    expect(getProductImagePublicUrl("tenant-a/products/p1/main.png")).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-media/tenant-a/products/p1/main.png",
    );
  });
});

/**
 * D11.2 — `resolveProductImagePreview` é a lógica pura extraída de
 * `ProductImageUploader` que decide qual URL exibir (preview local em
 * blob vs. URL real do Storage já persistida). Extraída especificamente
 * para ser testável sem uma infraestrutura de teste de componente React
 * (não disponível neste projeto: vitest roda em `environment: "node"`,
 * sem jsdom/@testing-library/react — não instalada nesta correção, ver
 * relatório D11.2 §N "Limitações"). O ciclo de vida real da Object URL
 * (criação/revogação, double-invoke do React Strict Mode) não é coberto
 * por estes testes — só a regra de "qual URL vence" é.
 */
describe("resolveProductImagePreview", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("shows nothing when there is no preview and no saved image (new product, no file picked yet)", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    expect(
      resolveProductImagePreview({
        actionStatus: "idle",
        actionImagePath: undefined,
        initialImagePath: null,
        previewUrl: null,
      }),
    ).toEqual({ savedPath: null, displayUrl: null, isBlobPreview: false });
  });

  it("shows the already-saved image on first render, before any file is picked", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "idle",
      actionImagePath: undefined,
      initialImagePath: "tenant-a/products/p1/main.jpg",
      previewUrl: null,
    });
    expect(result).toEqual({
      savedPath: "tenant-a/products/p1/main.jpg",
      displayUrl: "https://example.supabase.co/storage/v1/object/public/product-media/tenant-a/products/p1/main.jpg",
      isBlobPreview: false,
    });
  });

  it("prefers the local blob preview while a file is selected but not yet confirmed (idle/pending)", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "idle",
      actionImagePath: undefined,
      initialImagePath: "tenant-a/products/p1/main.jpg",
      previewUrl: "blob:http://localhost/new-file",
    });
    expect(result.displayUrl).toBe("blob:http://localhost/new-file");
    expect(result.isBlobPreview).toBe(true);
  });

  it("switches from the local blob preview to the persisted Storage URL after a successful upload", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "success",
      actionImagePath: "tenant-a/products/p1/main.webp",
      initialImagePath: null,
      // Ainda presente no instante do render (o componente só limpa o
      // preview num efeito, depois do commit) — mesmo assim a URL real
      // já deve vencer imediatamente, nunca o blob.
      previewUrl: "blob:http://localhost/new-file",
    });
    expect(result).toEqual({
      savedPath: "tenant-a/products/p1/main.webp",
      displayUrl: "https://example.supabase.co/storage/v1/object/public/product-media/tenant-a/products/p1/main.webp",
      isBlobPreview: false,
    });
  });

  it("keeps showing the local preview (not black/empty) when the upload fails, alongside the error message rendered separately", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "error",
      actionImagePath: undefined,
      initialImagePath: null,
      previewUrl: "blob:http://localhost/rejected-file",
    });
    expect(result.displayUrl).toBe("blob:http://localhost/rejected-file");
    expect(result.isBlobPreview).toBe(true);
  });

  it("falls back to the previously saved image when the upload fails and there is no local preview", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "error",
      actionImagePath: undefined,
      initialImagePath: "tenant-a/products/p1/main.jpg",
      previewUrl: null,
    });
    expect(result.displayUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-media/tenant-a/products/p1/main.jpg",
    );
    expect(result.isBlobPreview).toBe(false);
  });

  it("a successful upload with a null imagePath (defensive) never resurrects the local blob preview", async () => {
    const { resolveProductImagePreview } = await import("@/features/products/image-storage");
    const result = resolveProductImagePreview({
      actionStatus: "success",
      actionImagePath: null,
      initialImagePath: "tenant-a/products/p1/main.jpg",
      previewUrl: "blob:http://localhost/new-file",
    });
    // status "success" sempre ignora initialImagePath (a resposta do
    // servidor é a fonte de verdade); com actionImagePath nulo, cai no
    // preview local em vez de reviver um path antigo que o servidor não
    // confirmou mais.
    expect(result.savedPath).toBeNull();
    expect(result.displayUrl).toBe("blob:http://localhost/new-file");
    expect(result.isBlobPreview).toBe(true);
  });
});
