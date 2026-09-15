import type { BillingGraceStatus } from "@/features/billing/grace-status";

/**
 * JON-17 — feedback visual do modelo de carência: dias 0-3 (`warning`) só
 * avisa, sem impedir nada; dia 4+ (`writes_blocked`) informa que edição
 * está bloqueada — a autoridade real continua sendo `checkBillingWriteAccess`
 * dentro de cada Server Action (`features/billing/access-guard.ts`), este
 * banner nunca decide nada sozinho, só reflete o mesmo cálculo
 * (`computeBillingGraceStatus`) já feito uma vez no layout do painel.
 * Renderizado em toda página sob `/painel/*` (app/painel/layout.tsx),
 * nunca escondido atrás de uma rota específica.
 */
export function BillingGraceBanner({ status, daysElapsed }: { status: BillingGraceStatus; daysElapsed: number }) {
  if (status === "ok") return null;

  const isBlocked = status === "writes_blocked";

  return (
    <div
      className={
        isBlocked
          ? "mb-6 flex items-start gap-3 rounded-lg border border-error/30 bg-error-container/10 px-4 py-3"
          : "mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
      }
      role="alert"
    >
      <span className={`material-symbols-outlined text-xl ${isBlocked ? "text-error" : "text-amber-400"}`}>
        {isBlocked ? "block" : "warning"}
      </span>
      <div className="flex flex-col gap-1">
        <p className={`font-label text-label-md ${isBlocked ? "text-error" : "text-amber-400"}`}>
          {isBlocked
            ? `Edição bloqueada — pagamento pendente há ${daysElapsed} dia${daysElapsed === 1 ? "" : "s"}`
            : `Pagamento pendente há ${daysElapsed} dia${daysElapsed === 1 ? "" : "s"}`}
        </p>
        <p className="font-body text-body-sm text-on-surface-variant">
          {isBlocked
            ? "Produtos, configurações e demais dados do painel não podem ser editados até a assinatura ser regularizada. Sua loja pública continua no ar normalmente."
            : "Regularize sua assinatura para evitar o bloqueio da edição do painel, que acontece a partir do 4º dia de atraso."}
        </p>
      </div>
    </div>
  );
}
