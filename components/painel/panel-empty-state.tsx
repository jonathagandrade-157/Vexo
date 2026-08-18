/**
 * Estado vazio de uma lista que EXISTE e está implementada (nenhuma
 * categoria/produto cadastrado ainda) — distinto de `ComingSoon`
 * (Etapa 5), que é para seções que ainda NÃO existem. Mesmo padrão
 * visual (ícone em círculo + headline + body), sem o selo "Disponível em
 * breve".
 */
export function PanelEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant bg-surface-container-low">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">{icon}</span>
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
        <p className="font-body text-body-md text-on-surface-variant">{description}</p>
      </div>
      {action}
    </div>
  );
}
