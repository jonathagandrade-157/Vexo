import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { WhatsAppIcon } from "./WhatsAppIcon";

/**
 * Fixed floating CTA. Text label stays visible on desktop (discreet) and
 * shrinks to an icon-only tap target on small screens so it never
 * overlaps page content or the final CTA button.
 */
export function WhatsAppButton() {
  return (
    <a
      aria-label="Falar agora no WhatsApp"
      className="group fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full border border-emerald-400/40 bg-emerald-600 px-4 py-3.5 text-white shadow-[0_4px_25px_rgba(16,185,129,0.5)] transition-transform hover:scale-105 hover:bg-emerald-500 active:scale-95 sm:bottom-6 sm:right-6 sm:px-5"
      href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      <span className="hidden text-xs font-semibold tracking-wide sm:inline">Agende sua Consulta</span>
      <WhatsAppIcon className="h-4 w-4 fill-white transition-transform group-hover:rotate-12" />
    </a>
  );
}
