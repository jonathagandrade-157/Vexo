import "server-only";

import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";

import { getOrderConfirmation } from "@/features/checkout/order-confirmation";
import { getEmailEnv, getPublicEnv } from "@/lib/env";
import { buildOrderConfirmationEmail } from "./templates/order-confirmation";

export interface SendOrderConfirmationEmailInput {
  tenantId: string;
  orderId: string;
  customerEmail: string;
  storeName: string;
  storeSlug: string;
}

/**
 * JON-13 — chamada de dentro de `after()` (next/server) nos dois Server
 * Actions de checkout (createOrderAction/createOrderForWhatsappAction),
 * sempre depois do pedido (e frete) já estarem persistidos — a resposta
 * ao cliente já foi enviada quando isto roda, então nada aqui pode
 * afetá-la; toda falha é tratada dentro desta função, nunca relançada.
 *
 * `getOrderConfirmation` é a MESMA função que já monta os dados da
 * página `/pedido/[orderId]` — nenhuma query nova, nenhum campo novo.
 */
export async function sendOrderConfirmationEmail(input: SendOrderConfirmationEmailInput): Promise<void> {
  let env: ReturnType<typeof getEmailEnv>;
  try {
    env = getEmailEnv();
  } catch (cause) {
    // RESEND_API_KEY ausente: estado esperado em dev/sandbox (ainda sem
    // domínio verificado no Resend) — nunca um erro de código, nunca
    // reportado em dev. Em produção, porém, isso não pode falhar em
    // silêncio pra sempre sem ninguém notar — captureMessage (nunca
    // exception: não é uma falha inesperada, é uma configuração
    // ausente) avisa uma vez por tentativa de envio.
    if (process.env.NODE_ENV === "production") {
      Sentry.captureMessage(
        "JON-13: e-mail de confirmação de pedido desabilitado — RESEND_API_KEY não configurada em produção.",
        { level: "warning", extra: { tenantId: input.tenantId, orderId: input.orderId, cause: cause instanceof Error ? cause.message : String(cause) } },
      );
    }
    return;
  }

  const order = await getOrderConfirmation(input.tenantId, input.orderId);
  if (!order) {
    // Não deveria acontecer: o pedido acabou de ser criado com sucesso
    // pela mesma requisição que agendou este after() — um null aqui é
    // sinal de inconsistência real (nunca um estado esperado, diferente
    // do RESEND_API_KEY ausente acima), então "error" (não "warning").
    Sentry.captureMessage(
      "JON-13: e-mail de confirmação de pedido não enviado — pedido não encontrado logo após ser criado.",
      { level: "error", extra: { tenantId: input.tenantId, orderId: input.orderId } },
    );
    return;
  }

  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const orderUrl = `${NEXT_PUBLIC_SITE_URL}/loja/${input.storeSlug}/pedido/${input.orderId}`;
  const { subject, html } = buildOrderConfirmationEmail(order, { storeName: input.storeName, orderUrl });

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to: input.customerEmail, subject, html });
    if (error) {
      Sentry.captureException(
        new Error(`Resend: falha ao enviar e-mail de confirmação de pedido (${error.name}): ${error.message}`),
        { extra: { tenantId: input.tenantId, orderId: input.orderId } },
      );
    }
  } catch (cause) {
    Sentry.captureException(cause, { extra: { tenantId: input.tenantId, orderId: input.orderId } });
  }
}
