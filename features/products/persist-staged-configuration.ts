import { canonicalizeCombination } from "./variant-combinations";
import {
  createProductOptionAction,
  createProductOptionValueAction,
  generateProductVariantsAction,
  toggleProductVariantStatusAction,
  updateProductVariantAction,
} from "./variants-actions";
import type { ProductOptionWithValues, ProductVariantRow } from "./variants-data";

/**
 * D20.8 — depois que `createProductAction` devolve um `productId` real,
 * persiste as opções/valores/variantes que o lojista montou ANTES do save
 * (staged, só em memória — o mesmo princípio de `ProductGalleryUploader`
 * da Etapa 20.7) usando EXATAMENTE as Server Actions já existentes de
 * D20.6 — cada uma já valida/autoriza/normaliza como faria numa edição
 * manual, nenhuma arquitetura de escrita nova.
 *
 * `optionIdMap`/`valueIdMap`/`variantIdMap`/`appliedVariantIds` rastreiam
 * o que já foi persistido com sucesso, indexado pelo id LOCAL (atribuído
 * no cliente, `crypto.randomUUID()`): uma nova chamada com o MESMO
 * `progress` (retry, "Tentar novamente") pula tudo que já tem um id real
 * mapeado — nunca recria/duplica uma opção, valor ou variante. Para na
 * PRIMEIRA falha (variantes dependem de TODAS as opções/valores já
 * persistidos, então nunca faz sentido "pular" um passo que falhou e
 * seguir para o próximo) — o produto em si NUNCA é apagado/recriado por
 * uma falha aqui: ele já existe, criado por `createProductAction` antes
 * desta função sequer rodar.
 */
export interface StagedConfigProgress {
  optionIdMap: Record<string, string>;
  valueIdMap: Record<string, string>;
  variantIdMap: Record<string, string>;
  appliedVariantIds: Record<string, true>;
}

export function emptyStagedConfigProgress(): StagedConfigProgress {
  return { optionIdMap: {}, valueIdMap: {}, variantIdMap: {}, appliedVariantIds: {} };
}

export interface PersistStagedConfigurationResult {
  status: "success" | "error";
  message?: string;
  progress: StagedConfigProgress;
}

export async function persistStagedProductConfiguration(params: {
  productId: string;
  stagedOptions: ProductOptionWithValues[];
  stagedVariants: ProductVariantRow[];
  progress: StagedConfigProgress;
}): Promise<PersistStagedConfigurationResult> {
  const { productId, stagedOptions, stagedVariants } = params;
  const progress: StagedConfigProgress = {
    optionIdMap: { ...params.progress.optionIdMap },
    valueIdMap: { ...params.progress.valueIdMap },
    variantIdMap: { ...params.progress.variantIdMap },
    appliedVariantIds: { ...params.progress.appliedVariantIds },
  };

  if (stagedOptions.length === 0) {
    return { status: "success", progress };
  }

  for (const option of stagedOptions) {
    let realOptionId = progress.optionIdMap[option.id];
    if (!realOptionId) {
      const result = await createProductOptionAction(productId, option.name);
      if (result.status === "error" || !result.options) {
        return { status: "error", message: result.message ?? "Não foi possível salvar as opções do produto.", progress };
      }
      const created = result.options.find((o) => o.name === option.name.trim());
      if (!created) {
        return { status: "error", message: "Não foi possível localizar a opção recém-criada.", progress };
      }
      realOptionId = created.id;
      progress.optionIdMap[option.id] = realOptionId;
    }

    for (const value of option.values) {
      if (progress.valueIdMap[value.id]) continue;
      const result = await createProductOptionValueAction(realOptionId, value.value);
      if (result.status === "error" || !result.values) {
        return { status: "error", message: result.message ?? "Não foi possível salvar os valores das opções.", progress };
      }
      const created = result.values.find((v) => v.value === value.value.trim());
      if (!created) {
        return { status: "error", message: "Não foi possível localizar o valor recém-criado.", progress };
      }
      progress.valueIdMap[value.id] = created.id;
    }
  }

  // Sempre reaproveita generateProductVariantsAction — idempotente (nunca
  // duplica combinação já existente, mesmo teste "geração repetida" de
  // D20.6) — nunca uma leitura própria: mesmo quando o lojista nunca
  // clicou "Gerar combinações" na tabela staged, isso garante que as
  // variantes reais são geradas a partir das opções/valores que acabaram
  // de ser persistidos acima.
  const generated = await generateProductVariantsAction(productId);
  if (generated.status === "error" || !generated.variants) {
    return { status: "error", message: generated.message ?? "Não foi possível gerar as variantes do produto.", progress };
  }

  if (stagedVariants.length > 0) {
    const realByKey = new Map(generated.variants.map((v) => [canonicalizeCombination(v.optionValueIds).join("|"), v]));

    for (const stagedVariant of stagedVariants) {
      if (progress.appliedVariantIds[stagedVariant.id]) continue;

      let realVariantId = progress.variantIdMap[stagedVariant.id];
      if (!realVariantId) {
        const mappedValueIds = stagedVariant.optionValueIds.map((id) => progress.valueIdMap[id]);
        if (mappedValueIds.some((id) => !id)) continue; // combinação com um valor não persistido — nunca deveria acontecer, defensivo
        const key = canonicalizeCombination(mappedValueIds as string[]).join("|");
        const match = realByKey.get(key);
        if (!match) continue; // combinação não gerada (ex.: limite de variantes excedido) — nada a aplicar
        realVariantId = match.id;
        progress.variantIdMap[stagedVariant.id] = realVariantId;
      }

      const updateResult = await updateProductVariantAction(realVariantId, {
        sku: stagedVariant.sku ?? undefined,
        price: stagedVariant.price,
        promotionalPrice: stagedVariant.promotionalPrice ?? undefined,
      });
      if (updateResult.status === "error") {
        return { status: "error", message: updateResult.message ?? "Não foi possível salvar os dados de uma variante.", progress };
      }

      if (!stagedVariant.isActive) {
        const toggleResult = await toggleProductVariantStatusAction(realVariantId, false);
        if (toggleResult.status === "error") {
          return { status: "error", message: toggleResult.message ?? "Não foi possível salvar o status de uma variante.", progress };
        }
      }

      progress.appliedVariantIds[stagedVariant.id] = true;
    }
  }

  return { status: "success", progress };
}
