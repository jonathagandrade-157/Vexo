import { describe, expect, it } from "vitest";
import { buildBannerPath, hasReachedBannerLimit, MAX_BANNERS_PER_TENANT } from "@/features/settings/banner-storage";

/**
 * Sprint 1 — Fase C2. `createBannerAction` é `"use server"`, fora do
 * alcance direto de um teste (mesma limitação de qualquer outra Action
 * deste projeto) — por isso o limite de 5 banners foi extraído para esta
 * função pura, testável isoladamente; é exatamente o que a Action chama.
 */
describe("hasReachedBannerLimit", () => {
  it(`retorna false abaixo do limite (${MAX_BANNERS_PER_TENANT})`, () => {
    expect(hasReachedBannerLimit(0)).toBe(false);
    expect(hasReachedBannerLimit(MAX_BANNERS_PER_TENANT - 1)).toBe(false);
  });

  it("retorna true no limite e acima dele", () => {
    expect(hasReachedBannerLimit(MAX_BANNERS_PER_TENANT)).toBe(true);
    expect(hasReachedBannerLimit(MAX_BANNERS_PER_TENANT + 1)).toBe(true);
  });
});

describe("buildBannerPath", () => {
  it("monta o path dentro do bucket tenant-media com o segmento banners/{banner_id}", () => {
    expect(buildBannerPath("tenant-1", "banner-1", "image/png")).toBe("tenant-1/banners/banner-1.png");
    expect(buildBannerPath("tenant-1", "banner-1", "image/jpeg")).toBe("tenant-1/banners/banner-1.jpg");
    expect(buildBannerPath("tenant-1", "banner-1", "image/webp")).toBe("tenant-1/banners/banner-1.webp");
  });
});
