import { RevealOnScroll } from "./RevealOnScroll";

const DIFFERENTIALS = [
  {
    title: "Atendimento Personalizado",
    description: "Atenção dedicada do primeiro contato até o pós-tratamento.",
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  {
    title: "Planejamento Individual",
    description: "Análise criteriosa da anatomia, proporção e formato de cada sorriso.",
    icon: <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />,
  },
  {
    title: "Tecnologia",
    description: "Ferramentas digitais aplicadas ao diagnóstico e ao planejamento do tratamento.",
    icon: <path d="M4 4h16v12H4zM8 20h8M12 16v4" />,
  },
  {
    title: "Resultados Naturais",
    description: "Sorrisos equilibrados, sem aspecto artificial ou excesso de opacidade.",
    icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  },
  {
    title: "Ambiente Sofisticado",
    description: "Espaço pensado para o conforto e a privacidade de cada visita.",
    icon: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />,
  },
  {
    title: "Experiência do Paciente",
    description: "Escuta atenta das expectativas em cada etapa do tratamento.",
    icon: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  },
] as const;

export function Differentials() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="mx-auto mb-16 max-w-3xl space-y-3 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">Diferenciais</span>
        <h2 className="font-tajy-serif text-3xl font-bold text-white sm:text-4xl">Por que escolher a Tajy?</h2>
        <p className="text-sm font-light text-neutral-400 sm:text-base">
          Compromisso com a sua satisfação, segurança e beleza autêntica.
        </p>
      </RevealOnScroll>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {DIFFERENTIALS.map((item, i) => (
          <RevealOnScroll
            key={item.title}
            delayMs={i * 60}
            className="rounded-2xl border border-tajy-gold/10 bg-tajy-surface p-6 transition-colors hover:border-tajy-gold/40"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-tajy-gold/10 text-tajy-gold">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                {item.icon}
              </svg>
            </div>
            <h4 className="text-base font-bold text-white">{item.title}</h4>
            <p className="mt-2 text-xs font-light leading-relaxed text-neutral-400 sm:text-sm">
              {item.description}
            </p>
          </RevealOnScroll>
        ))}
      </div>
    </section>
  );
}
