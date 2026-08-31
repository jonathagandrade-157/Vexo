import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PlatformAdminRole = "MASTER" | "SUPPORT_AGENT";

export interface PlatformAdminRow {
  id: string;
  userId: string;
  role: PlatformAdminRole;
  createdAt: string;
  fullName: string | null;
  email: string | null;
}

/**
 * D11.3 — leitura de `platform_admins` (Etapa 2). Deliberadamente só
 * leitura: a própria migration de origem (20260817220014_rls_platform_admins.sql)
 * revoga INSERT/UPDATE/DELETE dessa tabela de `anon`, `authenticated` E
 * `service_role` — "gestão de platform_admins não deve ser alcançável nem
 * por código server-side da aplicação, só por conexão direta ao banco". Não
 * existe nenhuma Server Action de escrita para esta tabela nesta etapa,
 * por desenho, não por omissão (ver relatório final D11.3, seção D/K).
 *
 * `platform_admins.user_id` referencia `auth.users(id)`, não `profiles(id)`
 * diretamente — sem FK entre as duas, o PostgREST não consegue embutir
 * `profiles` num único `.select()` (mesmo caso já resolvido em
 * `features/master/tenants-data.ts`: duas consultas, nunca uma terceira
 * tabela nova).
 */
export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("platform_admins")
    .select("id, user_id, role, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listPlatformAdmins] failed to load platform admins", { error: error.message });
    throw new Error("Não foi possível carregar os administradores.");
  }

  const rows = (data ?? []) as { id: string; user_id: string; role: string; created_at: string }[];
  const userIds = rows.map((r) => r.user_id);

  const { data: profileRows } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    role: r.role as PlatformAdminRole,
    createdAt: r.created_at,
    fullName: profileById.get(r.user_id)?.full_name ?? null,
    email: profileById.get(r.user_id)?.email ?? null,
  }));
}

/** Usado só para exibir "1 administrador MASTER" na UI — nunca para autorizar nada (a autoridade real, quando um dia existir uma RPC de escrita, é sempre uma contagem feita no próprio banco no momento da operação, não este valor já carregado na página). */
export function countMasters(admins: Pick<PlatformAdminRow, "role">[]): number {
  return admins.filter((a) => a.role === "MASTER").length;
}
