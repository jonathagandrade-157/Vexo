import type { ReactNode } from "react";

import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { buildStoreThemeStyle } from "@/lib/color/store-theme";
import { StorefrontFooter } from "./storefront-footer";
import { StorefrontHeader } from "./storefront-header";

interface FooterData {
  description: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
}

/**
 * Casca comum a TODAS as rotas da storefront (Home, carrinho, checkout,
 * confirmação de pedido — arquitetura §6 Etapa 6). Sprint 1 Fase B2: além
 * do cabeçalho/rodapé, agora também é o único ponto que aplica a
 * identidade visual do tenant — `logoUrl`/`primaryColor`/`secondaryColor`
 * viram CSS custom properties (`buildStoreThemeStyle`) escopadas a ESTE
 * `<div>`, nunca ao `:root`/layout raiz do app, então nunca vazam para
 * `/painel`/`/master` nem para a árvore de outra loja renderizada em
 * outra requisição. `storefrontTemplate` só troca a apresentação do
 * Header/Footer (§4/§5) — carrinho/checkout continuam a mesma lógica e o
 * mesmo conteúdo interno para qualquer template (Sprint 1 Fase B2 §11).
 */
export function StorefrontShell({
  storeName,
  storeSlug,
  cartCount = 0,
  searchQuery,
  footer,
  logoUrl = null,
  primaryColor = null,
  secondaryColor = null,
  storefrontTemplate = "commerce",
  children,
}: {
  storeName: string;
  storeSlug: string;
  cartCount?: number;
  searchQuery?: string;
  footer: FooterData;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  storefrontTemplate?: StorefrontTemplate;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col" style={buildStoreThemeStyle(primaryColor, secondaryColor)}>
      <StorefrontHeader
        cartCount={cartCount}
        logoUrl={logoUrl}
        searchQuery={searchQuery}
        storeName={storeName}
        storeSlug={storeSlug}
        variant={storefrontTemplate}
      />
      <main className="flex-1 pt-16">{children}</main>
      <StorefrontFooter
        contactEmail={footer.contactEmail}
        description={footer.description}
        instagramHandle={footer.instagramHandle}
        name={storeName}
        variant={storefrontTemplate}
        whatsappPhone={footer.whatsappPhone}
      />
    </div>
  );
}
