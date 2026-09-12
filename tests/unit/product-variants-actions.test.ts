import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D20.6 Fase 3.1 — testa a camada de Server Action de
 * features/products/variants-actions.ts com o Supabase client mockado
 * (mesmo padrão de tests/unit/team-actions.test.ts): mensagens amigáveis
 * ("não encontrado", 23505→duplicidade, 23503→em uso), e a rejeição de
 * reorder inválido (delegada a isValidGalleryReorder, já testada
 * isoladamente em tests/unit/product-gallery-logic.test.ts — aqui só
 * confirmamos que a Action de fato consulta o estado real do banco antes
 * de aceitar a ordem, nunca confia no array do cliente).
 *
 * Isolamento de tenant (RLS) e as constraints reais do Postgres (23505/
 * 23503 de verdade) são testados contra o banco local em
 * tests/integration/product-options.test.ts — aqui simulamos os códigos
 * de erro que o Postgres devolveria, para testar como a Action os traduz.
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
  createProductOptionAction,
  createProductOptionValueAction,
  deleteProductOptionAction,
  deleteProductOptionValueAction,
  reorderProductOptionsAction,
  reorderProductOptionValuesAction,
  updateProductOptionAction,
  updateProductOptionValueAction,
} from "@/features/products/variants-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const OPTION_ID = "33333333-3333-4333-8333-333333333333";
const VALUE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_ID = "66666666-6666-4666-8666-666666666666";

type FromResponse = { data?: unknown; error?: unknown };

/**
 * Builder genérico que simula `supabase.from(table)...`: cada chamada a
 * `.select/.insert/.update/.delete/.eq/.in` é encadeável, e o resultado
 * final (seja via `.maybeSingle()` ou via `await` direto do builder) sai
 * de uma fila consumida em ordem — a mesma ordem em que
 * variants-actions.ts/variants-data.ts fazem as chamadas reais.
 */
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

describe("createProductOptionAction", () => {
  it("produto inexistente retorna erro amigável, sem tentar inserir", async () => {
    const client = mockClient({ responses: [{ data: null }] }); // resolveOwnedProduct → não encontrado
    mockSession(client);

    const result = await createProductOptionAction(PRODUCT_ID, "Cor");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Produto não encontrado.");
  });

  it("ator sem products.update é bloqueado antes de qualquer consulta ao produto", async () => {
    const client = mockClient({ hasPermission: false, responses: [] });
    mockSession(client);

    const result = await createProductOptionAction(PRODUCT_ID, "Cor");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/permissão/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("criação válida: devolve a lista de opções já atualizada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [], error: null }, // listOptionIdsForProduct (produto ainda sem opções → position 0)
        { error: null }, // insert
        { data: [{ id: OPTION_ID, name: "Cor", position: 0 }], error: null }, // getProductOptionsWithValues: options
        { data: [], error: null }, // getProductOptionsWithValues: values
      ],
    });
    mockSession(client);

    const result = await createProductOptionAction(PRODUCT_ID, "Cor");

    expect(result.status).toBe("success");
    expect(result.options).toEqual([{ id: OPTION_ID, name: "Cor", position: 0, values: [] }]);
  });

  it("nome duplicado (23505) vira mensagem amigável de duplicidade", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OTHER_ID }], error: null }, // listOptionIdsForProduct
        { error: { code: "23505" } }, // insert falha
      ],
    });
    mockSession(client);

    const result = await createProductOptionAction(PRODUCT_ID, "Cor");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/já existe uma opção/i);
  });
});

describe("updateProductOptionAction / deleteProductOptionAction", () => {
  it("opção inexistente (update) retorna erro amigável", async () => {
    const client = mockClient({ responses: [{ data: null }] }); // resolveOwnedOption
    mockSession(client);

    const result = await updateProductOptionAction(OPTION_ID, "Novo nome");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Opção não encontrada.");
  });

  it("atualização válida: devolve a lista já atualizada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOption
        { error: null }, // update
        { data: [{ id: OPTION_ID, name: "Tamanho", position: 0 }], error: null }, // options
        { data: [], error: null }, // values
      ],
    });
    mockSession(client);

    const result = await updateProductOptionAction(OPTION_ID, "Tamanho");

    expect(result.status).toBe("success");
    expect(result.options?.[0]?.name).toBe("Tamanho");
  });

  it("exclusão válida: devolve a lista já sem a opção removida", async () => {
    const client = mockClient({
      responses: [
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOption
        { error: null }, // delete
        { data: [], error: null }, // getProductOptionsWithValues (sem opções restantes → retorna cedo, sem 2ª query)
      ],
    });
    mockSession(client);

    const result = await deleteProductOptionAction(OPTION_ID);

    expect(result.status).toBe("success");
    expect(result.options).toEqual([]);
  });

  it("opção em uso por uma variante (23503) retorna mensagem amigável, nunca o código SQL", async () => {
    const client = mockClient({
      responses: [
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOption
        { error: { code: "23503" } }, // delete falha (FK RESTRICT via product_variant_options)
      ],
    });
    mockSession(client);

    const result = await deleteProductOptionAction(OPTION_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/em uso/i);
    expect(result.message ?? "").not.toMatch(/23503|restrict|constraint/i);
  });
});

describe("reorderProductOptionsAction", () => {
  it("reorder válido (permutação exata do estado atual) é aceito", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_ID }, { id: OTHER_ID }], error: null }, // listOptionIdsForProduct
        {}, // update position (OTHER_ID)
        {}, // update position (OPTION_ID)
        { data: [{ id: OTHER_ID, name: "B", position: 0 }, { id: OPTION_ID, name: "A", position: 1 }], error: null }, // options
        { data: [], error: null }, // values
      ],
    });
    mockSession(client);

    const result = await reorderProductOptionsAction(PRODUCT_ID, [OTHER_ID, OPTION_ID]);

    expect(result.status).toBe("success");
  });

  it("reorder com ID de outro produto (não pertence ao estado atual) é rejeitado, sem escrever nada", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_ID }], error: null }, // listOptionIdsForProduct — só OPTION_ID pertence de fato
      ],
    });
    mockSession(client);

    const result = await reorderProductOptionsAction(PRODUCT_ID, [FOREIGN_ID]);

    expect(result.status).toBe("error");
    expect(result.message).toBe("Ordem inválida.");
  });

  it("reorder com ID faltando (subconjunto do estado atual) é rejeitado", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID } }, // resolveOwnedProduct
        { data: [{ id: OPTION_ID }, { id: OTHER_ID }], error: null }, // listOptionIdsForProduct — 2 opções existem
      ],
    });
    mockSession(client);

    const result = await reorderProductOptionsAction(PRODUCT_ID, [OPTION_ID]); // só manda 1 das 2

    expect(result.status).toBe("error");
    expect(result.message).toBe("Ordem inválida.");
  });

  it("reorder com ID duplicado no pedido é rejeitado já na validação Zod, antes de qualquer consulta", async () => {
    const client = mockClient({ responses: [] });
    mockSession(client);

    const result = await reorderProductOptionsAction(PRODUCT_ID, [OPTION_ID, OPTION_ID]);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/duplicados/i);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("createProductOptionValueAction / deleteProductOptionValueAction / reorderProductOptionValuesAction", () => {
  it("valor duplicado (23505) vira mensagem amigável", async () => {
    const client = mockClient({
      responses: [
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOption
        { data: [], error: null }, // listValueIdsForOption
        { error: { code: "23505" } }, // insert falha
      ],
    });
    mockSession(client);

    const result = await createProductOptionValueAction(OPTION_ID, "Preto");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/já existe um valor/i);
  });

  it("valor em uso por uma variante (23503) vira mensagem amigável ao excluir", async () => {
    const client = mockClient({
      responses: [
        { data: { id: VALUE_ID, product_option_id: OPTION_ID } }, // resolveOwnedOptionValue: linha do valor
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOptionValue: resolveOwnedOption por baixo
        { error: { code: "23503" } }, // delete falha
      ],
    });
    mockSession(client);

    const result = await deleteProductOptionValueAction(VALUE_ID);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/em uso/i);
  });

  it("reorder de valores com ID de outra opção é rejeitado", async () => {
    const client = mockClient({
      responses: [
        { data: { id: OPTION_ID, product_id: PRODUCT_ID } }, // resolveOwnedOption
        { data: [{ id: VALUE_ID }], error: null }, // listValueIdsForOption — só VALUE_ID pertence de fato
      ],
    });
    mockSession(client);

    const result = await reorderProductOptionValuesAction(OPTION_ID, [FOREIGN_ID]);

    expect(result.status).toBe("error");
    expect(result.message).toBe("Ordem inválida.");
  });
});
