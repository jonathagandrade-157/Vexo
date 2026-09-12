import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { ResultsGallery } from "./ResultsGallery";
import { RevealOnScroll } from "./RevealOnScroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function Results() {
  return (
    <section id="resultados" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="mx-auto mb-12 max-w-3xl space-y-3 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">
          Transformações Reais
        </span>
        <h2 className="font-tajy-serif text-3xl font-bold text-white sm:text-4xl">
          Resultados que transformam sorrisos
        </h2>
        <p className="text-sm font-light text-neutral-400 sm:text-base">
          Arraste o marcador para comparar o antes e o depois de um tratamento em lentes em resina.
        </p>
      </RevealOnScroll>

      <RevealOnScroll className="rounded-3xl border border-tajy-gold/20 bg-tajy-card p-6 shadow-2xl sm:p-10">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <BeforeAfterSlider />
          </div>

          <div className="space-y-6 text-center lg:col-span-4 lg:text-left">
            <blockquote className="font-tajy-serif text-sm italic leading-relaxed text-neutral-300">
              Resultados reais que devolvem a segurança de sorrir com naturalidade.
            </blockquote>
            <a
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-6 py-4 text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_20px_rgba(197,160,89,0.3)] transition-all hover:brightness-110 active:scale-[0.98]"
              href={createWhatsAppLink(WHATSAPP_MESSAGES.results)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon />
              <span>Quero Transformar Meu Sorriso</span>
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-tajy-gold/10 pt-10">
          <ResultsGallery />
        </div>
      </RevealOnScroll>
    </section>
  );
}
