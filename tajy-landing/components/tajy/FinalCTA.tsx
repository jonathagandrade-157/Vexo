import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { RevealOnScroll } from "./RevealOnScroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function FinalCTA() {
  return (
    <section id="contato" className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="space-y-6 rounded-3xl border-2 border-tajy-gold bg-gradient-to-b from-tajy-card via-tajy-surface to-tajy-card p-8 text-center shadow-[0_0_40px_rgba(197,160,89,0.2)] sm:p-14">
        <span className="text-xs font-bold uppercase tracking-[0.35em] text-tajy-gold">Seu Momento É Agora</span>
        <h2 className="font-tajy-serif text-3xl font-bold leading-tight text-white sm:text-5xl">
          Seu novo sorriso começa <br />
          <span className="bg-gradient-to-r from-[#fae5b6] via-tajy-goldLight to-tajy-goldDark bg-clip-text font-normal italic text-transparent">
            com uma conversa.
          </span>
        </h2>
        <p className="mx-auto max-w-xl text-sm font-light leading-relaxed text-neutral-300 sm:text-base">
          Agende sua avaliação e descubra as possibilidades para o seu sorriso.
        </p>
        <div className="pt-4">
          <a
            className="inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-10 py-4 text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_35px_rgba(197,160,89,0.4)] transition-all hover:shadow-[0_0_45px_rgba(197,160,89,0.6)] active:scale-95 sm:py-5 sm:text-sm"
            href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <WhatsAppIcon className="h-5 w-5" />
            <span>Agendar pelo WhatsApp</span>
          </a>
        </div>
      </RevealOnScroll>
    </section>
  );
}
