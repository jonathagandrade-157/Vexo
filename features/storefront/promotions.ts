import "server-only";

import { cache } from "react";

import { getStorefrontProducts, type PublicProductSummary } from "./catalog";

/**
 * Sprint 1 — Fase B2 §8. Reaproveita `getStorefrontProducts` (mesma
 * consulta, mesma RLS pública) em vez de duplicar a query de produtos —
 * "promoção" não é uma coluna/tabela nova, é só um filtro sobre
 * `products.promotional_price`, que já existe desde a Etapa 7. Sempre a
 * lista COMPLETA de ativos da loja, nunca restrita pelo filtro de
 * categoria/busca que o visitante aplicou na grade principal — a seção de
 * promoções da Home é sempre a mesma independentemente do que está
 * selecionado ali.
 */
export const getStorefrontPromotions = cache(
  async (tenantId: string): Promise<PublicProductSummary[]> => {
    const products = await getStorefrontProducts(tenantId);
    return products.filter((product) => product.promotional_price !== null);
  },
);
