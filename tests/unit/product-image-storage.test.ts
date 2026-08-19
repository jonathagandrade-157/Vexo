import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProductImagePath,
  PRODUCT_IMAGE_MAX_BYTES,
  sniffImageMime,
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
