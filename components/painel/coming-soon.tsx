/**
 * Estado "disponível em breve" para seções que pertencem a etapas
 * futuras (arquitetura §3/§4/§8 Etapa 5: manter o item visualmente
 * coerente e indicar que a funcionalidade chega depois, sem implementar
 * antecipadamente). Cada rota que usa isto é uma rota real — funciona
 * após refresh e por URL direta, só não tem funcionalidade ainda.
 */
export function ComingSoon({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant bg-surface-container-low">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">
          {icon}
        </span>
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
        <p className="font-body text-body-md text-on-surface-variant">{description}</p>
      </div>
      <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-label text-label-sm uppercase tracking-wider text-primary">
        Disponível em breve
      </span>
    </div>
  );
}
