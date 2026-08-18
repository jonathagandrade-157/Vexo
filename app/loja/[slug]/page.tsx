import type { Metadata } from "next";

import { StorefrontBrand } from "@/components/storefront/storefront-brand";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getPublicEnv } from "@/lib/env";

/**
 * Etapa 6 — cache/revalidação (arquitetura §17): 60s de ISR. Simples de
 * propósito — sem infraestrutura de invalidação sob demanda, sem
 * webhook. Uma edição feita em /painel/configuracoes aparece aqui em até
 * 60 segundos. `createSupabasePublicClient()` (usado por
 * `resolveStorefrontTenant`) não chama `cookies()`, então esta rota fica
 * de fato elegível a essa revalidação por tempo — usar o cliente ligado
 * à sessão aqui forçaria a rota inteira a ser dinâmica sempre.
 */
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
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

export default async function StorefrontPage({ params }: PageProps) {
  const { slug } = await params;
  const resolution = await resolveStorefrontTenant(slug);

  if (resolution.status === "not_found") {
    return <StorefrontNotFound />;
  }

  if (resolution.status === "not_configured") {
    return (
      <StorefrontShell
        footer={{ description: null, instagramHandle: null, whatsappPhone: null, contactEmail: null }}
        storeName={resolution.name}
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

  return (
    <StorefrontShell
      footer={{
        description: tenant.description,
        instagramHandle: tenant.instagram_handle,
        whatsappPhone: tenant.whatsapp_phone,
        contactEmail: tenant.contact_email,
      }}
      storeName={tenant.name}
    >
      <StorefrontBrand description={tenant.description} name={tenant.name} segment={tenant.segment} />
      <StorefrontEmptyState
        description="Em breve, novos produtos por aqui."
        icon="shopping_bag"
        title="Produtos"
      />
    </StorefrontShell>
  );
}
