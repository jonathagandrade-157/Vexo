"use server";

import { revalidatePath } from "next/cache";

import { getCurrentPlatformAdmin } from "./current-admin";
import type { TenantPlanActionState } from "./schema";
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

/**
 * Etapa 20.1 — troca o plano comercial de uma loja. Diferente de
 * `updateTenantStatusAction`, não existe (nem é necessária) uma RPC
 * SECURITY DEFINER aqui: a auditoria da Fase 1/Etapa 20 confirmou que
 * `subscriptions` já tem policy de UPDATE restrita a
 * `private.is_platform_master()` (migration 20260817220054) — a mesma
 * defesa em profundidade de sempre (esta pré-checagem é só UX; a RLS é
 * quem realmente bloqueia SUPPORT_AGENT/OWNER/ADMIN). `tenant_id` é
 * protegido à parte por `private.prevent_tenant_id_change` — esta Action
 * nunca precisa (nem tenta) tocá-lo. `tenant_access_status`,
 * `tenant_has_feature` e `tenant_plan_limit` leem `subscriptions.plan_id`
 * ao vivo a cada chamada, então nenhuma outra tabela precisa ser
 * atualizada para o novo plano "valer" — só esta única coluna.
 *
 * Não cria uma subscription nova quando a loja ainda não tem uma: cria
 * ambiguidade de billing_cycle/período que esta etapa não define, então
 * fica como erro explícito (nunca um INSERT silencioso).
 */
export async function updateTenantPlanAction(
  tenantId: string,
  _prevState: TenantPlanActionState,
  formData: FormData,
): Promise<TenantPlanActionState> {
  const planId = String(formData.get("planId") ?? "").trim();
  if (!planId) {
    return { status: "error", message: "Selecione um plano." };
  }

  const admin = await getCurrentPlatformAdmin();
  if (!admin) {
    return { status: "error", message: "Acesso restrito à equipe VEXO." };
  }
  if (admin.role !== "MASTER") {
    return { status: "error", message: "Apenas administradores MASTER podem alterar o plano de uma loja." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: tenant } = await supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (!tenant) {
    return { status: "error", message: "Loja não encontrada." };
  }

  const { data: plan } = await supabase.from("plans").select("id, is_active").eq("id", planId).maybeSingle();
  if (!plan) {
    return { status: "error", message: "Plano não encontrado." };
  }
  if (!plan.is_active) {
    return { status: "error", message: "Este plano está inativo e não pode ser atribuído a uma loja." };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, plan_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!subscription) {
    return {
      status: "error",
      message: "Esta loja ainda não possui uma assinatura — a troca de plano exige uma assinatura já existente.",
    };
  }
  if (subscription.plan_id === planId) {
    return { status: "error", message: "A loja já está neste plano." };
  }

  const { error, count } = await supabase
    .from("subscriptions")
    .update({ plan_id: planId }, { count: "exact" })
    .eq("id", subscription.id);

  if (error) {
    return { status: "error", message: "Não foi possível alterar o plano da loja. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Assinatura não encontrada." };
  }

  revalidatePath("/master/lojas");
  revalidatePath(`/master/lojas/${tenantId}`);
  revalidatePath("/master/planos");
  return { status: "success", message: "Plano alterado com sucesso." };
}
