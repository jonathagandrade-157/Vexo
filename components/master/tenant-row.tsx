"use client";

import Link from "next/link";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { updateTenantStatusAction, type TenantNextStatus } from "@/features/master/tenants-actions";
import { segmentLabel } from "@/features/settings/segments";
import type { MasterTenantRow } from "@/features/master/tenants-data";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  pending: "Pendente",
  suspended: "Suspensa",
  deleted: "Excluída",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  pending: "bg-amber-500/10 text-amber-400",
  suspended: "bg-error/10 text-error",
  deleted: "bg-surface-container-highest text-on-surface-variant",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

/** Único próximo status válido a partir do atual (espelha a máquina de estados de `public.update_tenant_status`) — `null` quando não há ação disponível (ex.: `deleted`). */
function nextStatusFor(status: string): { next: TenantNextStatus; label: string } | null {
  if (status === "pending") return { next: "active", label: "Ativar" };
  if (status === "active") return { next: "suspended", label: "Suspender" };
  if (status === "suspended") return { next: "active", label: "Reativar" };
  return null;
}

/** Etapa 18 — linha da listagem `/master/lojas`. `canManage` só é `true` para MASTER (nunca SUPPORT_AGENT, que só visualiza) — decidido pela página, nunca por este componente. */
export function TenantRow({ tenant, canManage }: { tenant: MasterTenantRow; canManage: boolean }) {
  const action = nextStatusFor(tenant.status);

  return (
    <div className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-[#1E1E1E]">
      <div className="col-span-12 sm:col-span-3">
        <Link className="font-body text-body-md font-medium text-on-surface hover:text-tertiary" href={`/master/lojas/${tenant.id}`}>
          {tenant.name}
        </Link>
        <div className="font-body text-body-sm text-on-surface-variant">
          {segmentLabel(tenant.segment)} · criada em {formatDate(tenant.createdAt)}
        </div>
      </div>

      <div className="col-span-12 sm:col-span-3">
        <div className="font-body text-body-sm text-on-surface">{tenant.ownerName ?? "—"}</div>
        <div className="font-body text-body-sm text-on-surface-variant">{tenant.ownerEmail ?? "—"}</div>
      </div>

      <div className="col-span-6 sm:col-span-2">
        <div className="font-body text-body-sm text-on-surface">{tenant.planName ?? "Sem plano"}</div>
        <div className="font-body text-body-sm text-on-surface-variant">
          {tenant.trialStatus ? `Trial ${tenant.trialStatus === "active" ? "até" : "encerrado em"} ${tenant.trialEndsAt ? formatDate(tenant.trialEndsAt) : "—"}` : "Sem trial"}
        </div>
      </div>

      <div className="col-span-6 flex justify-center sm:col-span-1">
        <span
          className={`rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[tenant.status] ?? "bg-surface-container-highest text-on-surface-variant"}`}
        >
          {STATUS_LABELS[tenant.status] ?? tenant.status}
        </span>
      </div>

      <div className="col-span-12 flex flex-wrap items-center justify-end gap-3 sm:col-span-3">
        <Link
          className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-tertiary"
          href={`/master/lojas/${tenant.id}`}
        >
          Ver detalhes
        </Link>
        {canManage && action ? (
          <ConfirmDialog
            confirmLabel={action.label}
            description={`Tem certeza que deseja ${action.label.toLowerCase()} a loja "${tenant.name}"?`}
            onConfirm={() => updateTenantStatusAction(tenant.id, action.next)}
            title={`${action.label} loja`}
            trigger={
              <span className="rounded-lg border border-outline-variant/50 px-3 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:border-tertiary/50 hover:text-tertiary">
                {action.label}
              </span>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
