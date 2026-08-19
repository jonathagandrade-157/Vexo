import { StorefrontContact } from "./storefront-contact";

/** Fora do componente de propósito: `new Date()` é impura, a regra de pureza do react-compiler barra isso dentro do corpo de um componente (mesmo padrão de app/painel/page.tsx, Etapa 5). */
function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * Substitui o footer de 4 colunas do mockup (About/Contact/Privacy/Terms,
 * FAQ/Entregas/Rastrear Pedido/Guia de Tamanhos, newsletter) — quase tudo
 * lá depende de páginas que não existem (política de privacidade, termos)
 * ou de funcionalidades futuras (pedidos, frete). Fica só marca + contato
 * real + copyright, nada inventado.
 */
export function StorefrontFooter({
  name,
  description,
  instagramHandle,
  whatsappPhone,
  contactEmail,
}: {
  name: string;
  description: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
}) {
  return (
    <footer className="mt-auto w-full border-t border-outline-variant bg-surface-container-lowest px-margin-mobile py-12 md:px-margin-desktop">
      <div className="mx-auto flex max-w-container-max flex-col gap-8 md:flex-row md:justify-between">
        <div className="flex max-w-sm flex-col gap-2">
          <span className="font-headline text-headline-sm text-on-surface">{name}</span>
          {description ? (
            <p className="font-body text-body-sm text-on-surface-variant">{description}</p>
          ) : null}
        </div>
        <StorefrontContact
          contactEmail={contactEmail}
          instagramHandle={instagramHandle}
          whatsappPhone={whatsappPhone}
        />
      </div>
      <div className="mx-auto mt-8 flex max-w-container-max flex-col items-center gap-2 border-t border-outline-variant/30 pt-8 md:flex-row md:justify-between">
        <p className="font-body text-body-sm text-on-surface-variant">
          © {currentYear()} {name}
        </p>
        <span className="font-label text-label-sm text-on-surface-variant opacity-60">Criado com VEXO</span>
      </div>
    </footer>
  );
}
