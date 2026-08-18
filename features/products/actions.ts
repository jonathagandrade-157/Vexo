"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import { productSchema, type ProductActionState, type ProductInput } from "./schema";

/** Mesmo checklist/padrão de features/categories/actions.ts — não duplicado como função exportada porque cada domínio checa a permission key própria. */
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

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    promotionalPrice: formData.get("promotionalPrice"),
    sku: formData.get("sku"),
    categoryId: formData.get("categoryId"),
  });
}

function fieldErrorsFrom(
  parsed: ReturnType<typeof parseProductForm>,
): ProductActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: ProductActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof ProductInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("products.create");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const slug = slugify(parsed.data.name);

  const { error } = await supabase.from("products").insert({
    tenant_id: resolved.tenantId,
    category_id: parsed.data.categoryId ?? null,
    name: parsed.data.name,
    slug,
    description: parsed.data.description ?? null,
    price: parsed.data.price,
    promotional_price: parsed.data.promotionalPrice ?? null,
    sku: parsed.data.sku ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe um produto com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    if (error.code === "23514") {
      return { status: "error", message: "Verifique os valores informados (categoria ou preço)." };
    }
    return { status: "error", message: "Não foi possível criar o produto. Tente novamente." };
  }

  revalidatePath("/painel/produtos");
  redirect("/painel/produtos");
}

export async function updateProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const productId = formData.get("productId");
  if (typeof productId !== "string" || productId.length === 0) {
    return { status: "error", message: "Produto inválido." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("products")
    .update(
      {
        category_id: parsed.data.categoryId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        price: parsed.data.price,
        promotional_price: parsed.data.promotionalPrice ?? null,
        sku: parsed.data.sku ?? null,
      },
      { count: "exact" },
    )
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe um produto com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    if (error.code === "23514") {
      return { status: "error", message: "Verifique os valores informados (categoria ou preço)." };
    }
    return { status: "error", message: "Não foi possível salvar o produto. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  redirect("/painel/produtos");
}

export async function deleteProductAction(productId: string): Promise<ProductActionState> {
  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível excluir o produto. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  return { status: "success", message: "Produto excluído." };
}

export async function toggleProductStatusAction(
  productId: string,
  nextStatus: "active" | "inactive",
): Promise<ProductActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("products")
    .update({ status: nextStatus }, { count: "exact" })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  return { status: "success" };
}
