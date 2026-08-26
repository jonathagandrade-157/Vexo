import type { PublicCategory, PublicProductSummary } from "@/features/storefront/catalog";
import type { PublicTenant } from "@/features/storefront/resolve-tenant";

/**
 * Sprint 1 — Fase B2 §3. Interface única que os 5 templates recebem —
 * todos os dados (loja, categorias, produtos, promoções) são resolvidos
 * UMA vez em `app/loja/[slug]/page.tsx`, nunca dentro de cada template.
 * Um template só decide COMO apresentar isto, nunca de onde vem.
 */
export interface StorefrontHomeProps {
  tenant: PublicTenant;
  categories: PublicCategory[];
  /** Já filtrados por categoria/busca (querystring `?categoria=`/`?q=`) — a mesma lista que a grade principal sempre mostrou. */
  products: PublicProductSummary[];
  /** Sempre a lista completa de produtos em promoção da loja — nunca afetada pelo filtro de categoria/busca acima (ver `features/storefront/promotions.ts`). */
  promotions: PublicProductSummary[];
  activeCategorySlug?: string;
  searchQuery?: string;
}
