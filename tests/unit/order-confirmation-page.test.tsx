import { describe, expect, it, vi } from "vitest";

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

import { StorefrontShell } from "@/components/storefront/storefront-shell";
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

function paramsFor(orderId: string) {
  return { params: Promise.resolve({ slug: TENANT.slug, orderId }) };
}

describe("OrderConfirmationPage — bloqueio de billing (JON-17, ajuste pós-revisão)", () => {
  it("pedido existente de um tenant billing_blocked continua acessível — nunca StorefrontUnavailable", async () => {
    const blockedResolution: StorefrontResolution = { status: "billing_blocked", tenant: TENANT };
    vi.mocked(resolveStorefrontTenant).mockResolvedValue(blockedResolution);
    vi.mocked(getOrderConfirmation).mockResolvedValue(ORDER);

    const element = await OrderConfirmationPage(paramsFor("order-1"));

    expect(element.type).not.toBe(StorefrontUnavailable);
    expect(element.type).toBe(StorefrontShell);
    // Prova que a página seguiu o fluxo real (não um retorno antecipado
    // genérico): getOrderConfirmation foi chamado com o tenant resolvido,
    // mesmo estando billing_blocked.
    expect(getOrderConfirmation).toHaveBeenCalledWith(TENANT.id, "order-1");
  });
});
