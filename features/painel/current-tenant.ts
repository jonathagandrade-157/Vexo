import "server-only";

import { cache } from "react";

import { resolveActiveTenantForUser, type ActiveTenantMembership } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `app/painel/layout.tsx` (gate) e cada `page.tsx` sob `/painel` precisam
 * da mesma membership — `cache()` do React dedupe a consulta dentro do
 * mesmo request em vez de repeti-la em cada Server Component (arquitetura
 * §19 Etapa 5: "evitar fetch duplicado"). `resolveActiveTenantForUser`
 * em si continua sem estado nenhum — só esta casca de conveniência é
 * memoizada por request.
 */
export const getCurrentMembership = cache(
  async (): Promise<ActiveTenantMembership | null> => {
    const supabase = await createSupabaseServerClient();
    return resolveActiveTenantForUser(supabase);
  },
);
