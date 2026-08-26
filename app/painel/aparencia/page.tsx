import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentMembership } from "@/features/painel/current-tenant";
import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { getStorefrontCategories, getStorefrontProducts } from "@/features/storefront/catalog";
import { getStorefrontPromotions } from "@/features/storefront/promotions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppearanceEditor } from "./appearance-editor";

export const metadata: Metadata = { title: "Aparência — VEXO" };

interface AppearanceRow {
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  storefront_template: string;
}

/**
 * Sprint 1 — Fase B3. Substitui `/painel/configuracoes/aparencia` como
 * área principal do painel (nav própria, `components/painel/nav-items.ts`)
 * — a rota antiga vira um redirect (§15: "nenhuma rota existente deve
 * ficar morta"). Mesmo gate (`settings.update`) e mesma leitura das 4
 * colunas de aparência da Fase A; a novidade é buscar também o catálogo
 * REAL do tenant (mesmas funções cacheadas que a loja pública usa —
 * `features/storefront/catalog.ts`/`promotions.ts`) para alimentar o
 * preview ao vivo com os mesmos componentes da storefront, em vez de um
 * preview mockado à parte (§9/§10).
 */
export default async function AparenciaPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canEdit }, { data: appearance }, categories, products, promotions] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.update" }),
    supabase
      .from("tenants")
      .select("logo_url, primary_color, secondary_color, storefront_template")
      .eq("id", tenant.id)
      .maybeSingle<AppearanceRow>(),
    getStorefrontCategories(tenant.id),
    getStorefrontProducts(tenant.id),
    getStorefrontPromotions(tenant.id),
  ]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Aparência</h1>
        <p className="mt-2 font-body text-body-sm text-on-surface-variant">
          Personalize como sua loja é apresentada aos clientes e veja o resultado em tempo real.
        </p>
      </div>

      <AppearanceEditor
        canEdit={Boolean(canEdit)}
        categories={categories}
        initialLogoPath={appearance?.logo_url ?? null}
        initialPrimaryColor={appearance?.primary_color ?? null}
        initialSecondaryColor={appearance?.secondary_color ?? null}
        initialTemplate={(appearance?.storefront_template as StorefrontTemplate | undefined) ?? "commerce"}
        products={products}
        promotions={promotions}
        tenant={{
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          segment: tenant.segment,
          description: tenant.description,
          instagramHandle: tenant.instagram_handle,
          whatsappPhone: tenant.whatsapp_phone,
          contactEmail: tenant.contact_email,
        }}
      />
    </div>
  );
}
