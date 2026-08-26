import type { CSSProperties } from "react";

/**
 * Sprint 1 — Fase B2. Cores padrão quando o tenant não personalizou nada
 * (`primary_color`/`secondary_color` NULL) — únicas em todo o projeto:
 * o preview de `/painel/configuracoes/aparencia` (Fase A) e a storefront
 * pública (Fase B2) leem daqui, nunca cada um com seu próprio hardcode
 * (antes desta etapa, `appearance-form.tsx` tinha esses valores soltos —
 * movidos para cá para as duas pontas nunca divergirem).
 */
export const DEFAULT_STORE_PRIMARY_COLOR = "#7C3AED";
export const DEFAULT_STORE_SECONDARY_COLOR = "#3B82F6";

/**
 * Monta as CSS custom properties de identidade visual da loja
 * (`--store-primary`/`--store-secondary`) — nunca uma classe Tailwind
 * gerada dinamicamente (Tailwind compila em build time; cor por tenant só
 * é possível via variável CSS). Quem usa isto precisa aplicar o resultado
 * num elemento que ENVOLVA só a árvore da storefront pública
 * (`StorefrontShell`) — nunca em `:root`/no layout raiz do app, para
 * nunca vazar para `/painel`/`/master` nem para outra loja.
 */
export function buildStoreThemeStyle(primaryColor: string | null, secondaryColor: string | null): CSSProperties {
  return {
    "--store-primary": primaryColor ?? DEFAULT_STORE_PRIMARY_COLOR,
    "--store-secondary": secondaryColor ?? DEFAULT_STORE_SECONDARY_COLOR,
  } as CSSProperties;
}
