import { OnboardingContinueButton } from "@/components/onboarding/onboarding-continue-button";
import { LivePreviewFrame } from "@/app/painel/aparencia/live-preview-frame";
import type { OnboardingTenant } from "@/features/onboarding/resolve-tenant";
import { isCheckoutMode } from "@/features/settings/checkout-schema";
import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { getStorefrontBanners } from "@/features/storefront/banners";
import { getStorefrontCategories, getStorefrontProducts } from "@/features/storefront/catalog";
import { getStorefrontPromotions } from "@/features/storefront/promotions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface AppearanceRow {
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  storefront_template: string;
  checkout_mode: string;
}

/**
 * D12.2/D12.2.1 — etapa "revisar": reaproveita o MESMO mecanismo de
 * preview ao vivo já usado por `/painel/aparencia` (`LivePreviewFrame` +
 * iframe isolado em `/painel-preview/aparencia`) em vez de construir um
 * preview novo — só a fonte dos dados muda. Funciona com zero produtos/
 * categorias/promoções/banners (D12.2.1: nenhuma etapa anterior é
 * pré-requisito, todas são `skippable`) — `LivePreviewFrame` já renderiza
 * a storefront real, que lida com listas vazias normalmente; um aviso
 * amigável é mostrado quando o catálogo está vazio, em vez de deixar o
 * lojista sem contexto do porquê a prévia parece "em branco".
 * `/painel-preview/aparencia` só exige uma membership ativa
 * (`getCurrentMembership`), nunca onboarding concluído — funciona
 * durante o onboarding sem nenhuma alteração lá.
 */
export async function RevisarStepContent({ tenant, nextHref }: { tenant: OnboardingTenant; nextHref: string }) {
  const supabase = await createSupabaseServerClient();

  const [{ data: appearance }, categories, products, promotions, banners] = await Promise.all([
    supabase
      .from("tenants")
      .select("logo_url, primary_color, secondary_color, storefront_template, checkout_mode")
      .eq("id", tenant.id)
      .maybeSingle<AppearanceRow>(),
    getStorefrontCategories(tenant.id),
    getStorefrontProducts(tenant.id),
    getStorefrontPromotions(tenant.id),
    getStorefrontBanners(tenant.id),
  ]);

  const previewPayload = {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      segment: tenant.segment,
      description: tenant.description,
      instagram_handle: tenant.instagram_handle,
      whatsapp_phone: tenant.whatsapp_phone,
      contact_email: tenant.contact_email,
      logo_url: appearance?.logo_url ?? null,
      primary_color: appearance?.primary_color ?? null,
      secondary_color: appearance?.secondary_color ?? null,
      storefront_template: (appearance?.storefront_template as StorefrontTemplate | undefined) ?? "commerce",
      checkout_mode: isCheckoutMode(appearance?.checkout_mode) ? appearance.checkout_mode : ("vexo" as const),
    },
    categories,
    products,
    promotions,
    banners,
  };

  return (
    <div className="flex flex-col gap-6">
      {products.length === 0 ? (
        <p className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 font-body text-body-sm text-on-surface-variant">
          Sua loja ainda não tem produtos — é normal a prévia abaixo aparecer vazia. Você pode publicar assim mesmo e
          cadastrar produtos depois, direto no painel.
        </p>
      ) : null}
      <div className="h-[480px] w-full overflow-hidden rounded-xl border border-outline-variant/30">
        <LivePreviewFrame payload={previewPayload} publicStoreHref={`/loja/${tenant.slug}`} />
      </div>
      <OnboardingContinueButton nextHref={nextHref} stepKey="revisar" />
    </div>
  );
}
