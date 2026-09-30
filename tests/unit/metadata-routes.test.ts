import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://vexo.test" }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("rotas de descoberta pública", () => {
  it("expõe a landing no sitemap sem indexar áreas privadas", () => {
    expect(sitemap()).toEqual([
      {
        url: "https://vexo.test",
        changeFrequency: "weekly",
        priority: 1,
      },
    ]);

    const metadata = robots();
    expect(metadata.sitemap).toBe("https://vexo.test/sitemap.xml");
    expect(metadata.rules).toEqual(
      expect.objectContaining({
        allow: ["/", "/loja/"],
        disallow: expect.arrayContaining(["/api/", "/master/", "/painel/", "/loja/*/checkout"]),
      }),
    );
  });
});
