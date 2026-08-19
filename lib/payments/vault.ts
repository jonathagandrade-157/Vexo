import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { OAuthTokens, PaymentProvider } from "./gateway";

/**
 * Único ponto de acesso ao vault de credenciais (arquitetura §11.1) —
 * nunca chamado de um Client Component, nunca retorna o valor decifrado
 * para fora do servidor que o chamou. `service_role` é usado aqui
 * deliberadamente e só aqui (junto com o Route Handler do webhook) —
 * ver docs/architecture/etapa-11-pagamentos.md, seção "service_role".
 */
export async function storePaymentCredentials(tenantId: string, provider: PaymentProvider, tokens: OAuthTokens): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("store_payment_credentials", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_access_token: tokens.accessToken,
    p_refresh_token: tokens.refreshToken,
    p_expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
  });
  if (error) throw new Error("Não foi possível salvar as credenciais de pagamento.");
}

export async function getPaymentCredentials(
  tenantId: string,
  provider: PaymentProvider,
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("get_payment_credentials", { p_tenant_id: tenantId, p_provider: provider });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.access_token) return null;
  return { accessToken: row.access_token as string, refreshToken: (row.refresh_token as string | null) ?? null };
}

export async function deletePaymentCredentials(tenantId: string, provider: PaymentProvider): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("delete_payment_credentials", { p_tenant_id: tenantId, p_provider: provider });
  if (error) throw new Error("Não foi possível remover as credenciais de pagamento.");
}
