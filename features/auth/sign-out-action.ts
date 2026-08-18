"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Etapa 5 — logout real do painel (arquitetura §7/§8: item de navegação
 * real, não um botão sem ação). `supabase.auth.signOut()` invalida a
 * sessão no servidor (não é só limpar um cookie no cliente); o proxy.ts
 * (Etapa 3) já refresca/valida sessão em toda request, então a próxima
 * navegação após o logout já não encontra `auth.getUser()` nenhum.
 *
 * Em arquivo próprio, separado de `features/auth/actions.ts`: um módulo
 * `"use server"` só pode exportar funções async — `actions.ts` também
 * exporta `initialSignUpState`/`initialSignInState` (objetos de estado
 * inicial, não funções), o que é aceito quando o módulo só é importado por
 * Client Components, mas quebra o build assim que um Server Component
 * (como `components/painel/logout-button.tsx`) importa dele também.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
