import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { PlaceholderImage } from "./PlaceholderImage";
import { RevealOnScroll } from "./RevealOnScroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

const TRUST_BADGES = [
  { eyebrow: "Exclusivo", label: "Atendimento Personalizado" },
  { eyebrow: "Harmonia", label: "Resultados Naturais" },
  { eyebrow: "Padrão Ouro", label: "Alta Precisão Clínica" },
  { eyebrow: "Segurança", label: "Confiança no Processo" },
];

export function Hero() {
  return (
    <section
      id="hero"
      className="relative mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-12 lg:px-8 lg:pt-16"
    >
      <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <RevealOnScroll className="space-y-6 text-center sm:space-y-8 lg:col-span-7 lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-tajy-gold/20 bg-tajy-surface px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tajy-gold sm:text-xs">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tajy-gold" />
            Odontologia de Alta Precisão &amp; Estética
          </div>

          <h1 className="font-tajy-serif text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl xl:text-6xl">
            Seu sorriso pode <br />
            <span className="bg-gradient-to-r from-[#fae5b6] via-tajy-goldLight to-tajy-goldDark bg-clip-text font-normal italic text-transparent">
              começar aqui.
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-base font-light leading-relaxed text-neutral-300 sm:text-lg lg:mx-0">
            Odontologia estética com planejamento, precisão e cuidado em cada detalhe.
          </p>

          <div className="space-y-3 pt-2">
            <a
              className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-8 py-4 text-xs font-semibold uppercase tracking-widest text-black shadow-[0_0_25px_rgba(197,160,89,0.35)] transition-all hover:shadow-[0_0_35px_rgba(197,160,89,0.5)] active:scale-95 sm:w-auto sm:text-sm"
              href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon className="h-5 w-5" />
              <span>Agendar pelo WhatsApp</span>
            </a>
            <a
              href="#sobre"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-tajy-gold/30 px-8 py-4 text-xs font-semibold uppercase tracking-widest text-tajy-goldLight transition-colors hover:bg-tajy-gold/10 sm:ml-3 sm:mt-0 sm:w-auto"
            >
              Conheça a Clínica
            </a>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-tajy-gold/10 pt-6 text-left sm:grid-cols-4">
            {TRUST_BADGES.map((badge) => (
              <div key={badge.label} className="rounded-lg border border-white/5 bg-tajy-surface/60 p-3">
                <span className="mb-1 block text-xs font-semibold uppercase text-tajy-gold">
                  {badge.eyebrow}
                </span>
                <p className="text-xs font-medium leading-tight text-neutral-300">{badge.label}</p>
              </div>
            ))}
          </div>
        </RevealOnScroll>

        <RevealOnScroll delayMs={120} className="relative lg:col-span-5">
          <div className="relative mx-auto max-w-md rounded-3xl border border-tajy-gold/20 bg-gradient-to-b from-tajy-surface to-tajy-deep p-2 shadow-2xl lg:max-w-none">
            <div className="relative h-[440px] overflow-hidden rounded-2xl border border-tajy-gold/30 sm:h-[520px]">
              <PlaceholderImage label="Foto premium da clínica ou de um sorriso Tajy" icon="smile" className="absolute inset-0" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-tajy-gold/20 bg-tajy-black/85 p-4 backdrop-blur-md">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-tajy-gold">
                  Filosofia Tajy
                </span>
                <p className="font-tajy-serif text-sm italic text-white">
                  Cuidar do seu sorriso é cuidar da sua história.
                </p>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
