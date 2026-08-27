"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  confirmExternalPaymentSchema,
  updateOrderStatusSchema,
  type ConfirmExternalPaymentActionState,
  type UpdateOrderStatusActionState,
} from "./schema";

/**
 * Único caminho de escrita do painel — sempre resolve tenant/sessão do
 * servidor (nunca de formulário), mesmo checklist de toda Action deste
 * projeto (Etapa 7 §12). A permissão `orders.update` é checada de novo
 * aqui, mas a autoridade final continua sendo a checagem interna de
 * `update_order_status` (RPC, migration 20260817220051) — esta camada é
 * só para devolver uma mensagem amigável antes de chamar o banco.
 */
export async function updateOrderStatusAction(
  orderId: string,
  _prevState: UpdateOrderStatusActionState,
  formData: FormData,
): Promise<UpdateOrderStatusActionState> {
  const parsed = updateOrderStatusSchema.safeParse({
    newStatus: formData.get("newStatus"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Status inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { status: "error", message: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "orders.update",
  });
  if (!allowed) {
    return { status: "error", message: "Você não tem permissão para alterar pedidos." };
  }

  const { error } = await supabase.rpc("update_order_status", {
    p_tenant_id: membership.tenant.id,
    p_order_id: orderId,
    p_new_status: parsed.data.newStatus,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    if (error.message.includes("invalid order status transition")) {
      return { status: "error", message: "Essa transição de status não é permitida a partir do status atual." };
    }
    if (error.message.includes("order not found")) {
      return { status: "error", message: "Pedido não encontrado." };
    }
    return { status: "error", message: "Não foi possível atualizar o status do pedido. Tente novamente." };
  }

  revalidatePath("/painel/pedidos");
  revalidatePath(`/painel/pedidos/${orderId}`);
  return { status: "success", message: "Status do pedido atualizado." };
}

/**
 * Fase D2-B.3 — confirmação manual de pagamento externo (PIX direto/
 * dinheiro/cartão via WhatsApp). Mesmo padrão de `updateOrderStatusAction`:
 * a checagem de permissão aqui é só para uma mensagem amigável, a
 * autoridade real é `confirm_external_payment` (RPC, migration
 * 20260817220085), que reexige e valida tudo de novo no servidor —
 * inclusive a interseção `orders.update AND payments.view` (decisão de
 * produto explícita: nem uma nem outra sozinha é suficiente).
 */
export async function confirmExternalPaymentAction(
  orderId: string,
  reason: string,
): Promise<ConfirmExternalPaymentActionState> {
  const parsed = confirmExternalPaymentSchema.safeParse({ reason });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Informe o motivo da confirmação." };
  }

  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { status: "error", message: "Nenhuma loja configurada para esta conta." };
  }

  const [{ data: canUpdateOrders }, { data: canViewPayments }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: membership.tenant.id, p_permission_key: "orders.update" }),
    supabase.rpc("has_permission", { p_tenant_id: membership.tenant.id, p_permission_key: "payments.view" }),
  ]);
  if (!canUpdateOrders || !canViewPayments) {
    return { status: "error", message: "Você não tem permissão para confirmar pagamentos." };
  }

  const { error } = await supabase.rpc("confirm_external_payment", {
    p_tenant_id: membership.tenant.id,
    p_order_id: orderId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.message.includes("external payment orders")) {
      return { status: "error", message: "Esta ação só pode ser usada em pedidos com pagamento externo." };
    }
    if (error.message.includes("order not found")) {
      return { status: "error", message: "Pedido não encontrado." };
    }
    return { status: "error", message: "Não foi possível confirmar o pagamento. Tente novamente." };
  }

  revalidatePath("/painel/pedidos");
  revalidatePath(`/painel/pedidos/${orderId}`);
  return { status: "success", message: "Pagamento confirmado." };
}
