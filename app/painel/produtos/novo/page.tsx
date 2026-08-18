import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProductForm } from "@/components/painel/product-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Adicionar produto — VEXO" };

export default async function NovoProdutoPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const { data: canCreate } = await supabase.rpc("has_permission", {
    p_tenant_id: tenant.id,
    p_permission_key: "products.create",
  });
  if (!canCreate) redirect("/painel/produtos");

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .eq("status", "active")
    .order("name", { ascending: true });

  return <ProductForm categories={categories ?? []} />;
}
