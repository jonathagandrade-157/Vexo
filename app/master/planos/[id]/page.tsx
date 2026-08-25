import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlanFeatureChecklist } from "@/components/master/plan-feature-checklist";
import { PlanFormDialog } from "@/components/master/plan-form-dialog";
import { PlanLimitsEditor } from "@/components/master/plan-limits-editor";
import { getPlanDetail, listFeatures, listPlanLimits } from "@/features/commercial/data";
import { formatPrice } from "@/features/products/format-price";

export const metadata: Metadata = { title: "Recursos do plano — VEXO Master" };

interface PageProps {
  params: Promise<{ id: string }>;
}

/** `/master/planos/[id]` — quais recursos este plano libera e quais limites numéricos ele tem (ajuste arquitetural: feature ≠ limite). */
export default async function MasterPlanoDetalhePage({ params }: PageProps) {
  const { id } = await params;
  const [plan, features, limits] = await Promise.all([getPlanDetail(id), listFeatures(), listPlanLimits(id)]);
  if (!plan) notFound();

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-tertiary" href="/master/planos">
          ← Planos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-headline text-headline-md text-on-surface">{plan.name}</h1>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {plan.monthly_price !== null ? `${formatPrice(plan.monthly_price)}/mês` : "Preço mensal a definir"}
              {" · "}
              {plan.yearly_price !== null ? `${formatPrice(plan.yearly_price)}/ano` : "Preço anual a definir"}
            </p>
          </div>
          <PlanFormDialog
            plan={{
              ...plan,
              feature_count: plan.featureIds.length,
              subscriber_count: 0,
              storeCounts: { total: 0, trialing: 0, active: 0, suspended: 0 },
            }}
            trigger={
              <span className="flex items-center justify-center gap-2 rounded-lg border border-tertiary/40 px-5 py-2.5 font-label text-label-md text-tertiary transition-colors hover:bg-tertiary/10">
                <span className="material-symbols-outlined text-[20px]">edit</span>
                Editar plano
              </span>
            }
          />
        </div>
      </div>

      <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
        <h2 className="mb-1 font-headline text-headline-sm text-on-surface">Recursos liberados</h2>
        <p className="mb-5 font-body text-body-sm text-on-surface-variant">
          Marque os recursos que este plano libera para os lojistas. Alterações são salvas imediatamente.
        </p>
        <PlanFeatureChecklist features={features} initialFeatureIds={plan.featureIds} planId={plan.id} />
      </section>

      <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
        <h2 className="mb-1 font-headline text-headline-sm text-on-surface">Limites</h2>
        <p className="mb-5 font-body text-body-sm text-on-surface-variant">
          Capacidade numérica do plano (ex.: quantidade máxima de produtos) — distinto de recursos. Use -1 para ilimitado.
          Os limites são aplicados automaticamente pelo VEXO. Dados existentes não são removidos quando um limite é reduzido.
        </p>
        <PlanLimitsEditor limits={limits} planId={plan.id} />
      </section>
    </div>
  );
}
