"use client";

import { useState, useTransition } from "react";

import { checkVercelDomainStatus, registerDomainOnVercel, type VercelDomainStatus } from "@/features/settings/domain-vercel-actions";
import { isRegisterAction, resolveVercelPrimaryActionLabel, resolveVercelStatusLabel, resolveVercelStatusMessage } from "@/features/settings/domain-vercel-messages";

const STATUS_STYLES: Record<VercelDomainStatus, string> = {
  not_registered: "bg-surface-container-highest text-on-surface-variant",
  registering: "bg-amber-500/10 text-amber-400",
  registered: "bg-emerald-500/10 text-emerald-400",
  configuration_error: "bg-error-container/10 text-error",
  certificate_error: "bg-error-container/10 text-error",
  unknown: "bg-amber-500/10 text-amber-400",
};

/**
 * D17.5.1 — só renderizado por `DomainVerificationCard` quando o domínio
 * já está `active` no VEXO (posse comprovada por DNS TXT, D17.3) — nunca
 * antes disso (`registerDomainOnVercel`/`checkVercelDomainStatus` também
 * já recusam um domínio não `active`, esta é só a segunda camada na UI).
 *
 * Sempre acionado pelo lojista clicando no botão — nenhum polling
 * automático (ticket D17.5.1, Fase I). Nunca mostra token, header
 * `Authorization`, stack trace ou qualquer ID interno — só o rótulo de
 * estado e a mensagem já mapeada em `domain-vercel-messages.ts`.
 */
export function VercelBindingSection({
  domainId,
  canEdit,
  initialStatus,
}: {
  domainId: string;
  canEdit: boolean;
  initialStatus: VercelDomainStatus;
}) {
  const [status, setStatus] = useState<VercelDomainStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAction() {
    setError(null);
    const action = isRegisterAction(status) ? registerDomainOnVercel : checkVercelDomainStatus;
    startTransition(async () => {
      const result = await action(domainId);
      if (result.vercelDomainStatus) setStatus(result.vercelDomainStatus);
      if (!result.success) {
        setError(result.error ?? "Não foi possível concluir a configuração na Vercel agora. Tente novamente.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-label text-label-sm uppercase text-on-surface-variant">Configuração na Vercel</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[status]}`}>
          {resolveVercelStatusLabel(status)}
        </span>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">{resolveVercelStatusMessage(status)}</p>

      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <div>
          <button
            className="rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-md text-on-surface transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={handleAction}
            type="button"
          >
            {isPending ? "Aguarde…" : resolveVercelPrimaryActionLabel(status)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
