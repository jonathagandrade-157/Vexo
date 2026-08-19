import Link from "next/link";

import type { PublicPlan } from "@/features/commercial/public-plans";
import { formatPrice } from "@/features/products/format-price";

/**
 * Seção "Planos que crescem com você" de `vexo_landing_page_oficial_desktop`
 * — a única seção da landing page com dados reais (Etapa 14 preparou a RLS
 * `anon` exatamente para isto): consulta os mesmos `plans`/`plan_features`
 * que o MASTER cadastra em `/master/planos`, nunca uma lista de preços
 * hardcoded. Planos sem `monthly_price` cadastrado mostram "A definir" (o
 * mesmo tratamento que `PlanFormDialog` já usa) — nunca um preço inventado.
 */
export function PricingSection({ plans }: { plans: PublicPlan[] }) {
  if (plans.length === 0) return null;

  return (
    <section className="bg-surface-container-lowest px-margin-mobile py-24 md:px-margin-desktop" id="planos">
      <div className="mx-auto max-w-container-max">
        <div className="mb-16 space-y-4 text-center">
          <h2 className="font-display text-headline-md text-on-surface">Planos que crescem com você</h2>
          <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
            Escolha o plano ideal para o momento da sua empresa. Experimente a VEXO por{" "}
            {plans[0]?.trial_days ?? 30} dias sem pagar.
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              className={
                plan.is_featured
                  ? "ai-glow relative z-10 flex scale-105 flex-col rounded-2xl border border-primary bg-primary-container p-8 shadow-xl"
                  : "flex flex-col rounded-2xl border border-outline-variant/30 bg-surface p-8"
              }
              key={plan.slug}
            >
              {plan.is_featured ? (
                <div className="absolute right-1/2 top-0 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-3 py-1 font-label text-label-sm uppercase tracking-wider text-on-primary">
                  Recomendado
                </div>
              ) : null}
              <h3
                className={
                  plan.is_featured
                    ? "mb-2 font-display text-headline-sm text-on-primary-container"
                    : "mb-2 font-display text-headline-sm text-on-surface"
                }
              >
                {plan.name}
              </h3>
              <p
                className={
                  plan.is_featured
                    ? "mb-6 font-body text-body-sm text-on-primary-container/80"
                    : "mb-6 font-body text-body-sm text-on-surface-variant"
                }
              >
                {plan.description ?? "Para o momento atual da sua loja."}
              </p>
              <div
                className={
                  plan.is_featured
                    ? "mb-6 font-display text-4xl font-bold text-on-primary-container"
                    : "mb-6 font-display text-4xl font-bold text-on-surface"
                }
              >
                {plan.monthly_price !== null ? (
                  <>
                    {formatPrice(plan.monthly_price)}
                    <span className="font-body text-lg font-normal">/mês</span>
                  </>
                ) : (
                  <span className="text-2xl">A definir</span>
                )}
              </div>
              <ul className={plan.is_featured ? "mb-8 flex-1 space-y-3 text-on-primary-container" : "mb-8 flex-1 space-y-3"}>
                {(plan.featureNames.length > 0 ? plan.featureNames.slice(0, 5) : ["Loja online"]).map((name) => (
                  <li className="flex items-center gap-2 font-body text-body-sm" key={name}>
                    <span className="material-symbols-outlined text-sm text-primary">check</span>
                    {name}
                  </li>
                ))}
              </ul>
              <Link
                className={
                  plan.is_featured
                    ? "w-full rounded-xl bg-primary py-3 text-center font-label text-label-md text-on-primary transition-colors hover:bg-primary/90"
                    : "w-full rounded-xl border border-primary py-3 text-center font-label text-label-md text-primary transition-colors hover:bg-primary/10"
                }
                href="/cadastro"
              >
                Assinar {plan.name}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
