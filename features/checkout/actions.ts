"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getOwnedCartForCheckout } from "@/features/cart/ownership";
import { initiatePaymentForOrder, isPaymentGatewayConnected } from "@/features/payments/checkout";
import { isShippingRequired, verifyShippingPriceFresh } from "@/features/shipping/checkout";
import { verifyMelhorEnvioShippingFresh } from "@/features/shipping/melhor-envio-checkout";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { sendOrderConfirmationEmail } from "@/lib/email/send-order-confirmation";
import { checkCheckoutRateLimit } from "./rate-limit";
import { createOwnedOrder, type CheckoutShippingSelection } from "./create-owned-order";
import { checkoutSchema, friendlyCheckoutError, isAddressComplete, type CheckoutActionState, type CheckoutInput } from "./schema";

function fieldErrorsFrom(parsed: ReturnType<typeof checkoutSchema.safeParse>): CheckoutActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: CheckoutActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof CheckoutInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createOrderAction(
  storeSlug: string,
  _prevState: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const parsed = checkoutSchema.safeParse({
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
    customerPhone: formData.get("customerPhone"),
    zip: formData.get("zip"),
    street: formData.get("street"),
    number: formData.get("number"),
    complement: formData.get("complement"),
    neighborhood: formData.get("neighborhood"),
    city: formData.get("city"),
    state: formData.get("state"),
    shippingMethodId: formData.get("shippingMethodId"),
    shippingPrice: formData.get("shippingPrice"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolution = await resolveStorefrontTenant(storeSlug);
  if (resolution.status !== "ready") {
    return { status: "error", message: "Esta loja não está disponível no momento." };
  }

  // D19.1.3.1 (H1) — o mais cedo possível, antes de qualquer outra
  // validação/consulta: nunca vale a pena gastar trabalho num pedido que
  // já vai ser recusado por taxa. Ver features/checkout/rate-limit.ts
  // para o porquê de fail-open aqui (diferente da cotação de frete).
  const rateLimit = await checkCheckoutRateLimit(resolution.tenant.id);
  if (rateLimit.limited) {
    return { status: "error", message: rateLimit.message };
  }

  // Fase D2-B — defesa em profundidade independente da checagem de
  // gateway abaixo: uma loja `checkout_mode = 'whatsapp'` nunca deve
  // aceitar o caminho de pagamento online por esta Action, mesmo que o
  // Mercado Pago esteja conectado (ex.: loja que conectou antes de trocar
  // para "só WhatsApp") — a decisão é sempre do servidor, nunca da UI que
  // o cliente carregou.
  if (resolution.tenant.checkout_mode === "whatsapp") {
    return { status: "error", message: "Esta loja recebe pedidos apenas pelo WhatsApp." };
  }

  // Defesa em profundidade — a página de checkout já bloqueia o
  // formulário quando não há gateway conectado (prompt §19), mas o
  // estado da página pode estar desatualizado.
  if (!(await isPaymentGatewayConnected(resolution.tenant.id))) {
    return { status: "error", message: "Esta loja ainda não possui um meio de pagamento configurado." };
  }

  const cart = await getOwnedCartForCheckout(storeSlug, resolution.tenant.id);
  if (!cart) {
    return { status: "error", message: "Seu carrinho está vazio. Volte para a loja e adicione produtos." };
  }

  // Retry após uma resposta perdida: o carrinho já aponta para o pedido
  // criado. Nunca cria outro pedido; a chave estável do gateway também
  // impede outra preference/cobrança para o mesmo orderId.
  if (cart.checkoutOrderId) {
    const payment = await initiatePaymentForOrder(
      resolution.tenant.id,
      cart.checkoutOrderId,
      parsed.data.customerEmail,
      storeSlug,
    );
    if ("checkoutUrl" in payment) redirect(payment.checkoutUrl);
    redirect(`/loja/${storeSlug}/pedido/${cart.checkoutOrderId}`);
  }

  const { customerName, customerEmail, customerPhone, shippingMethodId, shippingPrice, shippingProvider, zip } = parsed.data;

  // Se a loja exige frete (shipping_settings.enabled = true), a seleção
  // de modalidade é obrigatória — nunca opcional só porque o cliente
  // (ou uma chamada direta ao Server Action, fora do formulário) omitiu
  // os campos (achado da revisão de segurança: sem este bloqueio, era
  // possível finalizar com shipping_total = 0 numa loja com entrega
  // paga configurada, só não enviando shippingMethodId/shippingPrice).
  let isPickup = false;
  let melhorEnvioShipping: { serviceId: string; name: string; price: number; estimatedDays: number | null } | null = null;

  if (shippingProvider === "melhor_envio") {
    // D3.2-B Ponto 2E: Melhor Envio nunca é retirada na loja (sempre
    // exige o endereço do cliente) e NUNCA cai silenciosamente para
    // flat_rate se a recotação falhar — rejeita a finalização, sempre.
    // `shippingMethodId` aqui é o serviceId da cotação (nunca um uuid de
    // shipping_methods); `shippingPrice` é só o que o cliente viu na
    // tela, usado apenas para detectar divergência contra uma cotação
    // NOVA (nunca a de `/api/shipping/quote`, nunca cache).
    if (shippingMethodId === undefined || shippingPrice === undefined || !zip) {
      return { status: "error", message: "Selecione uma opção de entrega antes de finalizar o pedido." };
    }
    const fresh = await verifyMelhorEnvioShippingFresh(resolution.tenant.id, cart.id, zip, shippingMethodId, shippingPrice);
    if (!fresh.valid) {
      return {
        status: "error",
        message: "O valor do frete mudou ou não está mais disponível. Atualize a página e selecione a opção de entrega novamente.",
      };
    }
    melhorEnvioShipping = fresh;
  } else if (shippingMethodId === undefined || shippingPrice === undefined) {
    if (await isShippingRequired(resolution.tenant.id)) {
      return { status: "error", message: "Selecione uma opção de entrega antes de finalizar o pedido." };
    }
  } else {
    // Revalida o frete ANTES de criar o pedido (prompt Etapa 12 §23:
    // nunca aplicar silenciosamente um valor diferente do que o cliente
    // viu) — se o preço já mudou, o pedido nem chega a ser criado,
    // evitando um pedido "órfão" sem frete aplicável. D3.1: também
    // resolve a modalidade real (nunca a que o cliente enviou) — só ela
    // decide se o endereço de entrega é obrigatório.
    const fresh = await verifyShippingPriceFresh(resolution.tenant.id, shippingMethodId, shippingPrice);
    if (!fresh.valid) {
      return {
        status: "error",
        message: "O valor do frete mudou. Atualize a página e selecione a opção de entrega novamente.",
      };
    }
    isPickup = fresh.type === "pickup";
  }

  // D3.1 §7/§2: retirada na loja não tem endereço de entrega do cliente —
  // os campos são descartados por completo (nunca "validados e ignorados
  // depois"), nunca o endereço da loja é usado como se fosse do cliente.
  // Para as demais modalidades, o endereço continua obrigatório, mesmo
  // comportamento de antes do D3.1.
  let shippingAddress: Record<string, string | null> | null = null;
  if (!isPickup) {
    if (!isAddressComplete(parsed.data)) {
      return { status: "error", message: "Informe o endereço de entrega completo." };
    }
    const { street, number, complement, neighborhood, city, state } = parsed.data;
    shippingAddress = { zip: zip as string, street, number, complement: complement ?? null, neighborhood, city, state };
  }

  const shipping: CheckoutShippingSelection = melhorEnvioShipping
    ? { kind: "melhor_envio", ...melhorEnvioShipping }
    : shippingMethodId !== undefined && shippingPrice !== undefined
      ? { kind: "method", methodId: shippingMethodId, expectedPrice: shippingPrice }
      : { kind: "none" };

  const checkout = await createOwnedOrder({
    tenantId: resolution.tenant.id,
    cartId: cart.id,
    ownerTokenHash: cart.ownerTokenHash,
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    orderSource: "vexo_checkout",
    paymentChannel: "gateway",
    requestedPaymentMethod: null,
    cashChangeFor: null,
    shipping,
  });

  if (!checkout.ok) {
    return { status: "error", message: friendlyCheckoutError(checkout.error) };
  }
  const { orderId } = checkout;

  revalidatePath(`/loja/${storeSlug}`);
  revalidatePath(`/loja/${storeSlug}/carrinho`);

  // JON-13 — e-mail de "recebemos seu pedido" (nunca "confirmado": o
  // pagamento ainda nem foi iniciado neste ponto). `after()` (não um
  // `await` direto) para nunca atrasar o redirect abaixo com a latência
  // do Resend — roda depois da resposta ser enviada, mesmo quando
  // `redirect()` é chamado (doc do Next.js), cobrindo tanto o redirect
  // interno (confirmação própria) quanto o externo (checkout do Mercado
  // Pago) sem precisar duplicar esta chamada em nenhum dos dois.
  if (checkout.created) {
    after(() =>
      sendOrderConfirmationEmail({
        tenantId: resolution.tenant.id,
        orderId,
        customerEmail,
        storeName: resolution.tenant.name,
        storeSlug,
      }),
    );
  }

  // O pedido já existe e o carrinho já foi limpo (create_order_from_cart,
  // Etapa 10) — se o passo de pagamento falhar daqui pra frente, o
  // cliente ainda cai na confirmação (que mostra o status real,
  // "pendente") em vez de ficar numa tela de erro sem saber se o pedido
  // existe.
  const payment = await initiatePaymentForOrder(resolution.tenant.id, orderId, customerEmail, storeSlug);
  if ("checkoutUrl" in payment) {
    redirect(payment.checkoutUrl);
  }
  redirect(`/loja/${storeSlug}/pedido/${orderId}`);
}
