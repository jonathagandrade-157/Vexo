import type { ReactNode } from "react";

import { StorefrontFooter } from "./storefront-footer";
import { StorefrontHeader } from "./storefront-header";

interface FooterData {
  description: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
}

/**
 * Casca comum aos Estados 2 e 3 (arquitetura §6 Etapa 6) — cabeçalho com
 * o nome da loja sempre presente (é o único dado que ambos os estados
 * têm), rodapé só recebe os campos de contato quando existem (Estado 2
 * passa tudo `null`, já que a loja ainda não foi configurada).
 */
export function StorefrontShell({
  storeName,
  storeSlug,
  cartCount = 0,
  searchQuery,
  footer,
  children,
}: {
  storeName: string;
  storeSlug: string;
  cartCount?: number;
  searchQuery?: string;
  footer: FooterData;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <StorefrontHeader cartCount={cartCount} searchQuery={searchQuery} storeName={storeName} storeSlug={storeSlug} />
      <main className="flex-1 pt-16">{children}</main>
      <StorefrontFooter
        contactEmail={footer.contactEmail}
        description={footer.description}
        instagramHandle={footer.instagramHandle}
        name={storeName}
        whatsappPhone={footer.whatsappPhone}
      />
    </div>
  );
}
