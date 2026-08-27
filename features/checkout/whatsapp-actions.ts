"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getCart } from "@/features/cart/data";
import { getCartId } from "@/features/cart/cart-cookie";
import { getStorePixSettings } from "@/features/checkout/pix-settings";
import { applyShippingToOrder, isShippingRequired, verifyShippingPriceFresh } from "@/features/shipping/checkout";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { friendlyCheckoutError } from "./schema";
import { whatsappCheckoutSchema, type CheckoutWhatsappActionState, type WhatsappCheckoutInput } from "./whatsapp-schema";

function fieldErrorsFrom(
  parsed: ReturnType<typeof whatsappCheckoutSchema.safeParse>,
): CheckoutWhatsappActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: CheckoutWhatsappActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof WhatsappCheckoutInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/**
 * Fase D2-B (revisão final). Mesma estrutura de `features/checkout/
 * actions.ts::createOrderAction` — mesma resolução de tenant/carrinho/
 * frete, mesma RPC `create_order_from_cart` — só o que muda é o que é
 * passado a ela e o que acontece depois (nunca Mercado Pago).
 * `order_source`/`payment_channel` são SEMPRE fixados aqui como
 * constantes literais, nunca lidos de `formData` — o cliente não tem
 * como declarar seu próprio pedido "whatsapp"/"external" por nenhum
 * outro caminho.
 */
export async function createOrderForWhatsappAction(
  storeSlug: string,
  _prevState: CheckoutWhatsappActionState,
  formData: FormData,
): Promise<CheckoutWhatsappActionState> {
  const parsed = whatsappCheckoutSchema.safeParse({
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
    paymentPreference: formData.get("paymentPreference"),
    cashChangeFor: formData.get("cashChangeFor"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolution = await resolveStorefrontTenant(storeSlug);
  if (resolution.status !== "ready") {
    return { status: "error", message: "Esta loja não está disponível no momento." };
  }

  // Gate central — decidido só pelo checkout_mode real da loja, nunca
  // pelo caminho que o cliente escolheu na UI (que pode estar
  // desatualizada). Uma loja `vexo` nunca aceita pedido por este caminho.
  if (resolution.tenant.checkout_mode !== "whatsapp" && resolution.tenant.checkout_mode !== "both") {
    return { status: "error", message: "Esta loja não aceita pedidos pelo WhatsApp." };
  }

  const cartId = await getCartId(storeSlug);
  if (!cartId) {
    return { status: "error", message: "Seu carrinho está vazio. Volte para a loja e adicione produtos." };
  }

  const {
    zip,
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
    customerName,
    customerEmail,
    customerPhone,
    shippingMethodId,
    shippingPrice,
    paymentPreference,
  } = parsed.data;

  // "Se pagamento != cash: qualquer valor de troco enviado pelo navegador
  // deve ser ignorado" — nunca só validado/descartado por erro, IGNORADO
  // por completo: nem chega a ser lido para nada além deste `if`.
  const cashChangeFor = paymentPreference === "cash" ? (parsed.data.cashChangeFor ?? null) : null;

  // PIX só pode ser escolhido se a loja realmente configurou uma chave —
  // nunca deixa o cliente escolher uma opção que não leva a lugar nenhum
  // (prompt §32: "não deixar o cliente perdido").
  if (paymentPreference === "pix") {
    const pixSettings = await getStorePixSettings(resolution.tenant.id);
    if (!pixSettings) {
      return { status: "error", message: "Esta loja ainda não configurou uma chave PIX. Escolha outra forma de pagamento." };
    }
  }

  // Mesma regra de segurança de createOrderAction (Etapa 12): frete
  // obrigatório continua obrigatório também no caminho WhatsApp — o canal
  // de pagamento muda, a exigência de entrega não.
  if (shippingMethodId === undefined || shippingPrice === undefined) {
    if (await isShippingRequired(resolution.tenant.id)) {
      return { status: "error", message: "Selecione uma opção de entrega antes de finalizar o pedido." };
    }
  } else {
    const fresh = await verifyShippingPriceFresh(resolution.tenant.id, shippingMethodId, shippingPrice);
    if (!fresh) {
      return {
        status: "error",
        message: "O valor do frete mudou. Atualize a página e selecione a opção de entrega novamente.",
      };
    }
  }

  // Segurança do troco (prompt §11): o total usado na validação é sempre
  // o total REAL calculado pelo servidor — `cart.subtotal` vem de
  // features/cart/data.ts (join ao vivo com products, nunca um valor do
  // navegador) e `shippingPrice` já foi revalidado fresco acima contra
  // `shipping_methods.price`. Rejeitado ANTES de criar o pedido — nunca
  // um pedido "órfão" com troco insuficiente.
  if (cashChangeFor !== null) {
    const cart = await getCart(storeSlug);
    const expectedTotal = cart.subtotal + (shippingPrice ?? 0);
    if (cashChangeFor < expectedTotal) {
      return { status: "error", fieldErrors: { cashChangeFor: "O valor informado é menor que o total do pedido." }, message: "Verifique os campos destacados." };
    }
  }

  const supabase = createSupabasePublicClient();
  const { data: orderId, error } = await supabase.rpc("create_order_from_cart", {
    p_tenant_id: resolution.tenant.id,
    p_cart_id: cartId,
    p_customer_name: customerName,
    p_customer_email: customerEmail,
    p_customer_phone: customerPhone,
    p_shipping_address: { zip, street, number, complement: complement ?? null, neighborhood, city, state },
    p_order_source: "whatsapp",
    p_payment_channel: "external",
    p_requested_payment_method: paymentPreference,
    p_cash_change_for: cashChangeFor,
  });

  if (error || !orderId) {
    return { status: "error", message: friendlyCheckoutError(error?.message ?? "") };
  }

  revalidatePath(`/loja/${storeSlug}`);
  revalidatePath(`/loja/${storeSlug}/carrinho`);

  if (shippingMethodId !== undefined && shippingPrice !== undefined) {
    await applyShippingToOrder(resolution.tenant.id, orderId as string, shippingMethodId, shippingPrice);
  }

  // Nunca cria payment/gateway aqui: create_payment_for_order/
  // initiatePaymentForOrder simplesmente não são chamadas — o pedido já
  // nasce completo com payment_channel='external'/payment_status='EXTERNAL'
  // (decidido dentro da própria RPC). O link do WhatsApp é montado na
  // página de confirmação (features/checkout/whatsapp-link.ts), nunca
  // aqui, para nunca passar telefone/mensagem/total por querystring.
  redirect(`/loja/${storeSlug}/pedido/${orderId as string}`);
}
