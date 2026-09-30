import Link from "next/link";

import type { StoreSetupChecklist } from "@/features/painel/store-setup-logic";

/**
 * D12.2.2 — "Configure sua loja": orientação contínua no painel, distinta
 * do onboarding (D12.2/D12.2.1). Server Component puro (sem `"use
 * client"` — só links, nenhuma interatividade própria) — recebe o
 * checklist já resolvido (`resolveStoreSetupChecklist`), nunca decide
 * "concluído ou não" sozinho (isso é `store-setup-logic.ts`).
 *
 * Nunca bloqueia nada: é só uma seção informativa a mais no dashboard,
 * sempre com acesso livre ao resto do painel — mesmo com tudo pendente.
 */
export function StoreSetupChecklistCard({ checklist, storefrontHref }: { checklist: StoreSetupChecklist; storefrontHref: string | null }) {
  if (checklist.allComplete) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-[#10B981]">verified</span>
          <div>
            <h2 className="font-headline text-headline-sm text-on-surface">Sua loja está configurada!</h2>
            <p className="font-body text-body-sm text-on-surface-variant">
              As principais configurações já estão prontas.
            </p>
          </div>
        </div>
        {storefrontHref ? (
          <Link
            className="shrink-0 rounded-lg bg-primary-container px-5 py-2.5 text-center font-label text-label-md text-on-primary-container transition-[transform,background-color] duration-150 hover:bg-primary-container/90 active:scale-[0.97]"
            href={storefrontHref}
            rel="noopener noreferrer"
            target="_blank"
          >
            Ver minha loja
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined mt-0.5 text-xl text-primary">flag</span>
          <div>
          <h2 className="font-headline text-headline-sm text-on-surface">Configure sua loja</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">
            Complete estas configurações para começar a vender.
          </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-[420px]">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-primary-container transition-[width] duration-300 ease-out"
              style={{ width: `${checklist.percentage}%` }}
            />
          </div>
          <p className="shrink-0 font-label text-label-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">{checklist.completedCount}/{checklist.totalCount}</span> concluídas
          </p>
        </div>
      </div>

      <ol className="mt-5 grid snap-x snap-mandatory auto-cols-[minmax(190px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {checklist.items.map((item, index) => {
          const isNext = !item.completed && checklist.items.slice(0, index).every((previous) => previous.completed);

          return (
          <li className="min-w-0 snap-start" key={item.key}>
            <Link
              className={
                isNext
                  ? "group flex h-full min-h-[142px] flex-col rounded-lg border border-primary/60 bg-primary/10 p-4 transition-[transform,border-color,background-color] duration-150 hover:border-primary hover:bg-primary/15 active:scale-[0.98]"
                  : "group flex h-full min-h-[142px] flex-col rounded-lg border border-surface-container-highest bg-surface-container-low/40 p-4 transition-[transform,border-color,background-color] duration-150 hover:border-primary/40 hover:bg-surface-container-low active:scale-[0.98]"
              }
              href={item.href}
            >
              <div className="flex items-center justify-between gap-3">
              <span
                className={
                  item.completed
                    ? "material-symbols-outlined shrink-0 text-xl text-[#10B981]"
                    : isNext
                      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container font-label text-label-sm text-on-primary-container"
                      : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-label text-label-sm text-on-surface-variant"
                }
              >
                {item.completed ? "check_circle" : index + 1}
              </span>
              <span className="material-symbols-outlined text-[17px] text-on-surface-variant transition-transform duration-150 group-hover:translate-x-0.5">
                arrow_forward
              </span>
              </div>
              <p className="mt-4 font-headline text-body-md font-semibold leading-5 text-on-surface">{item.title}</p>
              <p className="mt-auto pt-3 font-label text-label-sm text-primary">
                {item.completed ? "Revisar" : item.actionLabel}
              </p>
            </Link>
          </li>
          );
        })}
      </ol>
    </section>
  );
}
