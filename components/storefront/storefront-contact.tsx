import { emailLink, instagramLink, whatsappLink } from "@/features/storefront/contact-links";

/** Cada link só aparece se o campo correspondente (Etapa 4) estiver preenchido — nenhum é obrigatório. */
export function StorefrontContact({
  instagramHandle,
  whatsappPhone,
  contactEmail,
}: {
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
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
            className="flex items-center gap-2 font-body text-body-sm text-on-surface-variant transition-colors hover:text-primary"
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
