/**
 * Mesmo padrão visual de `components/painel/coming-soon.tsx` (Etapa 5) e
 * de `vexo_estados_do_sistema_desktop` (Stitch — ícone em círculo,
 * headline, body) — reaproveitado aqui em vez de recriado, para o
 * storefront público (produtos ainda não existem, loja ainda não
 * configurada).
 */
export function StorefrontEmptyState({
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
    <div className="flex flex-col items-center gap-6 px-margin-mobile py-20 text-center md:px-margin-desktop">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant bg-surface-container-low">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">{icon}</span>
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
        <p className="font-body text-body-md text-on-surface-variant">{description}</p>
      </div>
      {action ?? null}
    </div>
  );
}
