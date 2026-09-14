"use client";

import { useMemo, useState } from "react";

import { formatPrice } from "@/features/products/format-price";
import { checkVariantCountLimit, checkVariantGenerationPreconditions, diffVariantCombinations, generateCombinations } from "@/features/products/variant-combinations";
import {
  generateProductVariantsAction,
  toggleProductVariantStatusAction,
  updateProductVariantAction,
} from "@/features/products/variants-actions";
import type { ProductOptionWithValues, ProductVariantRow } from "@/features/products/variants-data";
import { updateProductVariantSchema, type ProductVariantActionState } from "@/features/products/variants-schema";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-2.5 py-1.5 font-body text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary/50 focus:outline-none";

/** D20.8 — mesmo formato de updateProductVariantAction/toggleProductVariantStatusAction: em modo staged, cada uma vira uma mutação puramente local em vez de uma chamada de rede — a linha/card de variante chama sempre da mesma forma, sem saber qual dos dois é. */
interface VariantActions {
  update: (variantId: string, input: { sku?: string; price: number; promotionalPrice?: number }) => Promise<ProductVariantActionState>;
  toggleStatus: (variantId: string, isActive: boolean) => Promise<ProductVariantActionState>;
}

/**
 * D20.6 Fase 3.2 — geração e gerenciamento de product_variants.
 *
 * D20.8 — `productId` passou a ser OPCIONAL: `undefined` significa
 * "produto ainda não salvo". Nesse caso, `variants`/`onVariantsChange`
 * (obrigatórios juntos quando `productId` está ausente) controlam a
 * lista de fora (`ProductForm`, para a persistência depois que
 * `createProductAction` devolve um `productId` real) — "Gerar
 * combinações" reaproveita exatamente `generateCombinations`/
 * `diffVariantCombinations`/`checkVariantGenerationPreconditions`/
 * `checkVariantCountLimit` (as MESMAS funções puras que
 * `generateProductVariantsAction` usa no servidor — nenhum segundo
 * algoritmo) em vez de chamar a Action; editar SKU/preço/preço
 * promocional/status reaproveita `updateProductVariantSchema` (mesma
 * validação, nunca duplicada) para validar localmente antes de aplicar.
 * `defaultPrice` semeia o preço de cada variante recém-gerada (staged) —
 * em modo de edição a Action já lê o preço real do produto no banco,
 * este valor é ignorado.
 *
 * Em modo de edição (`productId` já definido), o comportamento é
 * idêntico ao de antes da Etapa 20.8.
 */
export function VariantsTable({
  productId,
  initialOptions,
  initialVariants,
  variants: stagedVariantsProp,
  onVariantsChange,
  defaultPrice,
}: {
  productId?: string;
  initialOptions: ProductOptionWithValues[];
  initialVariants?: ProductVariantRow[];
  /** D20.8 — obrigatório junto com onVariantsChange quando productId é undefined. */
  variants?: ProductVariantRow[];
  onVariantsChange?: (variants: ProductVariantRow[]) => void;
  defaultPrice?: number;
}) {
  const isStaged = !productId;
  const [internalVariants, setInternalVariants] = useState<ProductVariantRow[]>(initialVariants ?? []);
  const variants = isStaged ? (stagedVariantsProp ?? []) : internalVariants;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewVariantIds, setReviewVariantIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  function applyVariants(next: ProductVariantRow[]) {
    if (isStaged) {
      onVariantsChange?.(next);
    } else {
      setInternalVariants(next);
    }
  }

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
      if (!productId) {
        const precondition = checkVariantGenerationPreconditions(initialOptions);
        if (!precondition.ok) {
          setError(precondition.message);
          return;
        }

        const combinations = generateCombinations(
          initialOptions.map((option) => ({ optionId: option.id, valueIds: option.values.map((value) => value.id) })),
        );
        const countCheck = checkVariantCountLimit(combinations.length);
        if (!countCheck.ok) {
          setError(countCheck.message);
          return;
        }

        const diff = diffVariantCombinations(
          combinations,
          variants.map((v) => ({ id: v.id, optionValueIds: v.optionValueIds })),
        );

        if (diff.toCreate.length === 0) {
          setReviewVariantIds(diff.reviewVariantIds);
          setNotice(
            diff.reviewVariantIds.length > 0
              ? "Nenhuma combinação nova para gerar. Algumas variantes existentes não correspondem mais às opções/valores atuais — revise-as."
              : "Nenhuma combinação nova para gerar — todas já existem.",
          );
          return;
        }

        const created: ProductVariantRow[] = diff.toCreate.map((combination) => ({
          id: crypto.randomUUID(),
          sku: null,
          price: defaultPrice ?? 0,
          promotionalPrice: null,
          isActive: true,
          optionValueIds: combination,
        }));

        applyVariants([...variants, ...created]);
        setReviewVariantIds(diff.reviewVariantIds);
        setNotice(`${created.length} combinação(ões) gerada(s).`);
        return;
      }

      const result = await generateProductVariantsAction(productId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível gerar as combinações.");
        return;
      }
      if (result.variants) applyVariants(result.variants);
      setReviewVariantIds(result.reviewVariantIds ?? []);
      if (result.message) setNotice(result.message);
    } finally {
      setIsGenerating(false);
    }
  }

  const variantActions: VariantActions = productId
    ? { update: updateProductVariantAction, toggleStatus: toggleProductVariantStatusAction }
    : {
        update: async (variantId, input) => {
          const parsed = updateProductVariantSchema.safeParse({ variantId, ...input });
          if (!parsed.success) {
            const fieldErrors: ProductVariantActionState["fieldErrors"] = {};
            for (const issue of parsed.error.issues) {
              const key = issue.path[0];
              if (key === "sku" || key === "price" || key === "promotionalPrice") fieldErrors[key] ??= issue.message;
            }
            return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
          }
          // D20.8 — só um best-effort de UX contra colisão DENTRO das variantes já staged deste produto (o servidor é a autoridade real, SKU é único por TENANT inteiro — checado de verdade quando a variante for persistida, Fase de persistência).
          if (parsed.data.sku && variants.some((v) => v.id !== variantId && v.sku === parsed.data.sku)) {
            return {
              status: "error",
              fieldErrors: { sku: "Já existe uma variante com esse SKU nesta loja." },
              message: "Verifique os campos destacados.",
            };
          }
          const next = variants.map((v) =>
            v.id === variantId
              ? { ...v, sku: parsed.data.sku ?? null, price: parsed.data.price, promotionalPrice: parsed.data.promotionalPrice ?? null }
              : v,
          );
          applyVariants(next);
          return { status: "success", variants: next };
        },
        toggleStatus: async (variantId, isActive) => {
          const next = variants.map((v) => (v.id === variantId ? { ...v, isActive } : v));
          applyVariants(next);
          return { status: "success", variants: next };
        },
      };

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
                    actions={variantActions}
                    key={variant.id}
                    label={combinationLabel(variant.optionValueIds)}
                    needsReview={reviewVariantIds.includes(variant.id)}
                    onChange={applyVariants}
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
                actions={variantActions}
                key={variant.id}
                label={combinationLabel(variant.optionValueIds)}
                needsReview={reviewVariantIds.includes(variant.id)}
                onChange={applyVariants}
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
function useVariantEditor(variant: ProductVariantRow, onChange: (variants: ProductVariantRow[]) => void, actions: VariantActions) {
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

      const result = await actions.update(variant.id, {
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
      const result = await actions.toggleStatus(variant.id, !variant.isActive);
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
  actions,
}: {
  variant: ProductVariantRow;
  label: string;
  needsReview: boolean;
  onChange: (variants: ProductVariantRow[]) => void;
  actions: VariantActions;
}) {
  const editor = useVariantEditor(variant, onChange, actions);

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
  actions,
}: {
  variant: ProductVariantRow;
  label: string;
  needsReview: boolean;
  onChange: (variants: ProductVariantRow[]) => void;
  actions: VariantActions;
}) {
  const editor = useVariantEditor(variant, onChange, actions);

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
