import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface PublicBanner {
  id: string;
  imagePath: string;
  linkUrl: string | null;
  title: string | null;
}

/**
 * Sprint 1 — Fase C2. Mesmo padrão exato de `getStorefrontCategories`/
 * `getStorefrontPromotions` — cliente público (`anon`), `cache()` por
 * request, só banners ativos, ordenados. Reaproveitado tanto pela loja
 * pública (`app/loja/[slug]/page.tsx`) quanto pelo preview ao vivo do
 * painel (`app/painel-preview/aparencia`) — nunca uma segunda query.
 */
export const getStorefrontBanners = cache(
  async (tenantId: string): Promise<PublicBanner[]> => {
    const supabase = createSupabasePublicClient();
    const { data } = await supabase
      .from("storefront_banners")
      .select("id, image_path, link_url, title")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    return (data ?? []).map((row) => ({
      id: row.id as string,
      imagePath: row.image_path as string,
      linkUrl: row.link_url as string | null,
      title: row.title as string | null,
    }));
  },
);
