import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NotificationRow } from "./schema";

const RECENT_LIMIT = 10;

/**
 * D14.1 — leitura das notificações do painel. Sessão do usuário
 * (`createSupabaseServerClient`), RLS já restringe a `tenant_id` +
 * `orders.view` (migration 20260817220097) — o `.eq("tenant_id", ...)`
 * abaixo é defesa em profundidade explícita, mesmo padrão já usado em
 * toda leitura tenant-scoped deste projeto (nunca confiar só na RLS
 * implicitamente).
 */
export async function listRecentNotifications(tenantId: string): Promise<NotificationRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, resource_type, resource_id, read_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT)
    .returns<NotificationRow[]>();

  if (error) {
    console.error("[listRecentNotifications] failed", { tenantId, error: error.message });
    return [];
  }
  return data ?? [];
}

export async function getUnreadNotificationCount(tenantId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("read_at", null);

  if (error) {
    console.error("[getUnreadNotificationCount] failed", { tenantId, error: error.message });
    return 0;
  }
  return count ?? 0;
}
