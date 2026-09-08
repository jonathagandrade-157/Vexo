import type { HistoryLogRow as HistoryLogRowData } from "@/features/history/data";
import { buildHistoryEventDescription, resolveHistoryActionLabel, resolveHistoryActorLabel, resolveHistoryEntityLabel } from "@/features/history/messages";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * D18.4 — só leitura, mesmo princípio de `components/master/audit-log-row.tsx`
 * (`audit_logs` é append-only, nenhuma ação de editar/excluir existe aqui).
 * Diferente daquele componente, este NUNCA renderiza `before`/`after`/
 * `metadata` brutos (Fase 2 §9/§13 — "NÃO renderizar JSON bruto para o
 * usuário") — só os rótulos amigáveis de `features/history/messages.ts`,
 * que já leem esses campos internamente sem nunca serializá-los para a
 * tela. Componente server-renderável (sem `"use client"`): não há nenhum
 * estado local (sem expandir/recolher), então não precisa de interatividade.
 */
export function HistoryLogRow({ log }: { log: HistoryLogRowData }) {
  return (
    <li className="grid grid-cols-12 items-center gap-4 border-b border-surface-container-highest/50 px-6 py-4 last:border-b-0">
      <div className="col-span-6 sm:col-span-2">
        <div className="font-body text-body-sm text-on-surface">{formatDateTime(log.createdAt)}</div>
      </div>
      <div className="col-span-6 sm:col-span-2">
        <div className="font-body text-body-sm text-on-surface">{resolveHistoryActorLabel(log)}</div>
      </div>
      <div className="col-span-12 sm:col-span-3">
        <div className="font-body text-body-sm font-medium text-on-surface">{resolveHistoryActionLabel(log.action)}</div>
      </div>
      <div className="col-span-6 sm:col-span-2">
        <div className="font-body text-body-sm text-on-surface-variant">{resolveHistoryEntityLabel(log.resourceType)}</div>
      </div>
      <div className="col-span-6 sm:col-span-3">
        <div className="font-body text-body-sm text-on-surface-variant">{buildHistoryEventDescription(log)}</div>
      </div>
    </li>
  );
}
