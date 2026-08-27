import "server-only";

import { cache } from "react";

import type { PixKeyType } from "@/features/settings/pix-schema";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface StorePixSettings {
  pixKey: string;
  pixKeyType: PixKeyType;
  recipientName: string;
}

/**
 * Fase D2-B (revisão final). Leitura pública (anon) — mesma policy de
 * SELECT que já cobre o resto de `tenants` no storefront (name/logo/
 * whatsapp_phone etc., RLS por linha, não por coluna). Só usada pela
 * página de checkout (nunca pela home/produto) — por isso não entra em
 * `PublicTenant`/`resolveStorefrontTenant` (mesmo raciocínio já aplicado
 * às colunas de Aparência, que também têm sua própria leitura dedicada
 * em vez de ampliar um resolver compartilhado).
 *
 * Retorna `null` sempre que a configuração está incompleta/desabilitada
 * — nunca uma chave parcial. Quem chama decide o que fazer com "sem PIX
 * configurado" (ex.: avisar o cliente em vez de quebrar a seleção).
 */
export const getStorePixSettings = cache(async (tenantId: string): Promise<StorePixSettings | null> => {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("tenants")
    .select("pix_enabled, pix_key, pix_key_type, pix_recipient_name")
    .eq("id", tenantId)
    .maybeSingle();

  if (!data || !data.pix_enabled || !data.pix_key || !data.pix_key_type || !data.pix_recipient_name) return null;

  return {
    pixKey: data.pix_key as string,
    pixKeyType: data.pix_key_type as PixKeyType,
    recipientName: data.pix_recipient_name as string,
  };
});
