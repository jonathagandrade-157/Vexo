"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  updateOrderStatusSchema,
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
