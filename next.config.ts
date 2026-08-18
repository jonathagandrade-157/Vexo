import type { NextConfig } from "next";

// Foundation stage: no rewrites/redirects, no experimental flags.
// Tenant-by-host routing and custom-domain handling (§3.4, §17 of the
// architecture doc) are introduced starting Stage 6, not here.
const nextConfig: NextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
