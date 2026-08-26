import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { StorefrontContact } from "./storefront-contact";

/** Fora do componente de propósito: `new Date()` é impura, a regra de pureza do react-compiler barra isso dentro do corpo de um componente. */
function currentYear(): number {
  return new Date().getFullYear();
}

interface FooterVariantStyle {
  wrapper: string;
  name: string;
  description: string;
  linkClassName: string;
  legend: string;
  bottomBorder: string;
}

/**
 * Sprint 1 — Fase B2 §5. UM Footer compartilhado pelos 5 templates —
 * nunca 5 componentes independentes. Os dados exibidos são sempre os
 * mesmos (nome, descrição, Instagram, WhatsApp, e-mail — nada inventado);
 * só a apresentação (fundo claro/escuro, alinhamento, densidade) muda por
 * `variant`.
 */
const VARIANT_STYLES: Record<StorefrontTemplate, FooterVariantStyle> = {
  commerce: {
    wrapper: "bg-neutral-950 text-white",
    name: "font-display text-lg font-bold text-white",
    description: "text-white/60",
    linkClassName: "text-white/70 hover:text-white",
    legend: "text-white/40",
    bottomBorder: "border-white/10",
  },
  premium: {
    wrapper: "bg-white text-neutral-900",
    name: "font-display text-sm font-semibold uppercase tracking-[0.3em] text-neutral-900",
    description: "text-neutral-500",
    linkClassName: "text-neutral-500 hover:text-neutral-900",
    legend: "text-neutral-400",
    bottomBorder: "border-neutral-200",
  },
  minimal: {
    wrapper: "bg-white text-neutral-900",
    name: "font-display text-sm font-medium text-neutral-900",
    description: "text-neutral-400",
    linkClassName: "text-neutral-400 hover:text-neutral-900",
    legend: "text-neutral-300",
    bottomBorder: "border-neutral-100",
  },
  editorial: {
    wrapper: "bg-neutral-50 text-neutral-900",
    name: "font-display text-lg italic text-neutral-900",
    description: "text-neutral-500",
    linkClassName: "text-neutral-500 hover:text-[var(--store-primary)]",
    legend: "text-neutral-400",
    bottomBorder: "border-neutral-200",
  },
  fashion: {
    wrapper: "bg-neutral-950 text-white",
    name: "font-display text-lg font-black uppercase text-[var(--store-primary)]",
    description: "text-white/50",
    linkClassName: "text-white/60 hover:text-white",
    legend: "text-white/30",
    bottomBorder: "border-white/10",
  },
};

export function StorefrontFooter({
  name,
  description,
  instagramHandle,
  whatsappPhone,
  contactEmail,
  variant = "commerce",
}: {
  name: string;
  description: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
  variant?: StorefrontTemplate;
}) {
  const style = VARIANT_STYLES[variant] ?? VARIANT_STYLES.commerce;

  return (
    <footer className={`mt-auto w-full px-margin-mobile py-12 md:px-margin-desktop ${style.wrapper}`}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 md:flex-row md:justify-between">
        <div className="flex max-w-sm flex-col gap-2">
          <span className={style.name}>{name}</span>
          {description ? <p className={`font-body text-body-sm ${style.description}`}>{description}</p> : null}
        </div>
        <StorefrontContact
          contactEmail={contactEmail}
          instagramHandle={instagramHandle}
          linkClassName={style.linkClassName}
          whatsappPhone={whatsappPhone}
        />
      </div>
      <div className={`mx-auto mt-8 flex max-w-container-max flex-col items-center gap-2 border-t pt-8 md:flex-row md:justify-between ${style.bottomBorder}`}>
        <p className={`font-body text-body-sm ${style.description}`}>
          © {currentYear()} {name}
        </p>
        <span className={`font-label text-label-sm ${style.legend}`}>Criado com VEXO</span>
      </div>
    </footer>
  );
}
