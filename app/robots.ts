import type { MetadataRoute } from "next";

import { getPublicEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/loja/"],
      disallow: [
        "/api/",
        "/cadastro",
        "/login",
        "/master/",
        "/onboarding/",
        "/painel/",
        "/painel-preview/",
        "/recuperar-senha",
        "/redefinir-senha",
        "/sem-loja",
        "/trial/",
        "/loja/*/carrinho",
        "/loja/*/checkout",
        "/loja/*/pedido/",
      ],
    },
    sitemap: `${NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
    host: NEXT_PUBLIC_SITE_URL,
  };
}
