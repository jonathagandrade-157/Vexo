import { PlaceholderImage } from "./PlaceholderImage";
import { RevealOnScroll } from "./RevealOnScroll";

const PILLARS = [
  {
    title: "Confiança Absoluta",
    description: "Transparência clínica e acompanhamento em cada etapa do tratamento.",
  },
  {
    title: "Biossegurança Rigorosa",
    description: "Protocolos de esterilização e padrão de assepsia em todo o atendimento.",
  },
  {
    title: "Estética e Arte",
    description: "Planejamento que respeita o perfil e a individualidade de cada paciente.",
  },
  {
    title: "Atendimento Humanizado",
    description: "Acolhimento com foco no conforto e na tranquilidade de quem nos visita.",
  },
];

export function About() {
  return (
    <section id="sobre" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="relative overflow-hidden rounded-3xl border border-tajy-gold/20 shadow-2xl">
        <div className="absolute inset-0">
          <PlaceholderImage label="Ambiente da Clínica Tajy" icon="clinic" className="h-full w-full" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-tajy-black/95 via-tajy-black/85 to-tajy-black/95" />

        <div className="relative grid grid-cols-1 items-center gap-10 p-8 sm:p-12 lg:grid-cols-12 lg:p-16">
          <div className="space-y-6 lg:col-span-8">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">
              Sobre a Clínica Tajy
            </span>
            <h2 className="font-tajy-serif text-3xl font-bold leading-tight text-white sm:text-4xl">
              Mais do que odontologia. Uma experiência.
            </h2>
            <p className="text-sm font-light leading-relaxed text-neutral-300 sm:text-base">
              Na Clínica Tajy, cada sorriso é planejado de forma personalizada, buscando resultados naturais e
              harmônicos que valorizem a individualidade de cada paciente.
            </p>
            <div className="rounded-2xl border border-tajy-gold/30 bg-black/60 px-6 py-5 backdrop-blur-sm">
              <p className="font-tajy-serif text-lg italic leading-relaxed text-tajy-goldLight sm:text-xl">
                &ldquo;Cuidar do seu sorriso é cuidar da sua história.&rdquo;
              </p>
              <span className="mt-2 block text-xs uppercase tracking-widest text-neutral-400">
                — Filosofia Clínica Tajy
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:col-span-4">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-xl border border-tajy-gold/20 bg-tajy-surface/80 p-4 backdrop-blur-sm"
              >
                <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
                  <span className="h-2 w-2 rounded-full bg-tajy-gold" aria-hidden="true" />
                  {pillar.title}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-neutral-400">{pillar.description}</p>
              </div>
            ))}
          </div>
        </div>
      </RevealOnScroll>
    </section>
  );
}
