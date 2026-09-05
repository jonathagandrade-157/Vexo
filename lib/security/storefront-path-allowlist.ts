/**
 * D17.4.2 — allowlist explícita das rotas públicas de storefront elegíveis
 * a Host Routing (`proxy.ts`). Derivada diretamente da árvore real de
 * `app/loja/[slug]/` (auditoria D17.4.0 §G; confirmada por leitura direta
 * nesta etapa: `page.tsx`, `carrinho/page.tsx`, `checkout/page.tsx`,
 * `produto/[productSlug]/page.tsx`, `pedido/[orderId]/page.tsx` — nenhuma
 * outra rota existe hoje sob esse diretório) — nunca uma condição genérica
 * do tipo "se não é /api, é storefront" (proibido explicitamente pelo
 * ticket D17.4.2 Parte 3).
 *
 * Pura, sem I/O — só decide SE um pathname já é uma rota pública de
 * storefront, nunca resolve host/tenant. `/painel`, `/master`, `/api`,
 * `/login`, `/cadastro`, `/onboarding`, `/sem-loja`, `/painel-preview`,
 * `/_next/*` e qualquer outra rota não listada abaixo nunca batem em
 * nenhum destes padrões — ficam de fora por construção, não por uma
 * exclusão explícita.
 */
const STOREFRONT_PATH_PATTERNS: RegExp[] = [
  /^\/$/, // app/loja/[slug]/page.tsx (home)
  /^\/carrinho\/?$/, // app/loja/[slug]/carrinho/page.tsx
  /^\/checkout\/?$/, // app/loja/[slug]/checkout/page.tsx
  /^\/produto\/[^/]+\/?$/, // app/loja/[slug]/produto/[productSlug]/page.tsx
  /^\/pedido\/[^/]+\/?$/, // app/loja/[slug]/pedido/[orderId]/page.tsx
];

/**
 * `pathname` já deve vir de `request.nextUrl.pathname` (sem query string).
 * Retorna `true` só para os 5 caminhos que hoje têm uma página real sob
 * `app/loja/[slug]/` — qualquer outro valor (incluindo qualquer coisa que
 * já comece por `/loja/`) retorna `false`.
 */
export function isStorefrontPath(pathname: string): boolean {
  return STOREFRONT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}
