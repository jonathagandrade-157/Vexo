import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * JON-13 — camada de I/O de `sendOrderConfirmationEmail`: nunca pode
 * lançar de volta pro chamador (roda dentro de after(), a resposta ao
 * cliente já foi enviada) e nunca pode falhar em silêncio pra sempre em
 * produção (ajuste da revisão: RESEND_API_KEY ausente vira
 * Sentry.captureMessage — nunca exception — só quando NODE_ENV ===
 * "production"; em dev/test é sempre um no-op silencioso, mesmo padrão
 * de toda integração opcional deste projeto). `buildOrderConfirmationEmail`
 * (já testada isoladamente em order-confirmation-email-template.test.ts)
 * NÃO é mockada aqui — só os limites reais de I/O (env, Supabase via
 * getOrderConfirmation, Resend, Sentry) são.
 */
vi.mock("@/lib/env", () => ({
  getEmailEnv: vi.fn(),
  getPublicEnv: vi.fn(() => ({ NEXT_PUBLIC_SITE_URL: "https://vexoecommerce.vercel.app" })),
}));
vi.mock("@/features/checkout/order-confirmation", () => ({
  getOrderConfirmation: vi.fn(),
}));
const sendMock = vi.fn();
vi.mock("resend", () => ({
  // Precisa ser `function`, não arrow function: `new Resend(...)` invoca
  // isto via construtor, e arrow functions não podem ser usadas com `new`.
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: sendMock } };
  }),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { getEmailEnv } from "@/lib/env";
import { getOrderConfirmation, type OrderConfirmation } from "@/features/checkout/order-confirmation";
import { sendOrderConfirmationEmail } from "@/lib/email/send-order-confirmation";

const INPUT = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  customerEmail: "cliente@example.com",
  storeName: "Loja Teste",
  storeSlug: "loja-teste",
};

const ORDER: OrderConfirmation = {
  orderNumber: "1001",
  status: "confirmed",
  paymentStatus: "PENDING",
  orderSource: "vexo_checkout",
  requestedPaymentMethod: null,
  cashChangeFor: null,
  customerName: "Maria",
  shippingAddress: null,
  shippingMethod: null,
  shippingProvider: "pickup",
  shippingEstimatedDays: null,
  subtotal: 100,
  shippingTotal: 0,
  discountTotal: 0,
  total: 100,
  createdAt: new Date().toISOString(),
  items: [
    {
      productName: "Camiseta",
      productSlug: "camiseta",
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

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV é `readonly` no tipo de @types/node (nunca em runtime) — cast
  // pontual só pra este helper de teste, nunca usado fora daqui.
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("sendOrderConfirmationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNodeEnv(originalNodeEnv ?? "test");
  });

  it("RESEND_API_KEY ausente em dev/test: no-op silencioso, sem Sentry, sem tentar enviar", async () => {
    setNodeEnv("test");
    vi.mocked(getEmailEnv).mockImplementation(() => {
      throw new Error("A integração de e-mail (Resend) não está configurada neste ambiente.");
    });

    await sendOrderConfirmationEmail(INPUT);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(getOrderConfirmation).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("RESEND_API_KEY ausente em produção: avisa via Sentry.captureMessage (nunca exception), sem tentar enviar", async () => {
    setNodeEnv("production");
    vi.mocked(getEmailEnv).mockImplementation(() => {
      throw new Error("A integração de e-mail (Resend) não está configurada neste ambiente.");
    });

    await sendOrderConfirmationEmail(INPUT);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(Sentry.captureMessage).mock.calls[0]!;
    expect(message).toMatch(/RESEND_API_KEY não configurada em produção/);
    expect(options).toMatchObject({ level: "warning", extra: { tenantId: INPUT.tenantId, orderId: INPUT.orderId } });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("pedido não encontrado (getOrderConfirmation devolve null): avisa via Sentry.captureMessage (nível error), nunca tenta enviar", async () => {
    vi.mocked(getEmailEnv).mockReturnValue({ RESEND_API_KEY: "re_test", EMAIL_FROM: "onboarding@resend.dev" });
    vi.mocked(getOrderConfirmation).mockResolvedValue(null);

    await sendOrderConfirmationEmail(INPUT);

    expect(sendMock).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(Sentry.captureMessage).mock.calls[0]!;
    expect(message).toMatch(/pedido não encontrado logo após ser criado/);
    expect(options).toMatchObject({ level: "error", extra: { tenantId: INPUT.tenantId, orderId: INPUT.orderId } });
  });

  it("envio bem-sucedido: chama resend.emails.send com from/to/subject/html corretos, sem Sentry", async () => {
    vi.mocked(getEmailEnv).mockReturnValue({ RESEND_API_KEY: "re_test", EMAIL_FROM: "onboarding@resend.dev" });
    vi.mocked(getOrderConfirmation).mockResolvedValue(ORDER);
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await sendOrderConfirmationEmail(INPUT);

    expect(getOrderConfirmation).toHaveBeenCalledWith(INPUT.tenantId, INPUT.orderId);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.from).toBe("onboarding@resend.dev");
    expect(payload.to).toBe(INPUT.customerEmail);
    expect(payload.subject).toBe("Recebemos seu pedido #1001 — Loja Teste");
    expect(payload.html).toContain("Recebemos seu pedido");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("Resend devolve {error}: captura via Sentry.captureException, nunca lança", async () => {
    vi.mocked(getEmailEnv).mockReturnValue({ RESEND_API_KEY: "re_test", EMAIL_FROM: "onboarding@resend.dev" });
    vi.mocked(getOrderConfirmation).mockResolvedValue(ORDER);
    sendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "Invalid `to` field.", statusCode: 422 } });

    await expect(sendOrderConfirmationEmail(INPUT)).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [error, options] = vi.mocked(Sentry.captureException).mock.calls[0]!;
    expect((error as Error).message).toMatch(/validation_error/);
    expect(options).toMatchObject({ extra: { tenantId: INPUT.tenantId, orderId: INPUT.orderId } });
  });

  it("resend.emails.send lança (falha de rede): captura via Sentry.captureException, nunca lança de volta", async () => {
    vi.mocked(getEmailEnv).mockReturnValue({ RESEND_API_KEY: "re_test", EMAIL_FROM: "onboarding@resend.dev" });
    vi.mocked(getOrderConfirmation).mockResolvedValue(ORDER);
    const networkError = new Error("fetch failed");
    sendMock.mockRejectedValue(networkError);

    await expect(sendOrderConfirmationEmail(INPUT)).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledWith(networkError, { extra: { tenantId: INPUT.tenantId, orderId: INPUT.orderId } });
  });
});
