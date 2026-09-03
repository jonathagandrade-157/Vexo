import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentStepKeyOf, resolveOnboardingState } from "@/features/onboarding/progress";
import { resolveOnboardingTenant } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Configurar minha loja — VEXO",
};

/**
 * D12.2 — `/onboarding` deixou de renderizar a primeira etapa do wizard
 * diretamente (isso agora é `/onboarding/{step}`, ver
 * `app/onboarding/[step]/page.tsx`): esta página virou um puro
 * resolvedor/redirecionador, sempre a partir do banco (BANCO é a fonte
 * de verdade — D12.2, "RETOMADA": nunca localStorage, nunca estado
 * React), nunca de uma etapa fixa.
 *
 * Gate 100% server-side (mesmo de D12.0/arquitetura §24 Etapa 4 / §6
 * Etapa 5): decide com base em `tenants.onboarding_completed_at`
 * (indiretamente, via `resolveOnboardingTenant`) e no progresso real de
 * `onboarding_progress`. Sem sessão → /login. Sem tenant OWNER pendente
 * → /painel (se já existe tenant concluído) ou /sem-loja (nenhum tenant
 * nenhum) — mesmo "loop de redirect" já resolvido em D12.0/Etapa 4.
 *
 * Tenant sem `business_type` ainda (nunca chegou à etapa "segmento", OU é
 * um tenant cujo onboarding já estava concluído antes desta etapa — mas
 * esses nunca chegam aqui, `resolveOnboardingTenant(true)` só retorna
 * tenant PENDENTE) → sempre `/onboarding/segmento` (D15.1.1 — nova
 * primeira etapa, a única que não depende de uma definição de steps já
 * resolvida, pois é ela quem define `business_type`).
 */
export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    // Mesmo raciocínio de D12.0/Etapa 4: só manda para /painel se de fato
    // existir um tenant já concluído — do contrário /painel faria o
    // redirect simétrico de volta para cá e as duas páginas ficariam em
    // loop infinito.
    const completedTenant = await resolveOnboardingTenant(supabase, false);
    redirect(completedTenant ? "/painel" : "/sem-loja");
  }

  if (!tenant.business_type) {
    redirect("/onboarding/segmento");
  }

  const state = await resolveOnboardingState(supabase, tenant.id);
  const stepKey = currentStepKeyOf(state);

  // Definição vazia (business_type sem wizard implementado ainda, ex.
  // 'restaurant'/'adega' nesta fase — D12.2 não os implementa) — sem
  // etapa para resolver, volta para "segmento" para o lojista poder
  // reconsiderar o tipo de negócio escolhido.
  redirect(`/onboarding/${stepKey ?? "segmento"}`);
}
