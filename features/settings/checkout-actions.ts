"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkoutModeSchema, type CheckoutModeActionState } from "./checkout-schema";

const PEDIDOS_SETTINGS_PATH = "/painel/configuracoes/pedidos";

/**
 * Fase D1. Mesmo checklist de toda Action de configuração (Etapa 7 §12 /
 * Etapa 11/12 — shipping/payments): sessão via resolveActiveTenantForUser
 * (nunca tenant_id de formulário), permissão explícita via has_permission
 * (`settings.update` — a mesma que já governa perfil da loja, aparência e
 * frete; não uma permissão nova), RLS de `tenants` (Etapa 2) como segunda
 * camada. Cópia local, não compartilhada com `appearance-actions.ts` —
 * mesmo padrão de shipping/payments, cada domínio com seu próprio resolver
 * e sua própria mensagem de erro (esta não é "aparência").
 */
async function resolveTenantAndPermission(): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.update",
  });
  if (!allowed) {
    return { error: "Você não tem permissão para alterar como esta loja recebe pedidos." };
  }

  return { tenantId: membership.tenant.id };
}

/**
 * Fase D1 — só grava a escolha do modo (`tenants.checkout_mode`). Nenhum
 * comportamento de checkout muda ao salvar isto ainda: o fluxo WhatsApp
 * (D2) e o modo combinado (D2/D3) continuam sem implementação real — esta
 * Action só prepara a configuração para quando existirem.
 */
export async function updateCheckoutModeAction(
  _prevState: CheckoutModeActionState,
  formData: FormData,
): Promise<CheckoutModeActionState> {
  const parsed = checkoutModeSchema.safeParse({ checkoutMode: formData.get("checkoutMode") });
  if (!parsed.success) {
    return { status: "error", message: "Selecione uma opção válida." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tenants")
    .update({ checkout_mode: parsed.data.checkoutMode })
    .eq("id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath(PEDIDOS_SETTINGS_PATH);
  return { status: "success", message: "Preferência de pedidos salva." };
}
