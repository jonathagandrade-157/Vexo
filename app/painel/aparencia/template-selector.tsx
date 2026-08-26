"use client";

import { STOREFRONT_TEMPLATES, STOREFRONT_TEMPLATE_LABELS, type StorefrontTemplate } from "@/features/settings/appearance-schema";

const TEMPLATE_DESCRIPTIONS: Record<StorefrontTemplate, string> = {
  commerce: "Mais completo e focado em conversão. Ideal para lojas com muitos produtos e promoções.",
  premium: "Sofisticado, elegante e exclusivo. Ideal para produtos de alto valor e marcas premium.",
  minimal: "Limpo, simples e direto. Ideal para marcas autorais e lojas com catálogo reduzido.",
  editorial: "Layouts com mais destaque para conteúdo e storytelling visual.",
  fashion: "Moderno e visual, inspirado em moda. Ideal para roupas, perfumes e marcas lifestyle.",
};

const RECOMMENDED: StorefrontTemplate = "commerce";

/**
 * Sprint 1 — Fase A. Só a SELEÇÃO do modelo — nenhum dos 5 layouts é
 * renderizado de verdade na loja pública nesta fase (fica para uma fase
 * futura). O card muda o preview mockado desta tela (`StorePreview`),
 * nunca a storefront real.
 */
export function TemplateSelector({
  value,
  onChange,
  disabled,
}: {
  value: StorefrontTemplate;
  onChange: (template: StorefrontTemplate) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {STOREFRONT_TEMPLATES.map((template) => {
        const selected = template === value;
        return (
          <button
            className={
              selected
                ? "flex items-start gap-4 rounded-xl border-2 border-primary bg-primary/5 p-4 text-left transition-colors"
                : "flex items-start gap-4 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-4 text-left transition-colors hover:border-primary/40"
            }
            disabled={disabled}
            key={template}
            onClick={() => onChange(template)}
            type="button"
          >
            <span
              aria-hidden
              className="mt-1 h-10 w-14 shrink-0 rounded-lg bg-gradient-to-br from-surface-container-high to-surface-container-highest"
            />
            <span className="flex flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-label text-label-md uppercase tracking-wide text-on-surface">
                  {STOREFRONT_TEMPLATE_LABELS[template]}
                </span>
                {template === RECOMMENDED ? (
                  <span className="rounded-full bg-primary-container px-2 py-0.5 font-label text-label-sm uppercase text-on-primary-container">
                    Recomendado
                  </span>
                ) : null}
              </span>
              <span className="font-body text-body-sm text-on-surface-variant">{TEMPLATE_DESCRIPTIONS[template]}</span>
            </span>
            <span
              aria-hidden
              className={
                selected
                  ? "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"
                  : "mt-1 h-5 w-5 shrink-0 rounded-full border border-outline-variant"
              }
            >
              {selected ? <span className="material-symbols-outlined text-[14px]">check</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
