import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface StoreAddress {
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * D3.1 §2/§5: endereço da loja para retirada — fonte oficial é
 * `tenants.address_*` (nunca `shipping_settings.origin_zip`, e nunca uma
 * segunda cópia do endereço em `shipping_methods`). Leitura pública (anon),
 * mesmo padrão de `getStorePixSettings` — RLS de `tenants` é por linha,
 * não por coluna, então nenhuma policy nova é necessária.
 *
 * Retorna `null` quando o endereço está incompleto (loja ainda não
 * preencheu tudo em Configurações) — quem chama decide o que fazer com
 * "sem endereço de retirada configurado" (ex.: não oferecer pickup no
 * checkout), nunca inventa ou completa o endereço.
 */
export const getStoreAddress = cache(async (tenantId: string): Promise<StoreAddress | null> => {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("tenants")
    .select("address_zip, address_street, address_number, address_complement, address_neighborhood, address_city, address_state")
    .eq("id", tenantId)
    .maybeSingle();

  if (
    !data ||
    !data.address_zip ||
    !data.address_street ||
    !data.address_number ||
    !data.address_neighborhood ||
    !data.address_city ||
    !data.address_state
  ) {
    return null;
  }

  return {
    zip: data.address_zip,
    street: data.address_street,
    number: data.address_number,
    complement: data.address_complement,
    neighborhood: data.address_neighborhood,
    city: data.address_city,
    state: data.address_state,
  };
});
