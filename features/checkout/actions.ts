"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getCartId } from "@/features/cart/cart-cookie";
import { initiatePaymentForOrder, isPaymentGatewayConnected } from "@/features/payments/checkout";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { checkoutSchema, type CheckoutActionState, type CheckoutInput } from "./schema";

function fieldErrorsFrom(parsed: ReturnType<typeof checkoutSchema.safeParse>): CheckoutActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: CheckoutActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof CheckoutInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/** Mensagens amigáveis para os erros conhecidos que a RPC pode levantar — nunca expõe o texto bruto do erro Postgres ao visitante. */
function friendlyCheckoutError(message: string): string {
  if (message.includes("cart not found") || message.includes("cart is empty")) {
    return "Seu carrinho está vazio ou não foi encontrado. Volte para a loja e adicione produtos novamente.";
  }
  if (message.includes("store is not available")) {
    return "Esta loja não está disponível no momento.";
  }
  const inactiveProduct = /^product (.+) is no longer available$/.exec(message);
  if (inactiveProduct) {
    return `O produto "${inactiveProduct[1]}" não está mais disponível. Volte ao carrinho para removê-lo e tente novamente.`;
  }
  return "Não foi possível finalizar o pedido. Tente novamente.";
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
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolution = await resolveStorefrontTenant(storeSlug);
  if (resolution.status !== "ready") {
    return { status: "error", message: "Esta loja não está disponível no momento." };
  }

  // Defesa em profundidade — a página de checkout já bloqueia o
  // formulário quando não há gateway conectado (prompt §19), mas o
  // estado da página pode estar desatualizado.
  if (!(await isPaymentGatewayConnected(resolution.tenant.id))) {
    return { status: "error", message: "Esta loja ainda não possui um meio de pagamento configurado." };
  }

  const cartId = await getCartId(storeSlug);
  if (!cartId) {
    return { status: "error", message: "Seu carrinho está vazio. Volte para a loja e adicione produtos." };
  }

  const { zip, street, number, complement, neighborhood, city, state, customerName, customerEmail, customerPhone } =
    parsed.data;

  const supabase = createSupabasePublicClient();
  const { data: orderId, error } = await supabase.rpc("create_order_from_cart", {
    p_tenant_id: resolution.tenant.id,
    p_cart_id: cartId,
    p_customer_name: customerName,
    p_customer_email: customerEmail,
    p_customer_phone: customerPhone,
    p_shipping_address: { zip, street, number, complement: complement ?? null, neighborhood, city, state },
  });

  if (error || !orderId) {
    return { status: "error", message: friendlyCheckoutError(error?.message ?? "") };
  }

  revalidatePath(`/loja/${storeSlug}`);
  revalidatePath(`/loja/${storeSlug}/carrinho`);

  // O pedido já existe e o carrinho já foi limpo (create_order_from_cart,
  // Etapa 10) — se o passo de pagamento falhar daqui pra frente, o
  // cliente ainda cai na confirmação (que mostra o status real,
  // "pendente") em vez de ficar numa tela de erro sem saber se o pedido
  // existe.
  const payment = await initiatePaymentForOrder(resolution.tenant.id, orderId as string, customerEmail, storeSlug);
  if ("checkoutUrl" in payment) {
    redirect(payment.checkoutUrl);
  }
  redirect(`/loja/${storeSlug}/pedido/${orderId as string}`);
}
