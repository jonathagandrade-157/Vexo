import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { TenantPlanDialog } from "@/components/master/tenant-plan-dialog";
import { listPlans } from "@/features/commercial/data";
import { formatPrice } from "@/features/products/format-price";
import { getCurrentPlatformAdmin } from "@/features/master/current-admin";
import { updateTenantStatusAction, type TenantNextStatus } from "@/features/master/tenants-actions";
import { getTenantDetailForMaster } from "@/features/master/tenants-data";
import { segmentLabel } from "@/features/settings/segments";

export const metadata: Metadata = { title: "Detalhe da loja — VEXO Master" };

const STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  pending: "Pendente",
  suspended: "Suspensa",
  deleted: "Excluída",
};

/** Rótulo do `subscriptions.status` (Etapa 20.1) — mesmo vocabulário do banco, só traduzido para exibição. */
const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: "Em trial",
  active: "Ativa",
  past_due: "Pagamento pendente",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  expired: "Expirada",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Mesma máquina de estados de `components/master/tenant-row.tsx` — mantida local (não compartilhada) porque aquele arquivo é `"use client"` e não pode ser importado por um Server Component para uma chamada direta. */
function nextStatusFor(status: string): { next: TenantNextStatus; label: string } | null {
  if (status === "pending") return { next: "active", label: "Ativar" };
  if (status === "active") return { next: "suspended", label: "Suspender" };
  if (status === "suspended") return { next: "active", label: "Reativar" };
  return null;
}

/** `/master/lojas/[id]` (Etapa 18) — visão completa de uma loja para o MASTER: dados, plano/trial, equipe, e a ação de mudança de status. */
export default async function MasterLojaDetalhePage({ params }: PageProps) {
  const { id } = await params;
  const [admin, tenant, plans] = await Promise.all([getCurrentPlatformAdmin(), getTenantDetailForMaster(id), listPlans()]);
  if (!tenant) notFound();

  const canManage = admin?.role === "MASTER";
  const action = nextStatusFor(tenant.status);
  const activePlans = plans.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, monthlyPrice: p.monthly_price }));
  const subscriptionDate = tenant.subscription
    ? tenant.subscription.status === "trialing"
      ? { label: "Trial termina em", value: formatDate(tenant.subscription.trialEnd) }
      : { label: "Período atual termina em", value: formatDate(tenant.subscription.currentPeriodEnd) }
    : null;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-tertiary" href="/master/lojas">
          ← Lojas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-headline text-headline-md text-on-surface">{tenant.name}</h1>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {segmentLabel(tenant.segment)} · /{tenant.slug} · criada em {formatDate(tenant.createdAt)}
            </p>
          </div>
          <span className="rounded-full bg-surface-container-highest px-3 py-1.5 font-label text-label-sm uppercase text-on-surface-variant">
            {STATUS_LABELS[tenant.status] ?? tenant.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-5">
          <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Proprietário</p>
          <p className="mt-2 font-body text-body-md text-on-surface">{tenant.ownerName ?? "—"}</p>
          <p className="font-body text-body-sm text-on-surface-variant">{tenant.ownerEmail ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-5">
          <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Onboarding</p>
          <p className="mt-2 font-body text-body-md text-on-surface">
            {tenant.onboardingCompletedAt ? `Concluído em ${formatDate(tenant.onboardingCompletedAt)}` : "Pendente"}
          </p>
        </div>
        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-5">
          <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Trial (cadastro)</p>
          <p className="mt-2 font-body text-body-md text-on-surface">
            {tenant.trialStatus ? `${tenant.trialStatus} — término em ${formatDate(tenant.trialEndsAt)}` : "Sem trial"}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Plano da loja</p>
          {canManage && tenant.subscription ? (
            <TenantPlanDialog currentPlanId={tenant.subscription.planId} plans={activePlans} tenantId={tenant.id} />
          ) : null}
        </div>
        {tenant.subscription ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="font-body text-body-sm text-on-surface-variant">Plano atual</p>
              <p className="mt-1 font-body text-body-md text-on-surface">{tenant.subscription.planName}</p>
            </div>
            <div>
              <p className="font-body text-body-sm text-on-surface-variant">Status da assinatura</p>
              <p className="mt-1 font-body text-body-md text-on-surface">
                {SUBSCRIPTION_STATUS_LABELS[tenant.subscription.status] ?? tenant.subscription.status}
              </p>
            </div>
            <div>
              <p className="font-body text-body-sm text-on-surface-variant">Preço mensal</p>
              <p className="mt-1 font-body text-body-md text-on-surface">
                {tenant.subscription.monthlyPrice !== null ? `${formatPrice(tenant.subscription.monthlyPrice)}/mês` : "A definir"}
              </p>
            </div>
            <div>
              <p className="font-body text-body-sm text-on-surface-variant">Preço anual</p>
              <p className="mt-1 font-body text-body-md text-on-surface">
                {tenant.subscription.yearlyPrice !== null ? `${formatPrice(tenant.subscription.yearlyPrice)}/ano` : "A definir"}
              </p>
            </div>
            {subscriptionDate ? (
              <div>
                <p className="font-body text-body-sm text-on-surface-variant">{subscriptionDate.label}</p>
                <p className="mt-1 font-body text-body-md text-on-surface">{subscriptionDate.value}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="font-body text-body-sm text-on-surface-variant">Esta loja ainda não possui uma assinatura configurada.</p>
        )}
      </div>

      <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-5">
        <p className="mb-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Equipe</p>
        <div className="flex flex-col gap-3">
          {tenant.members.length === 0 ? (
            <p className="font-body text-body-sm text-on-surface-variant">Nenhum membro ativo.</p>
          ) : (
            tenant.members.map((member) => (
              <div className="flex items-center justify-between gap-4" key={member.userId}>
                <div>
                  <p className="font-body text-body-sm text-on-surface">{member.fullName ?? "—"}</p>
                  <p className="font-body text-body-sm text-on-surface-variant">{member.email ?? "—"}</p>
                </div>
                <span className="font-label text-label-sm uppercase text-on-surface-variant">{member.roleKey}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {canManage && action ? (
        <div className="flex justify-end">
          <ConfirmDialog
            confirmLabel={action.label}
            description={`Tem certeza que deseja ${action.label.toLowerCase()} a loja "${tenant.name}"?`}
            onConfirm={updateTenantStatusAction.bind(null, tenant.id, action.next)}
            title={`${action.label} loja`}
            trigger={
              <span className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90">
                {action.label}
              </span>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
