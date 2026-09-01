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
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 p-8 text-center">
        <span className="text-3xl">🎉</span>
        <h2 className="font-headline text-headline-sm text-on-surface">Sua loja está configurada!</h2>
        <p className="font-body text-body-md text-on-surface-variant">
          Você concluiu as principais configurações da sua loja.
        </p>
        {storefrontHref ? (
          <Link
            className="mt-2 rounded-lg bg-primary-container px-6 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
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
    <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-headline text-headline-sm text-on-surface">Configure sua loja</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">
            Complete estas configurações para começar a vender.
          </p>
        </div>
        <p className="font-label text-label-md text-on-surface-variant">
          Sua loja está <span className="font-bold text-on-surface">{checklist.percentage}%</span> configurada
        </p>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
        <div
          className="h-full rounded-full bg-primary-container transition-all duration-500"
          style={{ width: `${checklist.percentage}%` }}
        />
      </div>

      <ul className="mt-6 flex flex-col gap-4">
        {checklist.items.map((item) => (
          <li
            className="flex flex-col gap-3 rounded-lg border border-surface-container-highest bg-surface-container-low/40 p-4 sm:flex-row sm:items-center sm:justify-between"
            key={item.key}
          >
            <div className="flex items-start gap-3">
              <span
                className={
                  item.completed
                    ? "material-symbols-outlined mt-0.5 shrink-0 text-xl text-[#10B981]"
                    : "material-symbols-outlined mt-0.5 shrink-0 text-xl text-on-surface-variant"
                }
              >
                {item.completed ? "check_circle" : "radio_button_unchecked"}
              </span>
              <div>
                <p className="font-headline text-headline-sm text-on-surface">{item.title}</p>
                <p className="mt-0.5 font-body text-body-sm text-on-surface-variant">{item.description}</p>
              </div>
            </div>
            {!item.completed ? (
              <Link
                className="w-full shrink-0 rounded-lg bg-primary-container px-4 py-2.5 text-center font-label text-label-sm text-on-primary-container transition-colors hover:bg-[#8B5CF6] sm:w-auto"
                href={item.href}
              >
                {item.actionLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
