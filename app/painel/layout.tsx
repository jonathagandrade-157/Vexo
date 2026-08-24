import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Header } from "@/components/painel/header";
import { MobileBottomNav } from "@/components/painel/mobile-bottom-nav";
import { Sidebar } from "@/components/painel/sidebar";
import { getTenantCommercialContext } from "@/features/commercial/tenant-plan";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Gate server-side único para TODAS as rotas `/painel/*` (arquitetura §6
 * Etapa 5) — cada `page.tsx` sob este layout confia que, ao renderizar,
 * já existe uma membership ativa com onboarding concluído. Nunca confia
 * em tenant_id/role vindo do client: tudo vem de `getCurrentMembership()`
 * (sessão + tenant_members, mesma base que a RLS usa).
 *
 * Os 5 estados pedidos:
 *   1. sem sessão                          → /login
 *   2. sem tenant nenhum (sem membership)  → /sem-loja
 *   3. tenant com onboarding pendente,
 *      usuário é o OWNER                   → /onboarding
 *   4. tenant com onboarding pendente,
 *      usuário NÃO é o OWNER               → estado informativo inerte
 *      (não redireciona para /onboarding — quem não é OWNER não consegue
 *      completá-lo lá, isso criaria um beco sem saída, não um loop, mas
 *      ainda uma navegação inútil)
 *   5. tenant com onboarding concluído     → shell completo do painel
 */
export default async function PainelLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");

  if (membership.tenant.onboarding_completed_at === null) {
    if (membership.roleKey === "OWNER") redirect("/onboarding");

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-margin-mobile text-center md:p-margin-desktop">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant">hourglass_top</span>
        <div className="flex max-w-[440px] flex-col gap-2">
          <h1 className="font-headline text-headline-sm text-on-surface">
            Sua loja ainda está sendo configurada
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            O proprietário da loja {membership.tenant.name} ainda não concluiu a configuração
            inicial. Assim que isso acontecer, você poderá acessar o painel.
          </p>
        </div>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const userName = (profile?.full_name as string | undefined) ?? user.email ?? "Usuário";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "?";

  // Etapa 16 §4/§12 — uma única leitura do plano comercial por request,
  // reaproveitada pelo Sidebar (cadeados por feature) e por qualquer
  // page.tsx sob este layout que precise da mesma informação (cache()
  // por request, mesmo padrão de getCurrentMembership).
  const commercialContext = await getTenantCommercialContext(membership.tenant.id);

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar tenantName={membership.tenant.name} unlockedFeatures={Array.from(commercialContext.features)} />
      <Header userInitial={userInitial} userName={userName} />
      <main className="px-margin-mobile pb-24 pt-24 md:ml-[260px] md:px-margin-desktop md:pb-12">
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
