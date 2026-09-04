import type { NextConfig } from "next";

// Foundation stage: no rewrites/redirects, no experimental flags.
// Tenant-by-host routing and custom-domain handling (§3.4, §17 of the
// architecture doc) are introduced starting Stage 6, not here.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // D15-S.3.1 — não divulga a stack via header (baixo risco, sem impacto
  // funcional: nenhuma rota depende de `X-Powered-By`).
  poweredByHeader: false,
  images: {
    // Etapa 8: imagens de produto (bucket público `product-media`,
    // arquitetura §9.1). Hospedado (produção) e local (`supabase start`,
    // porta padrão 54321) — nunca um hostname arbitrário.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "localhost", port: "54321", pathname: "/storage/v1/object/public/**" },
    ],
  },
  // D15-S.3.1 — headers de segurança de baixo risco (auditoria D15-S.3),
  // globais para toda rota. `X-Frame-Options: SAMEORIGIN` (nunca `DENY`)
  // porque `/painel/aparencia` embute `/painel-preview/aparencia` num
  // `<iframe>` same-origin de propósito (live preview do editor de
  // aparência, app/painel/aparencia/live-preview-frame.tsx) — SAMEORIGIN
  // preserva esse uso e ainda bloqueia framing de terceiros (clickjacking).
  // CSP/COOP/CORP/COEP e cookies ficam fora desta etapa (D15-S.3.1).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
