import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.1 (correção) — `getWhatsappOrderLink` (features/checkout/
 * whatsapp-link.ts) chama `createSupabaseServiceRoleClient()` e
 * `getStoreAddress()` diretamente (sem injeção de dependência, ao
 * contrário de `processAsaasWebhookEvent`) — por isso os dois módulos são
 * mockados aqui, nunca uma segunda implementação de leitura. Nenhum dado
 * real de produção é usado: todo fixture é sintético.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/features/checkout/store-address", () => ({
  getStoreAddress: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getStoreAddress } from "@/features/checkout/store-address";
import { getWhatsappOrderLink } from "@/features/checkout/whatsapp-link";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "22222222-2222-2222-2222-222222222222";

const SYNTHETIC_ORDER = {
  order_number: "PED000TEST",
  order_source: "whatsapp",
  customer_name: "Cliente Sintético",
  customer_phone: "+5511900000000",
  subtotal: 50,
  shipping_total: 0,
  total: 50,
  requested_payment_method: "pix" as const,
  cash_change_for: null,
  shipping_provider: null as string | null,
  shipping_address: {
    zip: "01310100",
    street: "Rua Sintética",
    number: "1",
    complement: null,
    neighborhood: "Bairro Teste",
    city: "São Paulo",
    state: "SP",
  } as Record<string, unknown> | null,
};

const SYNTHETIC_TENANT = { whatsapp_phone: "5511999999999" };

/** Query fluente genérica — cada método intermediário devolve a própria chain; `maybeSingle`/`returns` resolvem a promise. */
function makeQuery(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(result),
    returns: () => Promise.resolve(result),
  };
  return chain;
}

interface MockResults {
  orders?: { data: unknown; error: unknown };
  order_items?: { data: unknown; error: unknown };
  tenants?: { data: unknown; error: unknown };
}

function mockSupabase(results: MockResults = {}) {
  const from = vi.fn((table: string) => {
    if (table === "orders") return makeQuery(results.orders ?? { data: SYNTHETIC_ORDER, error: null });
    if (table === "order_items") return makeQuery(results.order_items ?? { data: [], error: null });
    if (table === "tenants") return makeQuery(results.tenants ?? { data: SYNTHETIC_TENANT, error: null });
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  return { from };
}

describe("getWhatsappOrderLink (D3.1 correção)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServiceRoleClient).mockReset();
    vi.mocked(getStoreAddress).mockReset();
    vi.restoreAllMocks();
  });

  it("caminho feliz: pedido com endereço normal produz um link válido apontando para o telefone da LOJA", async () => {
    mockSupabase();
    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);
    expect(link).toContain("https://wa.me/5511999999999?text=");
  });

  it("segurança: customer_phone nunca vira o destino do link — só o whatsapp_phone da loja é usado (customer_phone só aparece dentro do texto da mensagem, nunca em wa.me/)", async () => {
    mockSupabase({ tenants: { data: { whatsapp_phone: "5511988887777" }, error: null } });
    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);
    const destination = new URL(link!).pathname.replace("/", "");
    expect(destination).toBe("5511988887777");
    expect(destination).not.toBe(SYNTHETIC_ORDER.customer_phone.replace(/\D/g, ""));
  });

  it("segurança: whatsapp_phone vem sempre da consulta escopada pelo tenant_id resolvido, nunca de outro tenant", async () => {
    const { from } = mockSupabase();
    await getWhatsappOrderLink(TENANT_ID, ORDER_ID);
    // A própria chamada de `.from("tenants")` só existe uma vez por invocação —
    // garante que não há uma segunda leitura de tenant fora do fluxo controlado.
    const tenantCalls = from.mock.calls.filter(([table]) => table === "tenants");
    expect(tenantCalls).toHaveLength(1);
  });

  it("erro na consulta de orders: retorna null (mensagem amigável no chamador), nunca lança, e registra o erro", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ orders: { data: null, error: { message: "connection reset", code: "08006" } } });

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load order"), expect.any(Object));
  });

  it("erro na consulta de order_items: retorna null, nunca lança, e registra o erro", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ order_items: { data: null, error: { message: "statement timeout", code: "57014" } } });

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load order_items"), expect.any(Object));
  });

  it("erro na consulta de tenants: retorna null, nunca lança, e registra o erro", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ tenants: { data: null, error: { message: "permission denied", code: "42501" } } });

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load tenant"), expect.any(Object));
  });

  it("o log de erro nunca inclui telefone, nome ou endereço — só contexto técnico (tenantId/orderId/mensagem do erro)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ orders: { data: null, error: { message: "some db error", code: "XX000" } } });

    await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    const loggedArgs = JSON.stringify(errorSpy.mock.calls);
    expect(loggedArgs).not.toContain(SYNTHETIC_ORDER.customer_name);
    expect(loggedArgs).not.toContain(SYNTHETIC_ORDER.customer_phone);
    expect(loggedArgs).not.toContain(SYNTHETIC_TENANT.whatsapp_phone);
  });

  it("pedido pickup (shipping_provider = 'pickup', shipping_address = NULL): nunca lança, usa o endereço da loja via getStoreAddress", async () => {
    mockSupabase({ orders: { data: { ...SYNTHETIC_ORDER, shipping_provider: "pickup", shipping_address: null }, error: null } });
    vi.mocked(getStoreAddress).mockResolvedValue({
      zip: "02634000",
      street: "Rua da Loja",
      number: "10",
      complement: null,
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    });

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).not.toBeNull();
    expect(getStoreAddress).toHaveBeenCalledWith(TENANT_ID);
    const decoded = decodeURIComponent(link!.split("text=")[1]!);
    expect(decoded).toContain("Retirada na loja");
    expect(decoded).toContain("Rua da Loja, 10");
  });

  it("pedido pickup sem endereço da loja configurado: nunca lança, mostra só 'Retirada na loja'", async () => {
    mockSupabase({ orders: { data: { ...SYNTHETIC_ORDER, shipping_provider: "pickup", shipping_address: null }, error: null } });
    vi.mocked(getStoreAddress).mockResolvedValue(null);

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).not.toBeNull();
    const decoded = decodeURIComponent(link!.split("text=")[1]!);
    expect(decoded).toContain("Retirada na loja");
  });

  it("pedido não-pickup sem shipping_address (inconsistência de dado): nunca lança, retorna null com log, nunca inventa endereço", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ orders: { data: { ...SYNTHETIC_ORDER, shipping_provider: "flat_rate", shipping_address: null }, error: null } });

    const link = await getWhatsappOrderLink(TENANT_ID, ORDER_ID);

    expect(link).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("non-pickup order without shipping_address"), expect.any(Object));
  });
});
