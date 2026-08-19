import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface PublicTenant {
  /**
   * Etapa 7: chave interna para consultar categories/products (que têm
   * tenant_id, não slug). Não é dado sensível (UUID aleatório, não
   * sequencial) — a garantia real de "não expor dado administrativo" é
   * nunca renderizar isto em HTML/props de Client Component, não nunca
   * buscá-lo. `created_by`/`onboarding_completed_at` continuam de fora
   * daqui por serem, esses sim, dados administrativos.
   */
  id: string;
  name: string;
  slug: string;
  segment: string | null;
  description: string | null;
  instagram_handle: string | null;
  whatsapp_phone: string | null;
  contact_email: string | null;
}

export type StorefrontResolution =
  | { status: "not_found" }
  | { status: "not_configured"; name: string }
  | { status: "ready"; tenant: PublicTenant };

/**
 * Único ponto de resolução de tenant do storefront (arquitetura §4 Etapa
 * 6) — nunca por tenant_id vindo do client, só pelo slug da própria URL,
 * contra a nova policy pública de `tenants` (migration 20260817220022).
 * `cache()` do React dedupe entre `generateMetadata` e a página (Next.js
 * chama as duas separadamente para a mesma rota — arquitetura §18: evitar
 * chamada duplicada de resolução de tenant).
 *
 * Projeção explícita de colunas (nunca `select *`): `created_by` e
 * `onboarding_completed_at` nunca saem daqui, mesmo a RLS permitindo a
 * linha inteira — RLS protege linha, não coluna, então a garantia real
 * de "não expor dado administrativo" é este `.select(...)` nomeado.
 *
 * "não encontrada" e "suspensa/excluída" (que a RLS já filtra a nível de
 * linha) retornam o mesmo `not_found` — o visitante nunca tem como saber
 * a diferença entre um slug que nunca existiu e uma loja suspensa.
 */
export const resolveStorefrontTenant = cache(
  async (slug: string): Promise<StorefrontResolution> => {
    const supabase = createSupabasePublicClient();

    const { data } = await supabase
      .from("tenants")
      .select(
        "id, name, slug, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (!data) return { status: "not_found" };

    if (data.onboarding_completed_at === null) {
      return { status: "not_configured", name: data.name as string };
    }

    return {
      status: "ready",
      tenant: {
        id: data.id as string,
        name: data.name as string,
        slug: data.slug as string,
        segment: data.segment as string | null,
        description: data.description as string | null,
        instagram_handle: data.instagram_handle as string | null,
        whatsapp_phone: data.whatsapp_phone as string | null,
        contact_email: data.contact_email as string | null,
      },
    };
  },
);
