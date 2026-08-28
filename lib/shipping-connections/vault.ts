import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { ShippingConnectionProvider, ShippingOAuthTokens } from "./gateway";

/**
 * Único ponto de acesso ao vault de credenciais de frete (mesmo desenho
 * de lib/payments/vault.ts, Etapa 11) — nunca chamado de um Client
 * Component, nunca retorna o valor decifrado para fora do servidor que o
 * chamou. `service_role` é usado aqui deliberadamente e só aqui.
 */
export async function storeShippingCredentials(
  tenantId: string,
  provider: ShippingConnectionProvider,
  tokens: ShippingOAuthTokens,
): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("store_shipping_credentials", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_access_token: tokens.accessToken,
    p_refresh_token: tokens.refreshToken,
    p_expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
    p_refresh_expires_at: tokens.refreshExpiresAt ? tokens.refreshExpiresAt.toISOString() : null,
  });
  if (error) throw new Error("Não foi possível salvar as credenciais de frete.");
}

export interface ShippingCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
}

export async function getShippingCredentials(
  tenantId: string,
  provider: ShippingConnectionProvider,
): Promise<ShippingCredentials | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("get_shipping_credentials", { p_tenant_id: tenantId, p_provider: provider });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.access_token) return null;
  return {
    accessToken: row.access_token as string,
    refreshToken: (row.refresh_token as string | null) ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at as string) : null,
  };
}

export async function deleteShippingCredentials(tenantId: string, provider: ShippingConnectionProvider): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("delete_shipping_credentials", { p_tenant_id: tenantId, p_provider: provider });
  if (error) throw new Error("Não foi possível remover as credenciais de frete.");
}
