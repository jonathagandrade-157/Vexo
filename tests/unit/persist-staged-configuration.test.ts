import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D20.8 — orquestração de persistência (depois que `createProductAction`
 * devolve um `productId` real, persiste opções/valores/variantes que
 * ficaram staged antes do save). Mocka diretamente as Server Actions já
 * existentes de `variants-actions.ts` (D20.6) — a orquestração NUNCA fala
 * com o Supabase diretamente, só chama essas Actions, então mockar aqui é
 * suficiente (RLS/constraints reais continuam cobertas pelos testes de
 * integração já existentes de D20.1/D20.2). Cobre "persistência na ordem
 * correta", "retry sem duplicação" e "produto com múltiplas combinações"
 * do checklist de testes da Etapa 20.8.
 */
vi.mock("@/features/products/variants-actions", () => ({
  createProductOptionAction: vi.fn(),
  createProductOptionValueAction: vi.fn(),
  generateProductVariantsAction: vi.fn(),
  toggleProductVariantStatusAction: vi.fn(),
  updateProductVariantAction: vi.fn(),
}));

import { emptyStagedConfigProgress, persistStagedProductConfiguration } from "@/features/products/persist-staged-configuration";
import {
  createProductOptionAction,
  createProductOptionValueAction,
  generateProductVariantsAction,
  toggleProductVariantStatusAction,
  updateProductVariantAction,
} from "@/features/products/variants-actions";
import type { ProductOptionWithValues, ProductVariantRow } from "@/features/products/variants-data";

const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

function option(id: string, name: string, values: { id: string; value: string; position: number }[]): ProductOptionWithValues {
  return { id, name, position: 0, values };
}

describe("persistStagedProductConfiguration", () => {
  it("produto simples sem opções: sucesso imediato, nenhuma Action chamada", async () => {
    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [],
      stagedVariants: [],
      progress: emptyStagedConfigProgress(),
    });

    expect(result.status).toBe("success");
    expect(createProductOptionAction).not.toHaveBeenCalled();
    expect(generateProductVariantsAction).not.toHaveBeenCalled();
  });

  it("produto com uma opção: cria a opção, o valor, e gera as variantes, na ordem correta", async () => {
    const calls: string[] = [];
    vi.mocked(createProductOptionAction).mockImplementation(async (_productId, name) => {
      calls.push(`createOption:${name}`);
      return { status: "success", options: [{ id: "real-opt-1", name, position: 0, values: [] }] };
    });
    vi.mocked(createProductOptionValueAction).mockImplementation(async (optionId, value) => {
      calls.push(`createValue:${value}`);
      return { status: "success", values: [{ id: "real-val-1", value, position: 0 }] };
    });
    vi.mocked(generateProductVariantsAction).mockImplementation(async () => {
      calls.push("generate");
      return { status: "success", variants: [] };
    });

    const stagedOptions = [option("local-opt-1", "Cor", [{ id: "local-val-1", value: "Preto", position: 0 }])];

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions,
      stagedVariants: [],
      progress: emptyStagedConfigProgress(),
    });

    expect(result.status).toBe("success");
    expect(calls).toEqual(["createOption:Cor", "createValue:Preto", "generate"]);
    expect(result.progress.optionIdMap["local-opt-1"]).toBe("real-opt-1");
    expect(result.progress.valueIdMap["local-val-1"]).toBe("real-val-1");
  });

  it("produto com duas opções: persiste ambas na ordem em que foram staged", async () => {
    const optionNames: string[] = [];
    vi.mocked(createProductOptionAction).mockImplementation(async (_productId, name) => {
      optionNames.push(name);
      return { status: "success", options: [{ id: `real-${name}`, name, position: 0, values: [] }] };
    });
    vi.mocked(createProductOptionValueAction).mockImplementation(async (_optionId, value) => ({
      status: "success",
      values: [{ id: `real-${value}`, value, position: 0 }],
    }));
    vi.mocked(generateProductVariantsAction).mockResolvedValue({ status: "success", variants: [] });

    const stagedOptions = [
      option("local-1", "Cor", [{ id: "lv1", value: "Preto", position: 0 }]),
      option("local-2", "Tamanho", [{ id: "lv2", value: "M", position: 0 }]),
    ];

    await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions,
      stagedVariants: [],
      progress: emptyStagedConfigProgress(),
    });

    expect(optionNames).toEqual(["Cor", "Tamanho"]);
  });

  it("falha ao criar uma opção interrompe a persistência sem chamar generateProductVariantsAction", async () => {
    vi.mocked(createProductOptionAction).mockResolvedValue({ status: "error", message: "Você não tem permissão para esta ação." });

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [option("local-1", "Cor", [{ id: "lv1", value: "Preto", position: 0 }])],
      stagedVariants: [],
      progress: emptyStagedConfigProgress(),
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("Você não tem permissão para esta ação.");
    expect(generateProductVariantsAction).not.toHaveBeenCalled();
    expect(result.progress.optionIdMap).toEqual({});
  });

  it("retry sem duplicação: uma opção já persistida (presente no progress) não é recriada", async () => {
    vi.mocked(createProductOptionValueAction).mockResolvedValue({ status: "success", values: [{ id: "real-val-1", value: "Preto", position: 0 }] });
    vi.mocked(generateProductVariantsAction).mockResolvedValue({ status: "success", variants: [] });

    const progress = emptyStagedConfigProgress();
    progress.optionIdMap["local-opt-1"] = "real-opt-1"; // já persistida numa tentativa anterior

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [option("local-opt-1", "Cor", [{ id: "local-val-1", value: "Preto", position: 0 }])],
      stagedVariants: [],
      progress,
    });

    expect(result.status).toBe("success");
    expect(createProductOptionAction).not.toHaveBeenCalled(); // NUNCA recria a opção já persistida
    expect(createProductOptionValueAction).toHaveBeenCalledWith("real-opt-1", "Preto"); // mas ainda persiste o valor pendente
  });

  it("retry sem duplicação: uma opção E seu valor já persistidos não geram nenhuma nova chamada de criação", async () => {
    vi.mocked(generateProductVariantsAction).mockResolvedValue({ status: "success", variants: [] });

    const progress = emptyStagedConfigProgress();
    progress.optionIdMap["local-opt-1"] = "real-opt-1";
    progress.valueIdMap["local-val-1"] = "real-val-1";

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [option("local-opt-1", "Cor", [{ id: "local-val-1", value: "Preto", position: 0 }])],
      stagedVariants: [],
      progress,
    });

    expect(result.status).toBe("success");
    expect(createProductOptionAction).not.toHaveBeenCalled();
    expect(createProductOptionValueAction).not.toHaveBeenCalled();
    expect(generateProductVariantsAction).toHaveBeenCalledOnce();
  });

  it("produto com múltiplas combinações: aplica SKU/preço/status de cada variante staged na variante real correspondente", async () => {
    vi.mocked(createProductOptionAction).mockResolvedValue({ status: "success", options: [{ id: "real-opt-cor", name: "Cor", position: 0, values: [] }] });
    vi.mocked(createProductOptionValueAction).mockImplementation(async (_optionId, value) => ({
      status: "success",
      values: [{ id: value === "Preto" ? "real-preto" : "real-branco", value, position: 0 }],
    }));
    const realVariants: ProductVariantRow[] = [
      { id: "real-variant-preto", sku: null, price: 50, promotionalPrice: null, isActive: true, optionValueIds: ["real-preto"] },
      { id: "real-variant-branco", sku: null, price: 50, promotionalPrice: null, isActive: true, optionValueIds: ["real-branco"] },
    ];
    vi.mocked(generateProductVariantsAction).mockResolvedValue({ status: "success", variants: realVariants });
    vi.mocked(updateProductVariantAction).mockResolvedValue({ status: "success", variants: realVariants });
    vi.mocked(toggleProductVariantStatusAction).mockResolvedValue({ status: "success", variants: realVariants });

    const stagedOptions = [
      option("local-opt-cor", "Cor", [
        { id: "local-preto", value: "Preto", position: 0 },
        { id: "local-branco", value: "Branco", position: 1 },
      ]),
    ];
    const stagedVariants: ProductVariantRow[] = [
      { id: "local-variant-preto", sku: "CAM-PRETO", price: 60, promotionalPrice: 50, isActive: true, optionValueIds: ["local-preto"] },
      { id: "local-variant-branco", sku: "CAM-BRANCO", price: 60, promotionalPrice: null, isActive: false, optionValueIds: ["local-branco"] },
    ];

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions,
      stagedVariants,
      progress: emptyStagedConfigProgress(),
    });

    expect(result.status).toBe("success");
    expect(updateProductVariantAction).toHaveBeenCalledWith("real-variant-preto", { sku: "CAM-PRETO", price: 60, promotionalPrice: 50 });
    expect(updateProductVariantAction).toHaveBeenCalledWith("real-variant-branco", { sku: "CAM-BRANCO", price: 60, promotionalPrice: undefined });
    expect(toggleProductVariantStatusAction).toHaveBeenCalledWith("real-variant-branco", false);
    expect(toggleProductVariantStatusAction).not.toHaveBeenCalledWith("real-variant-preto", expect.anything());
    expect(result.progress.appliedVariantIds).toEqual({ "local-variant-preto": true, "local-variant-branco": true });
  });

  it("retry sem duplicação: uma variante já aplicada (appliedVariantIds) não é atualizada de novo", async () => {
    vi.mocked(createProductOptionAction).mockResolvedValue({ status: "success", options: [{ id: "real-opt", name: "Cor", position: 0, values: [] }] });
    vi.mocked(createProductOptionValueAction).mockResolvedValue({ status: "success", values: [{ id: "real-val", value: "Preto", position: 0 }] });
    vi.mocked(generateProductVariantsAction).mockResolvedValue({
      status: "success",
      variants: [{ id: "real-variant", sku: null, price: 50, promotionalPrice: null, isActive: true, optionValueIds: ["real-val"] }],
    });

    const progress = emptyStagedConfigProgress();
    progress.optionIdMap["local-opt"] = "real-opt";
    progress.valueIdMap["local-val"] = "real-val";
    progress.variantIdMap["local-variant"] = "real-variant";
    progress.appliedVariantIds["local-variant"] = true;

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [option("local-opt", "Cor", [{ id: "local-val", value: "Preto", position: 0 }])],
      stagedVariants: [{ id: "local-variant", sku: "X", price: 99, promotionalPrice: null, isActive: true, optionValueIds: ["local-val"] }],
      progress,
    });

    expect(result.status).toBe("success");
    expect(updateProductVariantAction).not.toHaveBeenCalled();
    expect(toggleProductVariantStatusAction).not.toHaveBeenCalled();
  });

  it("falha ao gerar variantes é reportada e não apaga o progresso de opções/valores já persistidos", async () => {
    vi.mocked(createProductOptionAction).mockResolvedValue({ status: "success", options: [{ id: "real-opt", name: "Cor", position: 0, values: [] }] });
    vi.mocked(createProductOptionValueAction).mockResolvedValue({ status: "success", values: [{ id: "real-val", value: "Preto", position: 0 }] });
    vi.mocked(generateProductVariantsAction).mockResolvedValue({ status: "error", message: "Não foi possível gerar todas as combinações. Tente novamente." });

    const result = await persistStagedProductConfiguration({
      productId: PRODUCT_ID,
      stagedOptions: [option("local-opt", "Cor", [{ id: "local-val", value: "Preto", position: 0 }])],
      stagedVariants: [],
      progress: emptyStagedConfigProgress(),
    });

    expect(result.status).toBe("error");
    expect(result.progress.optionIdMap["local-opt"]).toBe("real-opt");
    expect(result.progress.valueIdMap["local-val"]).toBe("real-val");
  });
});
