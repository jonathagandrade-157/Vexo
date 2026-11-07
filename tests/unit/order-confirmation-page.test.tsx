import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * JON-17 (ajuste pós-revisão) — `app/loja/[slug]/pedido/[orderId]/page.tsx`
 * é a ÚNICA rota do storefront que deliberadamente IGNORA
 * `resolution.status === "billing_blocked"`: é a página de confirmação de
 * um pedido JÁ FEITO (inclusive o painel de PIX pendente), mesmo
 * princípio que mantém updateOrderStatusAction/confirmExternalPaymentAction
 * fora do bloqueio de escrita — proteger o cliente final tem prioridade, e
 * aqui é ainda mais crítico: um PIX pendente nesta página pode ser
 * literalmente o pagamento que regulariza a inadimplência do lojista.
 *
 * Mesmo princípio de teste de `product-create-action.test.ts` (mock direto
 * do client/funções de dados, chamando a Server Action/Server Component
 * como uma função comum) — Server Component é só uma função async que
 * devolve uma árvore de elementos React (objeto puro `{type, props}`),
 * então dá pra chamar e inspecionar sem renderizar/jsdom (vitest.config.ts
 * roda em `environment: "node"`).
 */
vi.mock("@/features/storefront/resolve-tenant", () => ({
  resolveStorefrontTenant: vi.fn(),
}));
vi.mock("@/features/checkout/order-confirmation", () => ({
  getOrderConfirmation: vi.fn(),
}));
vi.mock("@/features/checkout/pix-payment", () => ({
  getPixPaymentDetails: vi.fn(),
}));
vi.mock("@/features/checkout/store-address", () => ({
  getStoreAddress: vi.fn(),
}));
vi.mock("@/features/checkout/whatsapp-link", () => ({
  getWhatsappOrderLink: vi.fn(),
}));

import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { orderConfirmationPath } from "@/features/checkout/order-access";
import { StorefrontUnavailable } from "@/components/storefront/storefront-unavailable";
import { getOrderConfirmation, type OrderConfirmation } from "@/features/checkout/order-confirmation";
import type { PublicTenant, StorefrontResolution } from "@/features/storefront/resolve-tenant";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import OrderConfirmationPage from "@/app/loja/[slug]/pedido/[orderId]/page";

const TENANT: PublicTenant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Loja Teste",
  slug: "loja-teste",
  segment: null,
  description: null,
  instagram_handle: null,
  whatsapp_phone: null,
  contact_email: null,
  logo_url: null,
  primary_color: null,
  secondary_color: null,
  storefront_template: "commerce",
  checkout_mode: "vexo",
};

const ORDER: OrderConfirmation = {
  orderNumber: "1001",
  status: "confirmed",
  // Cenário mais crítico: PIX pendente — literalmente o pagamento que
  // pode regularizar a inadimplência do lojista.
  paymentStatus: "PENDING",
  orderSource: "vexo_checkout",
  requestedPaymentMethod: null,
  cashChangeFor: null,
  customerName: "Maria",
  shippingAddress: {
    zip: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
  },
  shippingMethod: "Entrega padrão",
  shippingProvider: "flat_rate",
  shippingEstimatedDays: 5,
  subtotal: 100,
  shippingTotal: 10,
  discountTotal: 0,
  total: 110,
  createdAt: new Date().toISOString(),
  items: [
    {
      productName: "Produto X",
      productSlug: "produto-x",
      quantity: 1,
      unitPrice: 100,
      subtotal: 100,
      variantId: null,
      variantSku: null,
      variantLabel: null,
      variantOptions: null,
    },
  ],
};

const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ORDER_ID = "44444444-4444-4444-8444-444444444444";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon-key";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX ??= "vexo.local";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service-role-key";
process.env.TRIAL_HASH_SECRET ??= "placeholder-trial-hash-secret-not-real";

function tokenFor(tenantId: string, orderId: string): string {
  return new URL(orderConfirmationPath(TENANT.slug, tenantId, orderId), "http://x").searchParams.get("acesso")!;
}

function paramsFor(orderId: string, acesso?: string | string[]) {
  return {
    params: Promise.resolve({ slug: TENANT.slug, orderId }),
    searchParams: Promise.resolve(acesso === undefined ? {} : { acesso }),
  };
}

function emptyStateOf(element: Awaited<ReturnType<typeof OrderConfirmationPage>>) {
  const child = (element.props as { children: { type: unknown; props: { title: string } } }).children;
  return child.type === StorefrontEmptyState ? child.props.title : null;
}

beforeEach(() => {
  vi.mocked(getOrderConfirmation).mockReset();
  vi.mocked(resolveStorefrontTenant).mockResolvedValue({ status: "ready", tenant: TENANT });
  vi.mocked(getOrderConfirmation).mockResolvedValue(ORDER);
});

describe("OrderConfirmationPage — bloqueio de billing (JON-17, ajuste pós-revisão)", () => {
  it("pedido existente de um tenant billing_blocked continua acessível — nunca StorefrontUnavailable", async () => {
    const blockedResolution: StorefrontResolution = { status: "billing_blocked", tenant: TENANT };
    vi.mocked(resolveStorefrontTenant).mockResolvedValue(blockedResolution);

    const element = await OrderConfirmationPage(paramsFor(ORDER_ID, tokenFor(TENANT.id, ORDER_ID)));

    expect(element.type).not.toBe(StorefrontUnavailable);
    expect(element.type).toBe(StorefrontShell);
    // Prova que a página seguiu o fluxo real (não um retorno antecipado
    // genérico): getOrderConfirmation foi chamado com o tenant resolvido,
    // mesmo estando billing_blocked.
    expect(getOrderConfirmation).toHaveBeenCalledWith(TENANT.id, ORDER_ID);
    expect(emptyStateOf(element)).toBeNull();
  });
});

describe("OrderConfirmationPage — prova de posse assinada", () => {
  it("link legítimo emitido pelo servidor abre a confirmação", async () => {
    const element = await OrderConfirmationPage(paramsFor(ORDER_ID, tokenFor(TENANT.id, ORDER_ID)));
    expect(emptyStateOf(element)).toBeNull();
    expect(getOrderConfirmation).toHaveBeenCalledWith(TENANT.id, ORDER_ID);
  });

  const denied: Array<[string, () => string | string[] | undefined]> = [
    ["URL sem prova (apenas o UUID do pedido)", () => undefined],
    ["prova vazia", () => ""],
    ["assinatura adulterada", () => tokenFor(TENANT.id, ORDER_ID).replace(/.$/, (c) => (c === "A" ? "B" : "A"))],
    ["expiração adulterada para o futuro", () => {
      const [, sig] = tokenFor(TENANT.id, ORDER_ID).split(".");
      return `${(Math.floor(Date.now() / 1000) + 10 ** 9).toString(36)}.${sig}`;
    }],
    ["prova de outra loja usada com este slug", () => tokenFor(OTHER_TENANT_ID, ORDER_ID)],
    ["prova de outro pedido da mesma loja", () => tokenFor(TENANT.id, OTHER_ORDER_ID)],
    ["parâmetro repetido", () => [tokenFor(TENANT.id, ORDER_ID), tokenFor(TENANT.id, ORDER_ID)]],
  ];
  for (const [label, token] of denied) {
    it(`${label}: responde como pedido inexistente, sem consultar o banco`, async () => {
      const element = await OrderConfirmationPage(paramsFor(ORDER_ID, token()));
      expect(emptyStateOf(element)).toBe("Pedido não encontrado");
      expect(getOrderConfirmation).not.toHaveBeenCalled();
    });
  }

  it("identificador que não é UUID nunca chega à RPC", async () => {
    const element = await OrderConfirmationPage(paramsFor("1001", tokenFor(TENANT.id, ORDER_ID)));
    expect(emptyStateOf(element)).toBe("Pedido não encontrado");
    expect(getOrderConfirmation).not.toHaveBeenCalled();
  });

  it("prova legítima expirada mostra aviso de expiração, sem dados do pedido", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = tokenFor(TENANT.id, ORDER_ID);
      vi.setSystemTime(new Date("2026-02-01T00:00:01Z"));
      const element = await OrderConfirmationPage(paramsFor(ORDER_ID, token));
      expect(emptyStateOf(element)).toBe("Link do pedido expirado");
      expect(getOrderConfirmation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
