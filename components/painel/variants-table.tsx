"use client";

import { useMemo, useState } from "react";

import { formatPrice } from "@/features/products/format-price";
import {
  generateProductVariantsAction,
  toggleProductVariantStatusAction,
  updateProductVariantAction,
} from "@/features/products/variants-actions";
import type { ProductOptionWithValues, ProductVariantRow } from "@/features/products/variants-data";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-2.5 py-1.5 font-body text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary/50 focus:outline-none";

/**
 * D20.6 Fase 3.2 — geração e gerenciamento de product_variants. Recebe as
 * opções/valores e as variantes já carregadas pelo Server Component que o
 * renderizar (mesmo padrão de `ProductOptionsEditor`/`ProductGalleryUploader`:
 * o componente nunca busca dados sozinho) — ainda não integrado a nenhuma
 * página (fora do escopo desta fase, mesmo precedente da Fase 3.1).
 */
export function VariantsTable({
  productId,
  initialOptions,
  initialVariants,
}: {
  productId: string;
  initialOptions: ProductOptionWithValues[];
  initialVariants: ProductVariantRow[];
}) {
  const [variants, setVariants] = useState<ProductVariantRow[]>(initialVariants);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewVariantIds, setReviewVariantIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const valueLabels = useMemo(() => {
    const map = new Map<string, { optionPosition: number; value: string }>();
    for (const option of initialOptions) {
      for (const value of option.values) {
        map.set(value.id, { optionPosition: option.position, value: value.value });
      }
    }
    return map;
  }, [initialOptions]);

  function combinationLabel(optionValueIds: string[]): string {
    const parts = optionValueIds
      .map((id) => valueLabels.get(id))
      .filter((v): v is { optionPosition: number; value: string } => v !== undefined)
      .sort((a, b) => a.optionPosition - b.optionPosition)
      .map((v) => v.value);
    return parts.length > 0 ? parts.join(" / ") : "Combinação";
  }

  async function handleGenerate() {
    setError(null);
    setNotice(null);
    setIsGenerating(true);
    try {
      const result = await generateProductVariantsAction(productId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível gerar as combinações.");
        return;
      }
      if (result.variants) setVariants(result.variants);
      setReviewVariantIds(result.reviewVariantIds ?? []);
      if (result.message) setNotice(result.message);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleVariantChange(updated: ProductVariantRow[]) {
    setVariants(updated);
  }

  const hasOptions = initialOptions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-label text-label-lg text-on-surface">Variantes</h3>
          <p className="font-body text-body-sm text-on-surface-variant">
            Gere as combinações a partir das opções cadastradas — combinações já existentes nunca são duplicadas.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50 disabled:opacity-50"
          disabled={isGenerating || !hasOptions}
          onClick={handleGenerate}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">{isGenerating ? "progress_activity" : "auto_awesome"}</span>
          {variants.length > 0 ? "Atualizar combinações" : "Gerar combinações"}
        </button>
      </div>

      {!hasOptions ? (
        <p className="font-body text-body-sm text-on-surface-variant">Cadastre opções e valores para poder gerar variantes.</p>
      ) : null}

      {error ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="font-body text-body-sm text-on-surface-variant">{notice}</p> : null}

      {reviewVariantIds.length > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-body text-body-sm text-amber-400">
          {reviewVariantIds.length} variante(s) existente(s) não correspondem mais às opções/valores atuais do produto. Nada foi
          excluído automaticamente — revise-as abaixo e desative as que não fizerem mais sentido.
        </p>
      ) : null}

      {variants.length === 0 ? (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhuma variante gerada ainda.</p>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212] md:block">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-surface-container-highest bg-surface-container-low/50">
                  <th className="p-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Variante</th>
                  <th className="p-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">SKU</th>
                  <th className="p-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Preço</th>
                  <th className="p-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Promoção</th>
                  <th className="p-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-highest">
                {variants.map((variant) => (
                  <VariantRow
                    key={variant.id}
                    label={combinationLabel(variant.optionValueIds)}
                    needsReview={reviewVariantIds.includes(variant.id)}
                    onChange={handleVariantChange}
                    variant={variant}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {variants.map((variant) => (
              <VariantCard
                key={variant.id}
                label={combinationLabel(variant.optionValueIds)}
                needsReview={reviewVariantIds.includes(variant.id)}
                onChange={handleVariantChange}
                variant={variant}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Estado/lógica de edição compartilhado entre a linha (desktop) e o card (mobile) — nunca duplicado entre os dois. */
function useVariantEditor(variant: ProductVariantRow, onChange: (variants: ProductVariantRow[]) => void) {
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(String(variant.price));
  const [promotionalPrice, setPromotionalPrice] = useState(variant.promotionalPrice !== null ? String(variant.promotionalPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      const priceNumber = Number(price.replace(",", "."));
      const trimmedPromo = promotionalPrice.trim();
      const promoNumber = trimmedPromo === "" ? undefined : Number(trimmedPromo.replace(",", "."));

      const result = await updateProductVariantAction(variant.id, {
        sku: sku.trim() || undefined,
        price: priceNumber,
        promotionalPrice: promoNumber,
      });
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível salvar a variante.");
        return;
      }
      if (result.variants) onChange(result.variants);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleStatus() {
    setError(null);
    setIsTogglingStatus(true);
    try {
      const result = await toggleProductVariantStatusAction(variant.id, !variant.isActive);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível atualizar o status.");
        return;
      }
      if (result.variants) onChange(result.variants);
    } finally {
      setIsTogglingStatus(false);
    }
  }

  return {
    sku,
    setSku,
    price,
    setPrice,
    promotionalPrice,
    setPromotionalPrice,
    error,
    isSaving,
    isTogglingStatus,
    handleSave,
    handleToggleStatus,
  };
}

function StatusToggleButton({
  isActive,
  isPending,
  onToggle,
}: {
  isActive: boolean;
  isPending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={
        isActive
          ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400 disabled:opacity-50"
          : "inline-flex items-center rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant disabled:opacity-50"
      }
      disabled={isPending}
      onClick={onToggle}
      type="button"
    >
      {isActive ? "Ativa" : "Inativa"}
    </button>
  );
}

function VariantRow({
  variant,
  label,
  needsReview,
  onChange,
}: {
  variant: ProductVariantRow;
  label: string;
  needsReview: boolean;
  onChange: (variants: ProductVariantRow[]) => void;
}) {
  const editor = useVariantEditor(variant, onChange);

  return (
    <tr className={needsReview ? "bg-amber-500/5" : undefined}>
      <td className="p-3 align-top font-label text-label-md text-on-surface">{label}</td>
      <td className="w-32 p-3 align-top">
        <input
          className={INPUT_CLASS}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setSku(e.target.value)}
          placeholder="SKU"
          type="text"
          value={editor.sku}
        />
      </td>
      <td className="w-28 p-3 align-top">
        <input
          className={INPUT_CLASS}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setPrice(e.target.value)}
          type="text"
          value={editor.price}
        />
      </td>
      <td className="w-28 p-3 align-top">
        <input
          className={INPUT_CLASS}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setPromotionalPrice(e.target.value)}
          placeholder="—"
          type="text"
          value={editor.promotionalPrice}
        />
      </td>
      <td className="p-3 align-top">
        <div className="flex flex-col gap-1">
          <StatusToggleButton isActive={variant.isActive} isPending={editor.isTogglingStatus} onToggle={editor.handleToggleStatus} />
          {editor.isSaving ? <span className="font-body text-body-sm text-on-surface-variant">Salvando…</span> : null}
          {editor.error ? (
            <span className="font-body text-body-sm text-error" role="alert">
              {editor.error}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function VariantCard({
  variant,
  label,
  needsReview,
  onChange,
}: {
  variant: ProductVariantRow;
  label: string;
  needsReview: boolean;
  onChange: (variants: ProductVariantRow[]) => void;
}) {
  const editor = useVariantEditor(variant, onChange);

  return (
    <div
      className={
        needsReview
          ? "flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
          : "flex flex-col gap-2 rounded-xl border border-surface-container-highest bg-[#121212] p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-label-md text-on-surface">{label}</span>
        <StatusToggleButton isActive={variant.isActive} isPending={editor.isTogglingStatus} onToggle={editor.handleToggleStatus} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className={INPUT_CLASS}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setSku(e.target.value)}
          placeholder="SKU"
          type="text"
          value={editor.sku}
        />
        <input
          className={INPUT_CLASS}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setPrice(e.target.value)}
          placeholder={formatPrice(0)}
          type="text"
          value={editor.price}
        />
        <input
          className={`${INPUT_CLASS} col-span-2`}
          onBlur={editor.handleSave}
          onChange={(e) => editor.setPromotionalPrice(e.target.value)}
          placeholder="Preço promocional (opcional)"
          type="text"
          value={editor.promotionalPrice}
        />
      </div>
      {editor.isSaving ? <span className="font-body text-body-sm text-on-surface-variant">Salvando…</span> : null}
      {editor.error ? (
        <span className="font-body text-body-sm text-error" role="alert">
          {editor.error}
        </span>
      ) : null}
    </div>
  );
}
