"use client";

import { useEffect, useState } from "react";

import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getStorefrontHomeComponent } from "@/features/storefront/templates/registry";
import {
  APPEARANCE_PREVIEW_READY_MESSAGE_TYPE,
  isAppearancePreviewMessage,
  type AppearancePreviewMessage,
} from "@/features/storefront/preview-message";

/**
 * Sprint 1 — Fase B3 §9/§10. Alvo do `<iframe>` de `live-preview-frame.tsx`
 * — um documento PRÓPRIO (viewport independente), não um `<div>` dentro da
 * página do editor. Isso é o que faz `hidden md:flex`/`grid-cols-2
 * md:grid-cols-4` (usados pelos 5 templates e pelo Header) responderem de
 * verdade ao alternar Desktop/Mobile: media query do Tailwind depende da
 * largura real do viewport, e cada `<iframe>` tem a sua — encolher uma
 * `<div>` no meio do painel NUNCA mudaria o breakpoint. Pelo mesmo motivo,
 * o `<header>` `fixed` da storefront (`storefront-header.tsx`) volta a
 * funcionar exatamente como na loja pública, sem nenhum hack de CSS aqui.
 *
 * Não busca nada no Supabase — recebe o estado inteiro (identidade, cores,
 * modelo, catálogo real já buscado uma única vez pelo Server Component de
 * `/painel/aparencia`) via `postMessage` de `live-preview-frame.tsx`
 * (mesma origem, `targetOrigin`/`event.origin` sempre checados). Nenhuma
 * alteração é persistida a partir daqui — é só leitura/apresentação.
 */
export function PreviewTarget() {
  const [state, setState] = useState<AppearancePreviewMessage | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isAppearancePreviewMessage(event.data)) return;
      setState(event.data);
    }

    window.addEventListener("message", handleMessage);
    // Avisa o pai que já está pronto para receber — evita a corrida de o
    // pai postar a primeira mensagem antes deste listener existir.
    window.parent.postMessage({ type: APPEARANCE_PREVIEW_READY_MESSAGE_TYPE }, window.location.origin);

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!state) {
    return <div className="flex min-h-dvh items-center justify-center bg-white text-sm text-neutral-400">Carregando prévia…</div>;
  }

  const Home = getStorefrontHomeComponent(state.tenant.storefront_template);

  return (
    // Neutraliza qualquer navegação real (produto, carrinho, checkout,
    // Instagram/WhatsApp do rodapé) — Fase B3 §13: "bloquear ou substituir
    // por comportamento de demonstração". `preventDefault` na fase de
    // captura impede o próprio Next `Link` de navegar (ele checa
    // `defaultPrevented` antes de agir), sem precisar tocar em nenhum
    // componente real da storefront.
    <div onClickCapture={(event) => {
      if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
    }}>
      <StorefrontShell
        cartCount={0}
        footer={{
          description: state.tenant.description,
          instagramHandle: state.tenant.instagram_handle,
          whatsappPhone: state.tenant.whatsapp_phone,
          contactEmail: state.tenant.contact_email,
        }}
        logoUrl={state.tenant.logo_url}
        primaryColor={state.tenant.primary_color}
        secondaryColor={state.tenant.secondary_color}
        storefrontTemplate={state.tenant.storefront_template}
        storeName={state.tenant.name}
        storeSlug={state.tenant.slug}
      >
        {/* eslint-disable-next-line react-hooks/static-components -- mesma justificativa de app/loja/[slug]/page.tsx: lookup estático de registry num Client Component sem estado, nunca recriado por render. */}
        <Home
          banners={state.banners}
          categories={state.categories}
          products={state.products}
          promotions={state.promotions}
          tenant={state.tenant}
        />
      </StorefrontShell>
    </div>
  );
}
