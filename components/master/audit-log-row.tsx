"use client";

import { useState } from "react";

import type { AuditLogRow as AuditLogRowData } from "@/features/master/audit-data";

/**
 * D11.2 — rótulo legível para cada `action` (mesmo princípio de
 * `AUDIT_ACTION_LABELS` em `app/painel/pedidos/[id]/page.tsx`, aqui
 * estendido para cobrir toda a lista de `AUDIT_ACTIONS` em vez de só as 3
 * relevantes a pedidos). Uma ação sem entrada aqui ainda aparece — só sem
 * tradução (`action` bruto), nunca escondida.
 */
const ACTION_LABELS: Record<string, string> = {
  BILLING_INVOICE_CREATED: "Fatura de assinatura criada",
  BILLING_PAYMENT_CONFIRMED: "Pagamento de assinatura confirmado",
  BILLING_PAYMENT_FAILED: "Pagamento de assinatura falhou",
  BILLING_SUBSCRIPTION_CANCELLED: "Assinatura da VEXO cancelada",
  BILLING_SUBSCRIPTION_SUSPENDED: "Assinatura da VEXO suspensa",
  CATEGORY_CREATED: "Categoria criada",
  CATEGORY_DELETED: "Categoria excluída",
  CATEGORY_UPDATED: "Categoria atualizada",
  FEATURE_CREATED: "Recurso criado",
  FEATURE_UPDATED: "Recurso atualizado",
  ORDER_CREATED: "Pedido criado",
  ORDER_PAYMENT_CONFIRMED: "Pagamento de pedido confirmado",
  ORDER_STATUS_CHANGED: "Status do pedido alterado",
  PAYMENT_APPROVED: "Pagamento aprovado",
  PAYMENT_CANCELLED: "Pagamento cancelado",
  PAYMENT_CONNECTION_CREATED: "Conexão de pagamento criada",
  PAYMENT_CONNECTION_REMOVED: "Conexão de pagamento removida",
  PAYMENT_CREATED: "Pagamento criado",
  PAYMENT_REFUNDED: "Pagamento reembolsado",
  PAYMENT_REJECTED: "Pagamento rejeitado",
  PAYMENT_UPDATED: "Pagamento atualizado",
  PLAN_ACTIVATED: "Plano ativado",
  PLAN_CREATED: "Plano criado",
  PLAN_DEACTIVATED: "Plano desativado",
  PLAN_FEATURE_DISABLED: "Recurso desabilitado no plano",
  PLAN_FEATURE_ENABLED: "Recurso habilitado no plano",
  PLAN_LIMIT_REMOVED: "Limite do plano removido",
  PLAN_LIMIT_SET: "Limite do plano definido",
  PLAN_LIMIT_UPDATED: "Limite do plano atualizado",
  PLAN_UPDATED: "Plano atualizado",
  PRODUCT_CREATED: "Produto criado",
  PRODUCT_DELETED: "Produto excluído",
  PRODUCT_IMAGE_DELETED: "Imagem de produto excluída",
  PRODUCT_IMAGE_UPDATED: "Imagem de produto atualizada",
  PRODUCT_IMAGE_UPLOADED: "Imagem de produto enviada",
  PRODUCT_STATUS_CHANGED: "Status do produto alterado",
  PRODUCT_UPDATED: "Produto atualizado",
  SHIPPING_METHOD_CREATED: "Método de frete criado",
  SHIPPING_METHOD_DELETED: "Método de frete excluído",
  SHIPPING_METHOD_UPDATED: "Método de frete atualizado",
  SHIPPING_PROVIDER_CONNECTION_CREATED: "Conexão de frete criada",
  SHIPPING_PROVIDER_CONNECTION_REMOVED: "Conexão de frete removida",
  SHIPPING_SETTINGS_UPDATED: "Configurações de frete atualizadas",
  TENANT_CREATED: "Loja criada",
  TENANT_ONBOARDING_COMPLETED: "Onboarding da loja concluído",
  TENANT_PLAN_CHANGED: "Plano da loja alterado",
  TENANT_SETTINGS_UPDATED: "Configurações da loja atualizadas",
  TENANT_STATUS_CHANGED: "Status da loja alterado",
  TENANT_SUSPENDED: "Loja suspensa",
  TRIAL_STARTED: "Trial iniciado",
  USER_CREATED: "Usuário criado",
  USER_ROLE_CHANGED: "Papel de usuário alterado",
};

const ACTOR_TYPE_LABELS: Record<string, string> = {
  master: "Equipe VEXO",
  user: "Lojista",
  system: "Sistema",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

/** Só leitura — nenhuma ação de editar/excluir existe neste componente nem em nenhum outro lugar da tela (prompt D11.2 §2/§4: `audit_logs` é append-only, esta interface é exclusivamente de consulta). */
export function AuditLogRow({ log }: { log: AuditLogRowData }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = log.before !== null || log.after !== null || (log.metadata !== null && Object.keys((log.metadata as object) ?? {}).length > 0);

  return (
    <div className="border-b border-surface-container-highest/50 last:border-b-0">
      <button
        aria-expanded={expanded}
        className="grid w-full grid-cols-12 items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-[#1E1E1E]"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <div className="col-span-12 sm:col-span-2">
          <div className="font-body text-body-sm text-on-surface">{formatDateTime(log.createdAt)}</div>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <div className="font-body text-body-sm font-medium text-on-surface">{ACTION_LABELS[log.action] ?? log.action}</div>
          <div className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{log.action}</div>
        </div>
        <div className="col-span-6 sm:col-span-2">
          <div className="font-body text-body-sm text-on-surface">{log.actorName ?? ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType}</div>
          {log.actorEmail ? <div className="font-body text-body-sm text-on-surface-variant">{log.actorEmail}</div> : null}
        </div>
        <div className="col-span-6 sm:col-span-2">
          <div className="font-body text-body-sm text-on-surface">{log.tenantName ?? "—"}</div>
          {log.resourceType ? (
            <div className="font-body text-body-sm text-on-surface-variant">
              {log.resourceType}
              {log.resourceId ? ` · ${log.resourceId}` : ""}
            </div>
          ) : null}
        </div>
        <div className="col-span-12 sm:col-span-3">
          <div className="font-body text-body-sm text-on-surface-variant">{log.reason ?? "—"}</div>
        </div>
        <div className="col-span-12 flex justify-end sm:hidden">
          <span className="font-label text-label-sm text-tertiary">{expanded ? "Ocultar detalhe ▲" : "Ver detalhe ▼"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-surface-container-highest/50 bg-surface-container-lowest px-6 py-4">
          {!hasDetail ? (
            <p className="font-body text-body-sm text-on-surface-variant">Nenhum dado adicional registrado para este evento.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {log.before !== null ? (
                <div>
                  <p className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Antes</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono text-body-sm text-on-surface-variant">
                    {JSON.stringify(log.before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {log.after !== null ? (
                <div>
                  <p className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Depois</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono text-body-sm text-on-surface-variant">
                    {JSON.stringify(log.after, null, 2)}
                  </pre>
                </div>
              ) : null}
              {log.metadata !== null && Object.keys((log.metadata as object) ?? {}).length > 0 ? (
                <div>
                  <p className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Metadados</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono text-body-sm text-on-surface-variant">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
