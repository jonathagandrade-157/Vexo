import { emailLink, instagramLink, whatsappLink } from "@/features/storefront/contact-links";

/**
 * Cada link só aparece se o campo correspondente (Etapa 4) estiver
 * preenchido — nenhum é obrigatório. `linkClassName` (Sprint 1 Fase B2)
 * existe para os 5 footers de template (fundos claro/escuro variados) —
 * default mantém a cor original de antes da Fase B2.
 */
export function StorefrontContact({
  instagramHandle,
  whatsappPhone,
  contactEmail,
  linkClassName = "text-on-surface-variant hover:text-primary",
}: {
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
  linkClassName?: string;
}) {
  const links: { href: string; icon: string; label: string }[] = [];
  if (instagramHandle) {
    links.push({ href: instagramLink(instagramHandle), icon: "photo_camera", label: `@${instagramHandle}` });
  }
  if (whatsappPhone) {
    links.push({ href: whatsappLink(whatsappPhone), icon: "call", label: "WhatsApp" });
  }
  if (contactEmail) {
    links.push({ href: emailLink(contactEmail), icon: "mail", label: contactEmail });
  }

  if (links.length === 0) return null;

  return (
    <ul className="flex flex-col gap-3">
      {links.map((link) => (
        <li key={link.href}>
          <a
            className={`flex items-center gap-2 font-body text-body-sm transition-colors ${linkClassName}`}
            href={link.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="material-symbols-outlined text-[18px]">{link.icon}</span>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
