import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { segmentLabel } from "@/features/settings/segments";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { resolveStoreSetupChecklist } from "@/features/painel/store-setup";
import { storefrontHref } from "@/features/painel/store-setup-logic";
import { isBusinessType } from "@/features/onboarding/step-definitions";
import { StoreSetupChecklistCard } from "@/components/painel/store-setup-checklist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Painel — VEXO",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  pending: "Pendente de aprovação",
  suspended: "Suspensa",
  deleted: "Excluída",
};

/**
 * Fora do corpo do componente de propósito: a regra de pureza do
 * react-compiler barra `Date.now()` dentro de uma função de componente
 * (mesmo Server Component), mas não dentro de uma função utilitária comum
 * chamada por ele.
 */
function daysRemaining(endsAtIso: string): number {
  return Math.max(0, Math.ceil((new Date(endsAtIso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

/**
 * Recria `vexo_dashboard_comece_a_vender_desktop` (Stitch) — a versão de
 * ESTADO VAZIO, não `vexo_dashboard_principal_*` (que tem vendas/pedidos/
 * clientes fictícios). Arquitetura §10 Etapa 5: "não inventar métricas...
 * se ainda não existirem dados, usar estados vazios apropriados."
 *
 * Os únicos indicadores mostrados são derivados de dados que já existem
 * de verdade (tenants, trial_records, tenant_members) — nenhum gráfico,
 * nenhuma métrica de vendas/pedidos/visitas.
 */
export default async function PainelHomePage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: trial }, { count: memberCount }, setupChecklist] = await Promise.all([
    supabase
      .from("trial_records")
      .select("started_at, ends_at, status")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
    resolveStoreSetupChecklist(supabase, tenant.id, isBusinessType(tenant.business_type) ? tenant.business_type : null),
  ]);

  const trialDaysLeft = trial ? daysRemaining(trial.ends_at as string) : null;

  return (
    <div className="flex flex-col gap-8">
      {trial && trial.status === "active" ? (
        <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-primary/30 bg-primary/10 p-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">info</span>
            <div>
              <p className="font-body text-body-md text-on-surface">
                Seu teste grátis termina em <span className="font-bold">{trialDaysLeft} dias</span>.
              </p>
              <p className="font-label text-label-sm text-on-surface-variant">
                Aproveite todos os recursos durante o período de teste.
              </p>
            </div>
          </div>
          <Link
            className="rounded-lg bg-primary px-6 py-2 font-label text-label-md text-on-primary transition-opacity hover:opacity-90"
            href="/painel/assinatura"
          >
            Escolher plano
          </Link>
        </div>
      ) : null}

      <div>
        <h1 className="font-headline text-headline-md text-on-surface md:text-display-lg">
          {tenant.name}
        </h1>
        <p className="mt-2 font-body text-body-lg text-on-surface-variant">
          Veja o resumo inicial da sua loja.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <IndicatorCard icon="storefront" label="Status da loja" value={STATUS_LABELS[tenant.status] ?? tenant.status} />
        <IndicatorCard
          icon="schedule"
          label="Trial"
          value={trialDaysLeft !== null ? `${trialDaysLeft} dias restantes` : "—"}
        />
        <IndicatorCard icon="sell" label="Segmento" value={segmentLabel(tenant.segment)} />
        <IndicatorCard icon="group" label="Membros da equipe" value={String(memberCount ?? 1)} />
      </div>

      <StoreSetupChecklistCard checklist={setupChecklist} storefrontHref={storefrontHref(tenant.slug)} />

      <div className="flex flex-col items-center rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-16 text-center">
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center rounded-2xl border border-outline-variant bg-surface-container-low">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant opacity-50">
            shopping_bag
          </span>
        </div>
        <h2 className="mb-4 font-headline text-headline-md text-on-surface">Comece a vender</h2>
        <p className="mb-10 max-w-lg font-body text-body-lg text-on-surface-variant">
          Assim que sua loja receber pedidos, você verá seus resultados aqui.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            className="rounded-lg bg-primary-container px-6 py-3 font-label text-label-md font-bold text-on-primary-container transition-colors hover:bg-inverse-primary"
            href="/painel/produtos"
          >
            Adicionar meu primeiro produto
          </Link>
          <Link
            className="ai-glow flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-container to-secondary-container px-6 py-3 font-label text-label-md font-bold text-on-primary-container transition-opacity hover:opacity-90"
            href="/painel/vexo-ai"
          >
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            Conhecer a Vexo AI
          </Link>
        </div>
      </div>
    </div>
  );
}

function IndicatorCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-4 transition-colors hover:border-primary/30">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-label text-label-md uppercase tracking-wider text-on-surface-variant">
          {label}
        </p>
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
      </div>
      <h3 className="font-headline text-headline-sm text-on-surface">{value}</h3>
    </div>
  );
}
