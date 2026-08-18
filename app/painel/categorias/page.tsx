import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CatalogTabs } from "@/components/painel/catalog-tabs";
import { CategoryFormDialog } from "@/components/painel/category-form-dialog";
import { CategoryRow, type CategoryRowData } from "@/components/painel/category-row";
import { PanelEmptyState } from "@/components/painel/panel-empty-state";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Categorias — VEXO" };

interface CategoryQueryRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  sort_order: number;
  products: { count: number }[] | null;
}

export default async function CategoriasPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canView }, { data: canCreate }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "categories.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "categories.create" }),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-8">
        <CatalogTabs active="categorias" />
        <PanelEmptyState
          description="Sua função não tem acesso à visualização de categorias."
          icon="lock"
          title="Sem permissão"
        />
      </div>
    );
  }

  const { data } = await supabase
    .from("categories")
    .select("id, name, description, status, sort_order, products(count)")
    .eq("tenant_id", tenant.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const categories: CategoryRowData[] = ((data ?? []) as unknown as CategoryQueryRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    productCount: c.products?.[0]?.count ?? 0,
  }));

  return (
    <div className="flex flex-col gap-8">
      <CatalogTabs active="categorias" />

      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Categorias</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Organize seus produtos por categoria.
          </p>
        </div>
        {canCreate ? (
          <CategoryFormDialog
            trigger={
              <span className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container shadow-[0_0_15px_rgba(124,58,237,0.2)] transition-colors hover:bg-[#8B5CF6]">
                <span className="material-symbols-outlined text-[20px]">add</span>
                Nova categoria
              </span>
            }
          />
        ) : null}
      </div>

      {categories.length === 0 ? (
        <PanelEmptyState
          action={
            canCreate ? (
              <CategoryFormDialog
                trigger={
                  <span className="rounded-lg border border-dashed border-primary/30 px-4 py-2 font-label text-label-md text-primary transition-colors hover:bg-primary/10">
                    Criar primeira categoria
                  </span>
                }
              />
            ) : undefined
          }
          description="Crie categorias para organizar os produtos da sua loja."
          icon="sell"
          title="Nenhuma categoria cadastrada"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
          <div className="grid grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4">
            <div className="col-span-5 font-label text-label-sm uppercase tracking-wider text-on-surface-variant md:col-span-6">
              Nome da categoria
            </div>
            <div className="col-span-2 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Produtos
            </div>
            <div className="col-span-3 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant md:col-span-2">
              Status
            </div>
            {canCreate ? (
              <div className="col-span-2 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Ações
              </div>
            ) : null}
          </div>
          <div className="divide-y divide-surface-container-highest/50">
            {categories.map((category) => (
              <CategoryRow canManage={Boolean(canCreate)} category={category} key={category.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
