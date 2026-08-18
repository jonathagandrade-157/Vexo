import { segmentLabel } from "@/features/settings/segments";

/**
 * Hero da home do storefront — substitui a foto de moda fictícia e o
 * texto "Nova Coleção / Seu estilo começa aqui" do mockup (Stitch) por
 * dado real: nome, segmento, descrição da loja (Etapa 4). Sem imagem de
 * fundo: não existe upload de logo/imagem ainda (arquitetura §13 Etapa
 * 6) — o fundo usa só os tokens de cor/glow do DESIGN.md.
 */
export function StorefrontBrand({
  name,
  segment,
  description,
}: {
  name: string;
  segment: string | null;
  description: string | null;
}) {
  return (
    <section className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden px-margin-mobile py-24 text-center md:px-margin-desktop">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[500px] rounded-full bg-primary-container opacity-[0.08] blur-[120px]" />
      </div>

      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4">
        {segment ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-label text-label-sm uppercase tracking-wider text-primary">
            {segmentLabel(segment)}
          </span>
        ) : null}
        <h1 className="font-display text-display-lg-mobile text-on-surface md:text-display-lg">
          {name}
        </h1>
        {description ? (
          <p className="font-body text-body-lg text-on-surface-variant">{description}</p>
        ) : null}
      </div>
    </section>
  );
}
