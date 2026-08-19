import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CurrentPlatformAdmin {
  userId: string;
  role: "MASTER" | "SUPPORT_AGENT";
}

/**
 * Único ponto de resolução de acesso MASTER (prompt Etapa 14 §15) —
 * reaproveita `platform_admins`/RLS existentes desde a Etapa 2, nunca um
 * segundo sistema de administrador. A RLS de `platform_admins` (migration
 * 0014) só deixa um usuário ver linhas dessa tabela quando ele MESMO já é
 * platform admin (`is_platform_admin()`) — então "nenhuma linha
 * encontrada" aqui já é, por construção, "não é platform admin", nunca
 * precisa de uma checagem adicional.
 *
 * `cache()` do React — mesmo padrão de `getCurrentMembership`
 * (features/painel/current-tenant.ts, Etapa 5): dedupe entre o gate do
 * layout e cada `page.tsx` sob `/master`.
 */
export const getCurrentPlatformAdmin = cache(async (): Promise<CurrentPlatformAdmin | null> => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (!data) return null;

  return { userId: user.id, role: data.role as "MASTER" | "SUPPORT_AGENT" };
});
