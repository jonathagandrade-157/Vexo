"use server";

import { revalidatePath } from "next/cache";

import { getCurrentPlatformAdmin } from "@/features/master/current-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  featureSchema,
  planLimitSchema,
  planSchema,
  type FeatureActionState,
  type FeatureInput,
  type PlanActionState,
  type PlanInput,
  type PlanLimitActionState,
} from "./schema";

/**
 * Pré-checagem amigável — a autoridade real continua sendo a RLS
 * (`private.is_platform_master()`, migration 20260817220052): mesmo que
 * este checklist tivesse um bug, a policy de `plans`/`features`/
 * `plan_features` ainda bloqueia quem não é MASTER (defesa em
 * profundidade, mesmo padrão de toda Action deste projeto desde a Etapa
 * 5). SUPPORT_AGENT tem `is_platform_admin() = true` (acessa `/master`)
 * mas não `MASTER` — não pode escrever configuração comercial (prompt
 * §14/§26).
 */
async function requireMaster(): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) return { ok: false, error: "Acesso restrito à equipe VEXO." };
  if (admin.role !== "MASTER") {
    return { ok: false, error: "Apenas administradores MASTER podem alterar planos e recursos." };
  }
  return { ok: true };
}

function planFieldErrorsFrom(parsed: ReturnType<typeof planSchema.safeParse>): PlanActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: PlanActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof PlanInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

function parsePlanForm(formData: FormData) {
  return planSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    description: formData.get("description"),
    monthlyPrice: formData.get("monthlyPrice"),
    yearlyPrice: formData.get("yearlyPrice"),
    trialDays: formData.get("trialDays") || 30,
    sortOrder: formData.get("sortOrder") || 0,
    isFeatured: formData.get("isFeatured") === "on",
  });
}

export async function createPlanAction(_prevState: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const parsed = parsePlanForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: planFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("plans").insert({
    slug: parsed.data.slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    monthly_price: parsed.data.monthlyPrice ?? null,
    yearly_price: parsed.data.yearlyPrice ?? null,
    trial_days: parsed.data.trialDays,
    sort_order: parsed.data.sortOrder,
    is_featured: parsed.data.isFeatured,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { slug: "Já existe um plano com esse slug." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível criar o plano. Tente novamente." };
  }

  revalidatePath("/master/planos");
  return { status: "success", message: "Plano criado." };
}

export async function updatePlanAction(
  planId: string,
  _prevState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const parsed = parsePlanForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: planFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("plans")
    .update(
      {
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        monthly_price: parsed.data.monthlyPrice ?? null,
        yearly_price: parsed.data.yearlyPrice ?? null,
        trial_days: parsed.data.trialDays,
        sort_order: parsed.data.sortOrder,
        is_featured: parsed.data.isFeatured,
      },
      { count: "exact" },
    )
    .eq("id", planId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { slug: "Já existe um plano com esse slug." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível salvar o plano. Tente novamente." };
  }
  if (!count) return { status: "error", message: "Plano não encontrado." };

  revalidatePath("/master/planos");
  revalidatePath(`/master/planos/${planId}`);
  return { status: "success", message: "Plano atualizado." };
}

export async function togglePlanActiveAction(planId: string, nextActive: boolean): Promise<PlanActionState> {
  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("plans")
    .update({ is_active: nextActive }, { count: "exact" })
    .eq("id", planId);

  if (error) return { status: "error", message: "Não foi possível atualizar o plano. Tente novamente." };
  if (!count) return { status: "error", message: "Plano não encontrado." };

  revalidatePath("/master/planos");
  return { status: "success" };
}

function featureFieldErrorsFrom(parsed: ReturnType<typeof featureSchema.safeParse>): FeatureActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: FeatureActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof FeatureInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

function parseFeatureForm(formData: FormData) {
  return featureSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.get("category"),
  });
}

export async function createFeatureAction(_prevState: FeatureActionState, formData: FormData): Promise<FeatureActionState> {
  const parsed = parseFeatureForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: featureFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("features").insert({
    key: parsed.data.key,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    category: parsed.data.category ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { key: "Já existe um recurso com essa chave." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível criar o recurso. Tente novamente." };
  }

  revalidatePath("/master/recursos");
  return { status: "success", message: "Recurso criado." };
}

export async function updateFeatureAction(
  featureId: string,
  _prevState: FeatureActionState,
  formData: FormData,
): Promise<FeatureActionState> {
  const parsed = parseFeatureForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: featureFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("features")
    .update(
      {
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
      },
      { count: "exact" },
    )
    .eq("id", featureId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { key: "Já existe um recurso com essa chave." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível salvar o recurso. Tente novamente." };
  }
  if (!count) return { status: "error", message: "Recurso não encontrado." };

  revalidatePath("/master/recursos");
  return { status: "success", message: "Recurso atualizado." };
}

export async function toggleFeatureActiveAction(featureId: string, nextActive: boolean): Promise<FeatureActionState> {
  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("features")
    .update({ is_active: nextActive }, { count: "exact" })
    .eq("id", featureId);

  if (error) return { status: "error", message: "Não foi possível atualizar o recurso. Tente novamente." };
  if (!count) return { status: "error", message: "Recurso não encontrado." };

  revalidatePath("/master/recursos");
  return { status: "success" };
}

/**
 * A tela central do prompt §19 — liga/desliga um recurso para um plano.
 * `plan_features` não tem UPDATE (só existe/não existe, migration
 * 20260817220053): habilitar é um INSERT, desabilitar é um DELETE.
 */
export async function togglePlanFeatureAction(
  planId: string,
  featureId: string,
  enabled: boolean,
): Promise<{ status: "success" | "error"; message?: string }> {
  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();

  if (enabled) {
    const { error } = await supabase.from("plan_features").insert({ plan_id: planId, feature_id: featureId });
    if (error && error.code !== "23505") {
      return { status: "error", message: "Não foi possível liberar o recurso para este plano." };
    }
  } else {
    const { error } = await supabase.from("plan_features").delete().eq("plan_id", planId).eq("feature_id", featureId);
    if (error) return { status: "error", message: "Não foi possível remover o recurso deste plano." };
  }

  revalidatePath(`/master/planos/${planId}`);
  return { status: "success" };
}

/**
 * Cria OU atualiza um limite (ajuste arquitetural — `unique(plan_id,
 * limit_key)`, migration 20260817220058, faz o upsert funcionar como
 * "definir o valor desta chave", nunca duplicando linha). MASTER-only,
 * mesma defesa em profundidade das demais Actions deste arquivo.
 */
export async function upsertPlanLimitAction(
  planId: string,
  _prevState: PlanLimitActionState,
  formData: FormData,
): Promise<PlanLimitActionState> {
  const parsed = planLimitSchema.safeParse({
    limitKey: formData.get("limitKey"),
    limitValue: formData.get("limitValue"),
  });
  if (!parsed.success) {
    const fieldErrors: PlanLimitActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "limitKey" | "limitValue";
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("plan_limits")
    .upsert(
      { plan_id: planId, limit_key: parsed.data.limitKey, limit_value: parsed.data.limitValue },
      { onConflict: "plan_id,limit_key" },
    );

  if (error) return { status: "error", message: "Não foi possível salvar o limite. Tente novamente." };

  revalidatePath(`/master/planos/${planId}`);
  return { status: "success", message: "Limite salvo." };
}

export async function deletePlanLimitAction(planId: string, limitId: string): Promise<PlanLimitActionState> {
  const auth = await requireMaster();
  if (!auth.ok) return { status: "error", message: auth.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase.from("plan_limits").delete({ count: "exact" }).eq("id", limitId).eq("plan_id", planId);

  if (error) return { status: "error", message: "Não foi possível remover o limite. Tente novamente." };
  if (!count) return { status: "error", message: "Limite não encontrado." };

  revalidatePath(`/master/planos/${planId}`);
  return { status: "success" };
}
