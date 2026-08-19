import Link from "next/link";

/** Card informativo do prompt Etapa 14 §21 — "não implementar pagamento do upgrade nesta etapa", só o componente/fluxo. Aponta para /painel/assinatura (ComingSoon, Etapa 5) até a Etapa de cobrança existir. */
export function UpgradeCta({ featureName }: { featureName: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-tertiary/30 bg-tertiary-container/10 px-6 py-12 text-center">
      <span className="material-symbols-outlined text-3xl text-tertiary">workspace_premium</span>
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="font-headline text-headline-sm text-on-surface">Recurso disponível em um plano superior</h2>
        <p className="font-body text-body-md text-on-surface-variant">
          {featureName} não está incluído no seu plano atual. Faça upgrade para liberar esta funcionalidade.
        </p>
      </div>
      <Link
        className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90"
        href="/painel/assinatura"
      >
        Conhecer planos
      </Link>
    </div>
  );
}
