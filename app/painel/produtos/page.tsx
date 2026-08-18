import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CatalogTabs } from "@/components/painel/catalog-tabs";
import { PanelEmptyState } from "@/components/painel/panel-empty-state";
import { ProductActions } from "@/components/painel/product-actions";
import { formatPrice } from "@/features/products/format-price";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Produtos — VEXO" };

interface ProductQueryRow {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  promotional_price: number | null;
  status: "active" | "inactive";
  main_image: string | null;
  category: { name: string } | { name: string }[] | null;
}

function categoryName(category: ProductQueryRow["category"]): string {
  const c = Array.isArray(category) ? category[0] : category;
  return c?.name ?? "Sem categoria";
}

export default async function ProdutosPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canView }, { data: canCreate }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "products.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "products.create" }),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-8">
        <CatalogTabs active="produtos" />
        <PanelEmptyState
          description="Sua função não tem acesso à visualização de produtos."
          icon="lock"
          title="Sem permissão"
        />
      </div>
    );
  }

  const { data } = await supabase
    .from("products")
    .select("id, name, sku, price, promotional_price, status, main_image, category:categories(name)")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false });

  const products = (data ?? []) as unknown as ProductQueryRow[];

  return (
    <div className="flex flex-col gap-8">
      <CatalogTabs active="produtos" />

      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Produtos</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Gerencie seu catálogo e mantenha sua loja sempre atualizada.
          </p>
        </div>
        {canCreate ? (
          <Link
            className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container shadow-[0_0_15px_rgba(124,58,237,0.2)] transition-colors hover:bg-[#8B5CF6]"
            href="/painel/produtos/novo"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Adicionar produto
          </Link>
        ) : null}
      </div>

      {products.length === 0 ? (
        <PanelEmptyState
          action={
            canCreate ? (
              <Link
                className="rounded-lg border border-dashed border-primary/30 px-4 py-2 font-label text-label-md text-primary transition-colors hover:bg-primary/10"
                href="/painel/produtos/novo"
              >
                Adicionar meu primeiro produto
              </Link>
            ) : undefined
          }
          description="Você ainda não possui produtos cadastrados."
          icon="inventory_2"
          title="Nenhum produto cadastrado"
        />
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212] md:block">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-surface-container-highest bg-surface-container-low/50">
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Imagem</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Produto</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Categoria</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Preço</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</th>
                  <th className="p-4 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-highest">
                {products.map((product) => (
                  <tr className="transition-colors hover:bg-[#1E1E1E]/50" key={product.id}>
                    <td className="p-4">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-surface-container-highest bg-surface-container-highest">
                        <span className="material-symbols-outlined text-outline">image</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-label text-label-md text-on-surface">{product.name}</div>
                      {product.sku ? (
                        <div className="font-body text-body-sm text-on-surface-variant">SKU: {product.sku}</div>
                      ) : null}
                    </td>
                    <td className="p-4 font-body text-body-sm text-on-surface-variant">
                      {categoryName(product.category)}
                    </td>
                    <td className="p-4 font-label text-label-md text-on-surface">
                      {product.promotional_price !== null ? (
                        <div className="flex flex-col">
                          <span className="text-on-surface-variant line-through">{formatPrice(product.price)}</span>
                          <span>{formatPrice(product.promotional_price)}</span>
                        </div>
                      ) : (
                        formatPrice(product.price)
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={
                          product.status === "active"
                            ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
                            : "inline-flex items-center rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
                        }
                      >
                        {product.status === "active" ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="p-4">
                      {canCreate ? (
                        <ProductActions productId={product.id} productName={product.name} status={product.status} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {products.map((product) => (
              <div
                className="flex items-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] p-3"
                key={product.id}
              >
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest">
                  <span className="material-symbols-outlined text-outline">image</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-label text-label-md text-on-surface">{product.name}</h3>
                  </div>
                  <div className="mt-0.5 font-body text-body-sm text-on-surface-variant">
                    {product.promotional_price !== null ? formatPrice(product.promotional_price) : formatPrice(product.price)}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={
                        product.status === "active"
                          ? "rounded bg-emerald-500/10 px-2 py-0.5 font-label text-label-sm uppercase text-emerald-400"
                          : "rounded bg-surface-container-highest px-2 py-0.5 font-label text-label-sm uppercase text-on-surface-variant"
                      }
                    >
                      {product.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                    {canCreate ? (
                      <ProductActions productId={product.id} productName={product.name} status={product.status} />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
