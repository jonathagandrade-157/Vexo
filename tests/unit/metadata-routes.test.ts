import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://vexo.test" }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";

describe("rotas de descoberta pública", () => {
  it("expõe as páginas públicas no sitemap sem indexar áreas privadas", () => {
    expect(sitemap()).toEqual([
      {
        url: "https://vexo.test",
        changeFrequency: "weekly",
        priority: 1,
      },
      {
        url: "https://vexo.test/termos",
        changeFrequency: "monthly",
        priority: 0.3,
      },
      {
        url: "https://vexo.test/privacidade",
        changeFrequency: "monthly",
        priority: 0.3,
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

  it("expõe metadados instaláveis coerentes com a identidade da VEXO", () => {
    expect(manifest()).toEqual(
      expect.objectContaining({
        name: "VEXO — Loja online",
        short_name: "VEXO",
        start_url: "/",
        display: "standalone",
        lang: "pt-BR",
      }),
    );
    expect(manifest().icons).toEqual([
      expect.objectContaining({ src: "/icon", sizes: "512x512", type: "image/png" }),
    ]);
  });
});
