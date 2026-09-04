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
  // COOP/CORP/COEP e cookies ficam fora desta etapa.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          // D15-S.3.2 — CSP em modo Report-Only (nunca bloqueante: ver
          // Content-Security-Policy-Report-Only, não Content-Security-Policy).
          // Cada diretiva reflete uso real confirmado por auditoria de
          // código, não um allowlist genérico:
          //  - script-src/style-src precisam de 'unsafe-inline': o App
          //    Router do Next.js já usa <script> inline para hidratação
          //    (self.__next_f.push(...), presente em toda página SSR) e o
          //    projeto usa style="..." inline de verdade (tema por tenant via
          //    CSS custom properties, posicionamento do next/image). CSP
          //    baseada em nonce exigiria gerar o nonce em proxy.ts e forçar
          //    renderização dinâmica em toda página (perda de cache/ISR/PPR)
          //    — mudança de arquitetura fora do escopo do D15-S.3.2.
          //  - 'unsafe-eval' só em desenvolvimento (React usa eval só em
          //    dev para reconstruir stack traces; nunca em produção —
          //    https://nextjs.org/docs/app/guides/content-security-policy).
          //  - style-src/font-src incluem fonts.googleapis.com/
          //    fonts.gstatic.com só por causa do Material Symbols
          //    (app/layout.tsx) — as 3 fontes de texto (next/font/google)
          //    são self-hosted em build time, servidas por /_next/static,
          //    já cobertas por 'self'.
          //  - img-src inclui blob: (preview local antes do upload —
          //    URL.createObjectURL em app/painel/aparencia/logo-uploader.tsx,
          //    components/painel/product-image-uploader.tsx,
          //    components/painel/banner-form-dialog.tsx). Imagens do
          //    Supabase Storage nunca são buscadas direto pelo navegador —
          //    sempre via /_next/image (mesma origem; a busca real ao
          //    Supabase é feita pelo otimizador de imagem do Next.js,
          //    server-to-server, nunca pelo browser).
          //  - connect-src inclui https://*.supabase.co (mesmo padrão já
          //    usado em `images.remotePatterns` acima) para os dois usos
          //    reais confirmados do client Supabase no navegador:
          //    app/(auth)/redefinir-senha (supabase.auth.getSession()/
          //    onAuthStateChange()) e os uploaders do painel
          //    (supabase.storage.uploadToSignedUrl). Login/cadastro/
          //    checkout usam Server Actions (signInWithPassword roda no
          //    servidor) — não precisam de connect-src.
          //  - Mercado Pago e Melhor Envio NUNCA aparecem aqui: toda
          //    chamada a essas APIs é `server-only` (lib/payments/
          //    mercadopago.ts, lib/shipping-connections/*.ts) e o checkout/
          //    conexão OAuth usa redirect() de página inteira
          //    (features/checkout/actions.ts, features/shipping-
          //    connections/actions.ts) — nunca fetch/XHR/iframe do
          //    navegador, então nunca entram em connect-src/frame-src.
          //  - frame-src/frame-ancestors 'self': único iframe do projeto é
          //    o preview de Aparência, sempre same-origin (src relativo);
          //    frame-ancestors 'self' é o equivalente nativo de CSP para o
          //    X-Frame-Options: SAMEORIGIN já em vigor (não o substitui).
          //  - object-src 'none': nenhum <object>/<embed> no projeto, sem
          //    caso de uso legítimo para permitir.
          //  - media-src/worker-src omitidos: nenhum <video>/<audio>/
          //    Worker/ServiceWorker encontrado — sem evidência, sem
          //    diretiva (ver relatório D15-S.3.2 para os gaps registrados).
          { key: "Content-Security-Policy-Report-Only", value: buildCspReportOnly() },
        ],
      },
    ];
  },
};

function buildCspReportOnly(): string {
  const isDev = process.env.NODE_ENV === "development";
  const csp = `
    default-src 'self';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
    frame-ancestors 'self';
    script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' blob:;
    font-src 'self' https://fonts.gstatic.com;
    connect-src 'self' https://*.supabase.co${isDev ? " http://127.0.0.1:54321 http://localhost:54321" : ""};
    frame-src 'self';
    upgrade-insecure-requests;
  `;
  return csp.replace(/\s{2,}/g, " ").trim();
}

export default nextConfig;
