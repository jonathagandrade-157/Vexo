"use client";

import { useState, useTransition } from "react";

import type { TenantDomainRow } from "@/features/settings/domain-actions";
import {
  checkDomainVerification,
  startDomainVerification,
  type CheckDomainVerificationResult,
} from "@/features/settings/domain-verification-actions";
import {
  copyToClipboard,
  DNS_TXT_RECORD_TYPE,
  DNS_TXT_TTL_SECONDS,
  resolveVerificationMessage,
  resolveVerificationUiState,
} from "@/features/settings/domain-verification-messages";

const STATUS_LABELS: Record<TenantDomainRow["status"], string> = {
  pending: "Pendente",
  verifying: "Verificando",
  active: "Ativo",
};

const STATUS_STYLES: Record<TenantDomainRow["status"], string> = {
  pending: "bg-surface-container-highest text-on-surface-variant",
  verifying: "bg-amber-500/10 text-amber-400",
  active: "bg-emerald-500/10 text-emerald-400",
};

/** Mesmo padrão local de `components/storefront/pix-payment-panel.tsx::CopyButton` — cópia pequena, não vale uma abstração compartilhada só para isto. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="flex items-center gap-1.5 rounded-lg border border-outline-variant/50 px-3 py-1.5 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50"
      onClick={() => {
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
        void copyToClipboard(clipboard, value).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      type="button"
    >
      <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Copiado" : label}
    </button>
  );
}

interface VisibleChallenge {
  dnsRecordName: string;
  verificationToken: string;
}

/**
 * D17.3.3 — evolui o item de lista antes estático de `DomainSettingsForm`
 * (D17.2) para o fluxo completo de verificação DNS TXT (D17.3.0/D17.3.1/
 * D17.3.2). Consome exclusivamente as Server Actions já existentes —
 * nenhuma consulta DNS/rede acontece no browser (ticket §7): o único
 * `fetch`/I-O daqui é a chamada da própria Server Action, que roda no
 * servidor.
 *
 * O token em texto puro só existe em memória neste componente entre o
 * momento em que `startDomainVerification` retorna e a próxima navegação/
 * reload — nunca é persistido (D17.3.1/D17.3.2), então uma página
 * recarregada enquanto o domínio já está `verifying` de uma visita anterior
 * não tem como reexibi-lo: o lojista precisa gerar novas instruções
 * ("Ver instruções de DNS", que chama `startDomainVerification` de novo —
 * rotação seguro e idempotente do ponto de vista do backend).
 */
export function DomainVerificationCard({ domain, canEdit }: { domain: TenantDomainRow; canEdit: boolean }) {
  const [challenge, setChallenge] = useState<VisibleChallenge | null>(null);
  const [checkResult, setCheckResult] = useState<CheckDomainVerificationResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStarting, startStartTransition] = useTransition();
  const [isChecking, startCheckTransition] = useTransition();

  if (domain.domainType !== "custom") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
        <span className="break-all font-label text-label-md text-on-surface">{domain.domain}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[domain.status]}`}>
          {STATUS_LABELS[domain.status]}
        </span>
      </li>
    );
  }

  const status = checkResult?.status ?? (challenge ? "verifying" : domain.status);
  const hasChallenge = challenge !== null;
  const expired = Boolean(checkResult?.expired);
  const uiState = resolveVerificationUiState(status, hasChallenge, expired);
  const message = resolveVerificationMessage(status, hasChallenge, checkResult ? { expired: checkResult.expired, reason: checkResult.reason } : undefined);
  const busy = isStarting || isChecking;

  function handleStart() {
    setActionError(null);
    startStartTransition(async () => {
      const result = await startDomainVerification(domain.id);
      if (!result.success || !result.dnsRecordName || !result.verificationToken) {
        setActionError(result.error ?? "Não foi possível iniciar a verificação. Tente novamente.");
        return;
      }
      setChallenge({ dnsRecordName: result.dnsRecordName, verificationToken: result.verificationToken });
      setCheckResult(null);
    });
  }

  function handleCheck() {
    setActionError(null);
    startCheckTransition(async () => {
      const result = await checkDomainVerification(domain.id);
      if (!result.success) {
        setActionError(result.error ?? "Não foi possível verificar o domínio agora. Tente novamente.");
        return;
      }
      setCheckResult(result);
      if (result.expired || result.status === "active") {
        setChallenge(null);
      }
    });
  }

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all font-label text-label-md text-on-surface">
          {domain.domain}
          {domain.isPrimary ? <span className="ml-2 font-body text-body-sm text-on-surface-variant">(primário)</span> : null}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">{message}</p>

      {status === "active" && domain.verifiedAt ? (
        <p className="font-body text-body-sm text-on-surface-variant">Verificado em {new Date(domain.verifiedAt).toLocaleDateString("pt-BR")}</p>
      ) : null}

      {uiState.showChallenge && challenge ? (
        <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <ol className="list-decimal space-y-1 pl-4 font-body text-body-sm text-on-surface-variant">
            <li>Acesse o painel DNS do seu provedor.</li>
            <li>Crie um registro TXT.</li>
            <li>Utilize os dados abaixo.</li>
            <li>Aguarde a propagação.</li>
            <li>Clique em &quot;Verificar domínio&quot;.</li>
          </ol>

          <div>
            <p className="font-label text-label-sm uppercase text-on-surface-variant">Tipo</p>
            <p className="font-body text-body-sm text-on-surface">{DNS_TXT_RECORD_TYPE}</p>
          </div>

          <div>
            <p className="font-label text-label-sm uppercase text-on-surface-variant">Host</p>
            <p className="break-all font-body text-body-sm text-on-surface">{challenge.dnsRecordName}</p>
            <div className="mt-1">
              <CopyButton label="Copiar host" value={challenge.dnsRecordName} />
            </div>
          </div>

          <div>
            <p className="font-label text-label-sm uppercase text-on-surface-variant">Valor</p>
            <p className="break-all font-body text-body-sm text-on-surface">{challenge.verificationToken}</p>
            <div className="mt-1">
              <CopyButton label="Copiar valor" value={challenge.verificationToken} />
            </div>
          </div>

          <div>
            <p className="font-label text-label-sm uppercase text-on-surface-variant">TTL</p>
            <p className="font-body text-body-sm text-on-surface">{DNS_TXT_TTL_SECONDS}</p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          {uiState.showStartButton ? (
            <button
              className="rounded-lg bg-primary-container px-4 py-2 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={handleStart}
              type="button"
            >
              {isStarting ? "Aguarde…" : uiState.startLabel}
            </button>
          ) : null}
          {uiState.showCheckButton ? (
            <button
              className="rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-md text-on-surface transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={handleCheck}
              type="button"
            >
              {isChecking ? "Verificando…" : "Verificar domínio"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
