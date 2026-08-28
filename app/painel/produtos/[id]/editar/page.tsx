import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ProductForm } from "@/components/painel/product-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar produto — VEXO" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditarProdutoPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const { data: canUpdate } = await supabase.rpc("has_permission", {
    p_tenant_id: tenant.id,
    p_permission_key: "products.update",
  });
  if (!canUpdate) redirect("/painel/produtos");

  // Escopado por tenant_id explicitamente, além da RLS (defesa em
  // profundidade — mesmo padrão de toda Action desta etapa): um id de
  // produto de outro tenant nunca retorna aqui, mesmo que alguém
  // manipule a URL diretamente.
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, price, promotional_price, sku, category_id, main_image, weight, height, width, length")
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (!product) notFound();

  return <ProductForm categories={categories ?? []} product={product} />;
}
