import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { RevealOnScroll } from "./RevealOnScroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

/**
 * Only the six treatments the brief explicitly confirms — nothing else
 * is invented, even though the Stitch export's card grid had a 7th
 * ("Tratamento Clínico Completo") that isn't on that confirmed list.
 */
const TREATMENTS = [
  {
    name: "Lentes em Resina",
    description:
      "Correção milimétrica de formato, cor e proporção dental de forma minimamente invasiva e com visual natural.",
    featured: true,
    icon: (
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    ),
  },
  {
    name: "Lentes de Porcelana",
    description:
      "Máxima durabilidade, brilho cerâmico premium e estabilidade de cor para quem prioriza longevidade.",
    featured: false,
    icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  },
  {
    name: "Clareamento Dental",
    description:
      "Protocolos de consultório e caseiro assistido para iluminar o sorriso com previsibilidade e conforto.",
    featured: false,
    icon: (
      <>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </>
    ),
  },
  {
    name: "Harmonização Orofacial",
    description: "Equilíbrio harmônico entre sorriso e contornos faciais, valorizando a expressão natural.",
    featured: false,
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  {
    name: "Implantes Dentários",
    description: "Restauração da função mastigatória e da confiança do sorriso com tecnologia guiada.",
    featured: false,
    icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
  {
    name: "Odontologia Estética",
    description: "Planejamento estético completo do sorriso, unindo técnica apurada e sensibilidade artística.",
    featured: false,
    icon: <path d="M12 4.5c-2-2.5-5.5-2.5-7.5-.5s-1.5 5 0 7.5l7.5 8 7.5-8c1.5-2.5 2-5.5 0-7.5s-5.5-2-7.5.5z" />,
  },
] as const;

export function Treatments() {
  return (
    <section id="tratamentos" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="mx-auto mb-16 max-w-3xl space-y-3 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">Procedimentos</span>
        <h2 className="font-tajy-serif text-3xl font-bold text-white sm:text-4xl">
          Cuidado completo para o seu sorriso
        </h2>
        <p className="text-sm font-light text-neutral-400 sm:text-base">
          Soluções estéticas planejadas com sensibilidade artística e precisão técnica.
        </p>
      </RevealOnScroll>

      <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3">
        {TREATMENTS.map((treatment, i) => (
          <RevealOnScroll
            key={treatment.name}
            delayMs={i * 80}
            className={`group relative flex flex-col justify-between rounded-3xl p-6 shadow-xl transition-all duration-300 sm:p-8 ${
              treatment.featured
                ? "border-2 border-tajy-gold/50 bg-gradient-to-b from-tajy-surface to-tajy-card hover:border-tajy-gold"
                : "border border-tajy-gold/10 bg-tajy-surface hover:border-tajy-gold/40"
            }`}
          >
            {treatment.featured && (
              <span className="absolute right-4 top-4 rounded-full bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black shadow-sm">
                Mais Procurado
              </span>
            )}
            <div>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-tajy-gold/30 bg-tajy-gold/10 text-tajy-gold transition-transform group-hover:scale-105">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  {treatment.icon}
                </svg>
              </div>
              <h3 className="mb-2 font-tajy-serif text-xl font-bold text-white">{treatment.name}</h3>
              <p className="text-xs font-light leading-relaxed text-neutral-300 sm:text-sm">
                {treatment.description}
              </p>
            </div>
            <div className="mt-6 border-t border-tajy-gold/10 pt-6">
              <a
                className="inline-flex items-center gap-2 text-xs font-semibold text-tajy-gold transition-colors hover:text-tajy-goldLight"
                href={createWhatsAppLink(WHATSAPP_MESSAGES.treatment(treatment.name))}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Saiba mais</span>
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </RevealOnScroll>
        ))}
      </div>

      <div className="mt-12 text-center">
        <a
          className="inline-flex items-center gap-2.5 rounded-xl border border-tajy-gold px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-tajy-gold transition-all duration-300 hover:bg-tajy-gold hover:text-black"
          href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Falar com a Clínica</span>
          <WhatsAppIcon />
        </a>
      </div>
    </section>
  );
}
