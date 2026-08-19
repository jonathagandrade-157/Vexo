"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  shippingMethodSchema,
  shippingSettingsSchema,
  type ShippingMethodActionState,
  type ShippingMethodInput,
  type ShippingSettingsActionState,
  type ShippingSettingsInput,
} from "./schema";

const SETTINGS_PATH = "/painel/configuracoes/entrega";

/** Mesmo checklist de toda Action de catálogo/pagamentos (Etapa 7 §12 / Etapa 11): sessão via resolveActiveTenantForUser, permission explícita via has_permission, Zod allowlist, RLS como segunda camada. */
async function resolveTenantAndPermission(permissionKey: string): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: permissionKey,
  });
  if (!allowed) {
    return { error: "Você não tem permissão para esta ação." };
  }

  return { tenantId: membership.tenant.id };
}

/**
 * `shipping_settings` tem `tenant_id` como PK (uma linha por loja) — usa
 * upsert por `tenant_id` porque a linha pode não existir ainda (loja nunca
 * configurou frete). Reaproveita `settings.update` (mesma permissão de
 * `updateStoreProfileAction`), sem criar permissão nova.
 */
export async function updateShippingSettingsAction(
  _prevState: ShippingSettingsActionState,
  formData: FormData,
): Promise<ShippingSettingsActionState> {
  const parsed = shippingSettingsSchema.safeParse({ originZip: formData.get("originZip") });
  if (!parsed.success) {
    const fieldErrors: ShippingSettingsActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ShippingSettingsInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shipping_settings")
    .upsert({ tenant_id: resolved.tenantId, origin_zip: parsed.data.originZip ?? null }, { onConflict: "tenant_id" });

  if (error) {
    return { status: "error", message: "Não foi possível salvar as configurações de entrega. Tente novamente." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success", message: "Configurações de entrega salvas." };
}

/** Liga/desliga a entrega da loja — ação própria, não um campo do formulário (mesmo padrão de toggleCategoryStatusAction). Upsert pelo mesmo motivo de updateShippingSettingsAction: a linha pode não existir ainda. */
export async function toggleShippingEnabledAction(enabled: boolean): Promise<ShippingSettingsActionState> {
  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shipping_settings")
    .upsert({ tenant_id: resolved.tenantId, enabled }, { onConflict: "tenant_id" });

  if (error) {
    return { status: "error", message: "Não foi possível atualizar. Tente novamente." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success" };
}

function methodFieldErrorsFrom(parsed: ReturnType<typeof shippingMethodSchema.safeParse>) {
  if (parsed.success) return undefined;
  const fieldErrors: ShippingMethodActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof ShippingMethodInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createShippingMethodAction(
  _prevState: ShippingMethodActionState,
  formData: FormData,
): Promise<ShippingMethodActionState> {
  const parsed = shippingMethodSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
    estimatedDays: formData.get("estimatedDays"),
    sortOrder: formData.get("sortOrder") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: methodFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("shipping_methods").insert({
    tenant_id: resolved.tenantId,
    type: "flat_rate",
    name: parsed.data.name,
    price: parsed.data.price,
    estimated_days: parsed.data.estimatedDays ?? null,
    sort_order: parsed.data.sortOrder ?? 0,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe uma modalidade com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível criar a modalidade de entrega. Tente novamente." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success", message: "Modalidade de entrega criada." };
}

export async function updateShippingMethodAction(
  _prevState: ShippingMethodActionState,
  formData: FormData,
): Promise<ShippingMethodActionState> {
  const methodId = formData.get("methodId");
  if (typeof methodId !== "string" || methodId.length === 0) {
    return { status: "error", message: "Modalidade inválida." };
  }

  const parsed = shippingMethodSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
    estimatedDays: formData.get("estimatedDays"),
    sortOrder: formData.get("sortOrder") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: methodFieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("shipping_methods")
    .update(
      {
        name: parsed.data.name,
        price: parsed.data.price,
        estimated_days: parsed.data.estimatedDays ?? null,
        sort_order: parsed.data.sortOrder ?? 0,
      },
      { count: "exact" },
    )
    .eq("id", methodId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe uma modalidade com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível salvar a modalidade. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Modalidade não encontrada." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success", message: "Modalidade atualizada." };
}

export async function deleteShippingMethodAction(methodId: string): Promise<ShippingMethodActionState> {
  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("shipping_methods")
    .delete({ count: "exact" })
    .eq("id", methodId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível excluir a modalidade. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Modalidade não encontrada." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success" };
}

export async function toggleShippingMethodStatusAction(
  methodId: string,
  nextStatus: "active" | "inactive",
): Promise<ShippingMethodActionState> {
  const resolved = await resolveTenantAndPermission("settings.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("shipping_methods")
    .update({ status: nextStatus }, { count: "exact" })
    .eq("id", methodId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Modalidade não encontrada." };
  }

  revalidatePath(SETTINGS_PATH);
  return { status: "success" };
}
