"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * D14.1 — marcar uma notificação como lida. Mesmo checklist de toda
 * Action deste projeto: tenant sempre resolvido da sessão (nunca de um
 * parâmetro do cliente); o `.eq("tenant_id", ...)` abaixo é defesa em
 * profundidade explícita além da RLS (migration 20260817220097, que já
 * impede ler/alterar notificação de outro tenant e que só `read_at` pode
 * mudar). Idempotente por natureza — marcar como lida uma notificação já
 * lida simplesmente não muda nada.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("tenant_id", membership.tenant.id)
    .is("read_at", null);

  revalidatePath("/painel", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", membership.tenant.id)
    .is("read_at", null);

  revalidatePath("/painel", "layout");
}
