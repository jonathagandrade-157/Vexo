import type { Metadata } from "next";

import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getCart } from "@/features/cart/data";
import { getStorefrontBanners } from "@/features/storefront/banners";
import { getStorefrontCategories, getStorefrontProducts } from "@/features/storefront/catalog";
import { getStorefrontPromotions } from "@/features/storefront/promotions";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getStorefrontHomeComponent } from "@/features/storefront/templates/registry";
import { getPublicEnv } from "@/lib/env";

/**
 * Etapa 6 — cache/revalidação (arquitetura §17): era 60s de ISR. Etapa 9:
 * o contador do carrinho no header depende de `cookies()` (via
 * `getCart`), que o Next trata como API dinâmica sempre — a rota inteira
 * deixa de ser elegível a ISR a partir de agora (evolução documentada no
 * relatório da Etapa 9; a nuance anterior, sobre `searchParams`, fica
 * subsumida por esta).
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ categoria?: string; q?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await resolveStorefrontTenant(slug);
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const canonical = `${NEXT_PUBLIC_SITE_URL}/loja/${slug}`;

  if (resolution.status === "not_found") {
    return { title: "Loja não encontrada — VEXO", robots: { index: false, follow: false } };
  }

  if (resolution.status === "not_configured") {
    return {
      title: `${resolution.name} — VEXO`,
      robots: { index: false, follow: false },
      alternates: { canonical },
    };
  }

  const { tenant } = resolution;
  const description = tenant.description ?? `Loja online de ${tenant.name}, criada com VEXO.`;

  return {
    title: `${tenant.name} — Loja Online`,
    description,
    alternates: { canonical },
    openGraph: {
      title: tenant.name,
      description,
      url: canonical,
      type: "website",
    },
  };
}

export default async function StorefrontPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { categoria, q } = await searchParams;
  const resolution = await resolveStorefrontTenant(slug);

  if (resolution.status === "not_found") {
    return <StorefrontNotFound />;
  }

  if (resolution.status === "not_configured") {
    return (
      <StorefrontShell
        footer={{ description: null, instagramHandle: null, whatsappPhone: null, contactEmail: null }}
        storeName={resolution.name}
        storeSlug={slug}
      >
        <StorefrontEmptyState
          description="O proprietário ainda está configurando esta loja. Volte em breve."
          icon="storefront"
          title="Esta loja ainda está sendo configurada"
        />
      </StorefrontShell>
    );
  }

  const { tenant } = resolution;
  const [categories, products, promotions, banners, cart] = await Promise.all([
    getStorefrontCategories(tenant.id),
    getStorefrontProducts(tenant.id, categoria, q),
    getStorefrontPromotions(tenant.id),
    getStorefrontBanners(tenant.id),
    getCart(tenant.slug),
  ]);

  // Sprint 1 — Fase B2 §3: a Home nunca sabe QUAL template está ativo por
  // um `if` espalhado pela página — o registry decide, esta página só
  // resolve os dados (uma vez, iguais para os 5) e entrega para quem foi
  // escolhido em `tenants.storefront_template`.
  const StorefrontHome = getStorefrontHomeComponent(tenant.storefront_template);

  return (
    <StorefrontShell
      cartCount={cart.itemCount}
      footer={{
        description: tenant.description,
        instagramHandle: tenant.instagram_handle,
        whatsappPhone: tenant.whatsapp_phone,
        contactEmail: tenant.contact_email,
      }}
      logoUrl={tenant.logo_url}
      primaryColor={tenant.primary_color}
      searchQuery={q}
      secondaryColor={tenant.secondary_color}
      storefrontTemplate={tenant.storefront_template}
      storeName={tenant.name}
      storeSlug={tenant.slug}
    >
      {/* Sem produtos/categorias: cada template já mostra seu próprio estado vazio, consistente com a própria cor/tipografia — nunca o StorefrontEmptyState genérico (tokens escuros do app), que quebraria visualmente os 4 templates de fundo claro. */}
      {/* eslint-disable-next-line react-hooks/static-components -- falso positivo: Server Component sem hooks; `StorefrontHome` é sempre uma das 5 referências já existentes no mapa estático de registry.ts, nunca uma definição nova por render. */}
      <StorefrontHome
        activeCategorySlug={categoria}
        banners={banners}
        categories={categories}
        products={products}
        promotions={promotions}
        searchQuery={q}
        tenant={tenant}
      />
    </StorefrontShell>
  );
}
