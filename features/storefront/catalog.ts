import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
}

export interface PublicProductSummary {
  id: string;
  name: string;
  slug: string;
  price: number;
  promotional_price: number | null;
  main_image: string | null;
  category: PublicCategory | null;
}

export interface PublicProduct extends PublicProductSummary {
  description: string | null;
}

interface CategoryJoinRow {
  category: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
}

function firstCategory(row: CategoryJoinRow["category"]): PublicCategory | null {
  const c = Array.isArray(row) ? row[0] : row;
  return c ? { id: c.id, name: c.name, slug: c.slug } : null;
}

/**
 * Categorias/produtos publicados do storefront (arquitetura §16 Etapa 7)
 * — sempre pela mesma RLS pública restrita a `anon` (migration
 * 20260817220026), nunca por tenant_id vindo do client: `tenantId` aqui
 * vem exclusivamente de `resolveStorefrontTenant(slug)`, resolvido a
 * partir da URL, não de parâmetro do formulário/query string.
 */
export const getStorefrontCategories = cache(
  async (tenantId: string): Promise<PublicCategory[]> => {
    const supabase = createSupabasePublicClient();
    const { data } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    return (data ?? []) as PublicCategory[];
  },
);

export const getStorefrontProducts = cache(
  async (tenantId: string, categorySlug?: string, searchQuery?: string): Promise<PublicProductSummary[]> => {
    const supabase = createSupabasePublicClient();
    const { data } = await supabase
      .from("products")
      .select("id, name, slug, price, promotional_price, main_image, category:categories(id, name, slug)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as unknown as (PublicProductSummary & CategoryJoinRow)[];
    let products = rows.map((row) => ({ ...row, category: firstCategory(row.category) }));

    // Filtro por categoria em memória, não via PostgREST embedded filter
    // (`.eq("category.slug", ...)`) — esse filtro só funciona de forma
    // confiável com `!inner` no embed, e o catálogo de uma loja nesta
    // etapa é pequeno o bastante para isso não ser um problema real de
    // performance.
    if (categorySlug) products = products.filter((p) => p.category?.slug === categorySlug);

    // Busca por nome (Etapa 15 §8) — mesma justificativa do filtro de
    // categoria acima: em memória, sem novo índice/migration.
    const trimmedQuery = searchQuery?.trim().toLowerCase();
    if (trimmedQuery) products = products.filter((p) => p.name.toLowerCase().includes(trimmedQuery));

    return products;
  },
);

export const getStorefrontProduct = cache(
  async (tenantId: string, productSlug: string): Promise<PublicProduct | null> => {
    const supabase = createSupabasePublicClient();
    const { data } = await supabase
      .from("products")
      .select(
        "id, name, slug, description, price, promotional_price, main_image, category:categories(id, name, slug)",
      )
      .eq("tenant_id", tenantId)
      .eq("slug", productSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!data) return null;
    const row = data as unknown as PublicProduct & CategoryJoinRow;
    return { ...row, category: firstCategory(row.category) };
  },
);
