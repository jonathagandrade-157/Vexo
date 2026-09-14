import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D20.7 — `createProductAction` deixou de chamar `redirect()` no sucesso
 * (o `ProductGalleryUploader` pode ter arquivos selecionados ANTES do
 * save, que só podem ser enviados depois que um product_id real existe —
 * um redirect interromperia a resposta antes disso, e um `File` do
 * navegador não sobrevive a uma navegação de página de qualquer forma).
 * Passa a devolver `{status:"success", productId}`; `ProductForm` decide
 * quando navegar. Mesmo padrão de mock de
 * tests/unit/product-variant-actions.test.ts (D20.6): fila de respostas
 * de `.from()` por ordem de chamada, `.rpc()` despachado pelo nome.
 *
 * Cobre "Produto é criado somente uma vez" e "Arquivos são associados ao
 * product_id correto" (indiretamente — o productId devolvido é o mesmo
 * usado por ProductGalleryUploader para os uploads) do checklist de
 * testes da Etapa 20.7.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createProductAction } from "@/features/products/actions";
import { initialProductState } from "@/features/products/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

type FromResponse = { data?: unknown; error?: unknown };

function mockClient(opts: { hasPermission?: boolean; accessStatus?: string; responses: FromResponse[] }) {
  const queue = [...opts.responses];
  function nextResult(): FromResponse {
    const next = queue.shift();
    if (!next) throw new Error("mockClient: no more queued `from()` responses — chamada inesperada ao Supabase");
    return next;
  }
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: () => b,
      update: () => b,
      delete: () => b,
      upsert: () => b,
      eq: () => b,
      in: () => b,
      single: () => Promise.resolve(nextResult()),
      maybeSingle: () => Promise.resolve(nextResult()),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(nextResult()).then(resolve, reject),
    };
    return b;
  }
  return {
    from: vi.fn((_table: string) => builder()),
    rpc: vi.fn((name: string) => {
      if (name === "has_permission") return Promise.resolve({ data: opts.hasPermission ?? true, error: null });
      if (name === "tenant_access_status") return Promise.resolve({ data: opts.accessStatus ?? "ACTIVE", error: null });
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

function mockSession(client: ReturnType<typeof mockClient>) {
  vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
    tenant: { id: TENANT_ID, onboarding_completed_at: "2026-01-01T00:00:00.000Z" } as never,
    roleKey: "OWNER",
  } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
}

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * Um `<form>` real sempre manda TODOS os campos (até os vazios, como
 * `""`) — `formData.get(...)` só devolve `null` para uma chave que nunca
 * existiu no form, o que nunca acontece de verdade aqui (todo campo tem
 * seu `<input>`/`<textarea>` sempre renderizado). `description`/`sku` no
 * schema (`.optional().transform(v => v ? v : undefined)`, sem
 * `emptyToUndefined`) dependem dessa garantia: aceitam `""`, mas não
 * `null`. Por isso os testes sempre passam por este helper, nunca um
 * FormData minimalista com chaves ausentes.
 */
function validProductFormData(overrides: Record<string, string> = {}): FormData {
  return formDataOf({
    name: "Camiseta Básica",
    description: "",
    price: "50",
    promotionalPrice: "",
    sku: "",
    categoryId: "",
    weight: "",
    height: "",
    width: "",
    length: "",
    stockQuantity: "",
    lowStockThreshold: "",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProductAction (D20.7)", () => {
  it("criação válida devolve status success + productId, e NUNCA chama redirect()", async () => {
    const client = mockClient({
      responses: [
        { data: { id: PRODUCT_ID }, error: null }, // insert products .select("id").single()
        { error: null }, // applyProductStock: delete (stockQuantity ausente do form)
      ],
    });
    mockSession(client);

    const result = await createProductAction(initialProductState, validProductFormData());

    expect(result.status).toBe("success");
    expect(result.productId).toBe(PRODUCT_ID);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("cria o produto somente uma vez: exatamente um INSERT em products por chamada", async () => {
    const client = mockClient({
      responses: [{ data: { id: PRODUCT_ID }, error: null }, { error: null }],
    });
    mockSession(client);

    await createProductAction(initialProductState, validProductFormData());

    const productsCalls = client.from.mock.calls.filter((call) => call[0] === "products");
    expect(productsCalls).toHaveLength(1);
  });

  it("nome inválido é rejeitado pelo Zod antes de qualquer chamada ao banco", async () => {
    const client = mockClient({ responses: [] });
    mockSession(client);

    const result = await createProductAction(initialProductState, formDataOf({ name: "", price: "50" }));

    expect(result.status).toBe("error");
    expect(client.from).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ator sem products.create é bloqueado antes de qualquer INSERT", async () => {
    const client = mockClient({ hasPermission: false, responses: [] });
    mockSession(client);

    const result = await createProductAction(initialProductState, validProductFormData());

    expect(result.status).toBe("error");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("loja com acesso expirado/suspenso é bloqueada antes de qualquer INSERT", async () => {
    const client = mockClient({ accessStatus: "SUSPENDED", responses: [] });
    mockSession(client);

    const result = await createProductAction(initialProductState, validProductFormData());

    expect(result.status).toBe("error");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("nome duplicado (23505) retorna erro amigável de campo, sem productId", async () => {
    const client = mockClient({
      responses: [{ data: null, error: { code: "23505" } }],
    });
    mockSession(client);

    const result = await createProductAction(initialProductState, validProductFormData());

    expect(result.status).toBe("error");
    expect(result.productId).toBeUndefined();
    expect(result.fieldErrors?.name).toMatch(/já existe um produto/i);
  });
});
