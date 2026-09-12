import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D20.6 Fase 3.2 — testa a camada de Server Action de
 * features/products/variants-actions.ts para geração/gerenciamento de
 * product_variants, com o Supabase client mockado (mesmo padrão de
 * tests/unit/product-variants-actions.test.ts, Fase 3.1). O produto
 * cartesiano/diff em si (generateCombinations/diffVariantCombinations) já
 * é testado isoladamente, sem banco, em
 * tests/unit/variant-combinations.test.ts — aqui só confirmamos que a
 * Action de fato lê o estado real (opções/valores/variantes) do banco
 * antes de decidir o que criar, nunca aceita combinações do cliente, e
 * traduz erros do Postgres (23505 de SKU) em mensagens amigáveis.
 *
 * RLS/constraints reais (cross-tenant, FK, unique) são testadas contra o
 * banco local em tests/integration/product-variants.test.ts.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import {
  generateProductVariantsAction,
  toggleProductVariantStatusAction,
  updateProductVariantAction,
} from "@/features/products/variants-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const VARIANT_ID = "33333333-3333-4333-8333-333333333333";
const VALUE_PRETO = "44444444-4444-4444-8444-444444444444";
const VALUE_BRANCO = "55555555-5555-4555-8555-555555555555";
const OPTION_COR = "66666666-6666-4666-8666-666666666666";

type FromResponse = { data?: unknown; error?: unknown };

function mockClient(opts: { hasPermission?: boolean; responses: FromResponse[] }) {
  const queue = [...opts.responses];
  function nextResult(): FromResponse {
    const next = queue.shift();
    if (!next) throw new Error("mockClient: no more queued `from()` responses — chamada inesperada ao Supabase");
    return next;
  }
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: () => Promise.resolve(nextResult()),
      update: () => b,
      delete: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: () => Promise.resolve(nextResult()),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(nextResult()).then(resolve, reject),
    };
    return b;
  }
  return {
    from: vi.fn(() => builder()),
    rpc: vi.fn().mockResolvedValue({ data: opts.hasPermission ?? true, error: null }),
  };
}

function mockSession(client: ReturnType<typeof mockClient>) {
  vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
    tenant: { id: TENANT_ID, onboarding_completed_at: "2026-01-01T00:00:00.000Z" } as never,
    roleKey: "OWNER",
  } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateProductVariantsAction", () => {
  it("productId inválido é rejeitado antes de qualquer consulta", async () => {
    const client = mockClient({ responses: [] });
    mockSession(client);

    const result = await generateProductVariantsAction("not-a-uuid");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Produto inválido.");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("produto inexistente retorna erro amigável", async () => {
    const client = mockClient({ responses: [{ data: null }] }); // resolveOwnedProduct
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toBe("Produto não encontrado.");
  });

  it("produto sem nenhuma opção retorna erro amigável, nenhuma escrita", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [], error: null }, // options
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/cadastre ao menos uma opção/i);
  });

  it("opção sem valores é identificada pelo nome, nenhuma combinação é gerada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_COR, name: "Cor", position: 0 }], error: null }, // options
        { data: [], error: null }, // values de "Cor" — vazio
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toBe('A opção "Cor" não possui valores cadastrados.');
  });

  it('excede o limite de opções por produto (> 3) e é rejeitado com mensagem amigável', async () => {
    const fourOptions = Array.from({ length: 4 }, (_, i) => ({ id: `opt-${i}`, name: `Opção ${i}`, position: i }));
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: fourOptions, error: null }, // options — 4, acima do limite de 3
        { data: [], error: null }, // values (getProductOptionsWithValues sempre busca os dois antes de devolver)
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/limite é 3 opções/i);
  });

  it("excede o limite de valores por opção (> 20) e é rejeitado com mensagem amigável", async () => {
    const manyValues = Array.from({ length: 21 }, (_, i) => ({ id: `val-${i}`, value: `V${i}`, product_option_id: OPTION_COR }));
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_COR, name: "Cor", position: 0 }], error: null }, // options
        { data: manyValues, error: null }, // values — 21, acima do limite de 20
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/limite é 20 valores/i);
  });

  it("excede o limite de variantes por produto (> 100 combinações) e é rejeitado sem inserir nada", async () => {
    // 3 opções x 5 valores cada = 125 combinações, acima do limite de 100.
    const options = ["Cor", "Tamanho", "Material"].map((name, i) => ({ id: `opt-${i}`, name, position: i }));
    const valuesByOption = options.map((opt) =>
      Array.from({ length: 5 }, (_, i) => ({ id: `${opt.id}-v${i}`, value: `V${i}`, product_option_id: opt.id })),
    );
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: options, error: null }, // options
        { data: valuesByOption.flat(), error: null }, // values de todas as opções
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/125 variantes.*limite é 100/i);
  });

  it("geração inicial: cria as combinações novas e devolve a lista atualizada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_COR, name: "Cor", position: 0 }], error: null }, // options
        { data: [{ id: VALUE_PRETO, value: "Preto", product_option_id: OPTION_COR }, { id: VALUE_BRANCO, value: "Branco", product_option_id: OPTION_COR }], error: null }, // values
        { data: [], error: null }, // getProductVariants (nenhuma existente ainda)
        { data: { price: 100 } }, // getProductPrice
        { error: null }, // insert combinação 1
        { error: null }, // insert combinação 2
        { data: [{ id: VARIANT_ID, sku: null, price: 100, promotional_price: null, is_active: true, option_value_ids: [VALUE_PRETO] }], error: null }, // getProductVariants final
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("success");
    expect(result.createdCount).toBe(2);
    expect(result.skippedExistingCount).toBe(0);
    expect(result.variants).toHaveLength(1);
  });

  it("geração repetida: nenhuma combinação nova é criada quando todas já existem", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_COR, name: "Cor", position: 0 }], error: null }, // options
        { data: [{ id: VALUE_PRETO, value: "Preto", product_option_id: OPTION_COR }], error: null }, // values
        { data: [{ id: VARIANT_ID, sku: null, price: 100, promotional_price: null, is_active: true, option_value_ids: [VALUE_PRETO] }], error: null }, // getProductVariants — já existe
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("success");
    expect(result.createdCount).toBe(0);
    expect(result.message).toMatch(/todas já existem/i);
  });

  it("corrida (23505 no INSERT — outra requisição já criou a mesma combinação) é tratada como skip, não como falha", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_COR, name: "Cor", position: 0 }], error: null }, // options
        { data: [{ id: VALUE_PRETO, value: "Preto", product_option_id: OPTION_COR }], error: null }, // values
        { data: [], error: null }, // getProductVariants (nenhuma existente ainda, do ponto de vista desta requisição)
        { data: { price: 100 } }, // getProductPrice
        { error: { code: "23505" } }, // insert falha — outra requisição venceu a corrida
        { data: [{ id: VARIANT_ID, sku: null, price: 100, promotional_price: null, is_active: true, option_value_ids: [VALUE_PRETO] }], error: null }, // getProductVariants final
      ],
    });
    mockSession(client);

    const result = await generateProductVariantsAction(PRODUCT_ID);

    expect(result.status).toBe("success");
    expect(result.createdCount).toBe(0);
    expect(result.skippedExistingCount).toBe(1);
  });
});

describe("updateProductVariantAction", () => {
  it("preço negativo é rejeitado antes de qualquer consulta ao banco", async () => {
    const client = mockClient({ responses: [] });
    mockSession(client);

    const result = await updateProductVariantAction(VARIANT_ID, { price: -10 });

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.price).toMatch(/negativo/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("preço promocional maior que o preço normal é rejeitado", async () => {
    const client = mockClient({ responses: [] });
    mockSession(client);

    const result = await updateProductVariantAction(VARIANT_ID, { price: 50, promotionalPrice: 80 });

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.promotionalPrice).toMatch(/maior que o preço normal/i);
  });

  it("variante inexistente retorna erro amigável", async () => {
    const client = mockClient({ responses: [{ data: null }] }); // resolveOwnedVariant
    mockSession(client);

    const result = await updateProductVariantAction(VARIANT_ID, { price: 100 });

    expect(result.status).toBe("error");
    expect(result.message).toBe("Variante não encontrada.");
  });

  it("SKU duplicado (23505) vira mensagem amigável, nunca o código SQL", async () => {
    const client = mockClient({
      responses: [
        { data: { id: VARIANT_ID, product_id: PRODUCT_ID } }, // resolveOwnedVariant
        { error: { code: "23505" } }, // update falha
      ],
    });
    mockSession(client);

    const result = await updateProductVariantAction(VARIANT_ID, { sku: "CAM-P", price: 100 });

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.sku).toMatch(/já existe uma variante com esse sku/i);
    expect(result.message ?? "").not.toMatch(/23505|constraint/i);
  });

  it("atualização válida devolve a lista de variantes já atualizada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: VARIANT_ID, product_id: PRODUCT_ID } }, // resolveOwnedVariant
        { error: null }, // update
        { data: [{ id: VARIANT_ID, sku: "CAM-P", price: 120, promotional_price: null, is_active: true, option_value_ids: [VALUE_PRETO] }], error: null }, // getProductVariants
      ],
    });
    mockSession(client);

    const result = await updateProductVariantAction(VARIANT_ID, { sku: "CAM-P", price: 120 });

    expect(result.status).toBe("success");
    expect(result.variants?.[0]?.sku).toBe("CAM-P");
    expect(result.variants?.[0]?.price).toBe(120);
  });
});

describe("toggleProductVariantStatusAction", () => {
  it("variante inexistente retorna erro amigável", async () => {
    const client = mockClient({ responses: [{ data: null }] }); // resolveOwnedVariant
    mockSession(client);

    const result = await toggleProductVariantStatusAction(VARIANT_ID, false);

    expect(result.status).toBe("error");
    expect(result.message).toBe("Variante não encontrada.");
  });

  it("ativação/desativação válida devolve a lista já atualizada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: VARIANT_ID, product_id: PRODUCT_ID } }, // resolveOwnedVariant
        { error: null }, // update
        { data: [{ id: VARIANT_ID, sku: null, price: 100, promotional_price: null, is_active: false, option_value_ids: [VALUE_PRETO] }], error: null }, // getProductVariants
      ],
    });
    mockSession(client);

    const result = await toggleProductVariantStatusAction(VARIANT_ID, false);

    expect(result.status).toBe("success");
    expect(result.variants?.[0]?.isActive).toBe(false);
  });

  it("ator sem products.update é bloqueado antes de qualquer consulta", async () => {
    const client = mockClient({ hasPermission: false, responses: [] });
    mockSession(client);

    const result = await toggleProductVariantStatusAction(VARIANT_ID, false);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/permissão/i);
    expect(client.from).not.toHaveBeenCalled();
  });
});
