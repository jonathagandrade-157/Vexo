import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isWriteBlockedByBilling } from "./grace-status";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface BillingWriteAccessResult {
  allowed: boolean;
  message?: string;
}

const BILLING_BLOCKED_MESSAGE =
  "Sua loja está com um pagamento pendente há alguns dias. Regularize a assinatura para voltar a editar produtos e configurações.";

/**
 * JON-17 — checagem compartilhada de "esta escrita está bloqueada por
 * inadimplência" (dia 4+ de carência desde `subscriptions.past_due_since`
 * — ver `grace-status.ts`). Chamada de dentro de cada resolver de
 * tenant+permissão que já existia em cada domínio (categorias, produtos,
 * variantes, frete, conexões de frete/pagamento, aparência/banners/
 * checkout/pix/whatsapp/endereço/domínio, equipe, perfil da loja) — nunca
 * um middleware/gate novo, e sempre reaproveitando o MESMO `supabase` já
 * resolvido por quem chama, nunca criando outro client.
 *
 * Ausência de linha em `subscriptions` (ex.: tenant ainda só em
 * `trial_records`, D14/D16 — nunca teve uma assinatura de verdade) nunca
 * bloqueia — só bloqueia quando existe uma subscription REALMENTE
 * `past_due` há tempo suficiente. `tenant_access_status()` continua sendo
 * a fonte de ACTIVE/TRIALING/EXPIRED/SUSPENDED/CANCELLED (ex.:
 * `createProductAction`) — esta função nunca a substitui, só adiciona o
 * bloqueio granular de carência que aquela função não distingue (ela
 * trata `past_due` inteiro como `ACTIVE`, de propósito, D20.16).
 */
export async function checkBillingWriteAccess(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<BillingWriteAccessResult> {
  const { data } = await supabase.from("subscriptions").select("status, past_due_since").eq("tenant_id", tenantId).maybeSingle();
  if (!data) return { allowed: true };

  if (isWriteBlockedByBilling({ status: data.status as string | null, pastDueSince: data.past_due_since as string | null })) {
    return { allowed: false, message: BILLING_BLOCKED_MESSAGE };
  }
  return { allowed: true };
}
