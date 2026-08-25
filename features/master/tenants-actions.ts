"use server";

import { revalidatePath } from "next/cache";

import { getCurrentPlatformAdmin } from "./current-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TenantStatusActionState {
  status: "success" | "error";
  message?: string;
}

export type TenantNextStatus = "active" | "suspended";

/**
 * Etapa 18 — único ponto de entrada da aplicação para mudar
 * `tenants.status`. A pré-checagem de MASTER aqui é só uma mensagem
 * amigável antes de ir ao banco (mesmo padrão de `requireMaster()` em
 * features/commercial/actions.ts) — a autoridade real é
 * `public.update_tenant_status` (SECURITY DEFINER, migration
 * 20260817220069), que checa `private.is_platform_master()` de novo
 * internamente e nunca confia só nesta camada.
 */
export async function updateTenantStatusAction(
  tenantId: string,
  nextStatus: TenantNextStatus,
): Promise<TenantStatusActionState> {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) {
    return { status: "error", message: "Acesso restrito à equipe VEXO." };
  }
  if (admin.role !== "MASTER") {
    return { status: "error", message: "Apenas administradores MASTER podem alterar o status de uma loja." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_tenant_status", {
    p_tenant_id: tenantId,
    p_new_status: nextStatus,
  });

  if (error) {
    if (error.message.includes("invalid tenant status transition")) {
      return { status: "error", message: "Essa transição de status não é permitida a partir do status atual." };
    }
    if (error.message.includes("store not found")) {
      return { status: "error", message: "Loja não encontrada." };
    }
    if (error.message.includes("only a MASTER admin")) {
      return { status: "error", message: "Apenas administradores MASTER podem alterar o status de uma loja." };
    }
    if (error.message.includes("changed concurrently")) {
      return { status: "error", message: "O status desta loja mudou nesse instante. Atualize a página e tente novamente." };
    }
    return { status: "error", message: "Não foi possível atualizar o status da loja. Tente novamente." };
  }

  revalidatePath("/master/lojas");
  revalidatePath(`/master/lojas/${tenantId}`);
  return { status: "success", message: "Status atualizado." };
}
