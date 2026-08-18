"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import { categorySchema, type CategoryActionState, type CategoryInput } from "./schema";

/**
 * Checklist de toda Action de catálogo desta etapa (prompt Etapa 7 §12):
 * 1) sessão/tenant via resolveActiveTenantForUser (nunca tenant_id do
 *    formulário) 2) permission explícita via o wrapper public.has_permission
 *    (Etapa 5) 3) Zod allowlist 4) operação 5) RLS como segunda camada
 *    6) resultado sem detalhe interno de banco.
 */
async function resolveTenantAndPermission(
  permissionKey: string,
): Promise<{ tenantId: string } | { error: string }> {
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

export async function createCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    const fieldErrors: CategoryActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CategoryInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("categories.create");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const slug = slugify(parsed.data.name);

  const { error } = await supabase.from("categories").insert({
    tenant_id: resolved.tenantId,
    name: parsed.data.name,
    slug,
    description: parsed.data.description ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe uma categoria com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível criar a categoria. Tente novamente." };
  }

  revalidatePath("/painel/categorias");
  return { status: "success", message: "Categoria criada." };
}

export async function updateCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const categoryId = formData.get("categoryId");
  if (typeof categoryId !== "string" || categoryId.length === 0) {
    return { status: "error", message: "Categoria inválida." };
  }

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    const fieldErrors: CategoryActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CategoryInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("categories.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("categories")
    .update({ name: parsed.data.name, description: parsed.data.description ?? null }, { count: "exact" })
    .eq("id", categoryId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe uma categoria com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível salvar a categoria. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Categoria não encontrada." };
  }

  revalidatePath("/painel/categorias");
  return { status: "success", message: "Categoria atualizada." };
}

export async function deleteCategoryAction(categoryId: string): Promise<CategoryActionState> {
  const resolved = await resolveTenantAndPermission("categories.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("categories")
    .delete({ count: "exact" })
    .eq("id", categoryId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23503") {
      return {
        status: "error",
        message: "Não é possível excluir uma categoria que possui produtos vinculados.",
      };
    }
    return { status: "error", message: "Não foi possível excluir a categoria. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Categoria não encontrada." };
  }

  revalidatePath("/painel/categorias");
  return { status: "success", message: "Categoria excluída." };
}

export async function toggleCategoryStatusAction(
  categoryId: string,
  nextStatus: "active" | "inactive",
): Promise<CategoryActionState> {
  const resolved = await resolveTenantAndPermission("categories.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("categories")
    .update({ status: nextStatus }, { count: "exact" })
    .eq("id", categoryId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Categoria não encontrada." };
  }

  revalidatePath("/painel/categorias");
  return { status: "success" };
}
