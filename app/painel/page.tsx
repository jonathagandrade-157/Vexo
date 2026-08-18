import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { resolveOnboardingTenant } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Painel — VEXO",
};

/**
 * Placeholder mínimo (arquitetura §24 Etapa 4 — "criar apenas o
 * componente mínimo necessário" quando não há tela correspondente no
 * Stitch). O painel administrativo real (produtos, pedidos, clientes,
 * relatórios...) é de etapas futuras — esta página só existe para provar,
 * de ponta a ponta, o gate de conclusão do onboarding:
 *
 *   - decide com base em tenants.onboarding_completed_at (servidor),
 *     nunca em estado de cliente;
 *   - onboarding pendente → redireciona para /onboarding, mesmo que o
 *     usuário digite /painel diretamente na barra de endereço.
 */
export default async function PainelPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const pendingTenant = await resolveOnboardingTenant(supabase, true);
  if (pendingTenant) redirect("/onboarding");

  const tenant = await resolveOnboardingTenant(supabase, false);
  if (!tenant) redirect("/onboarding");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-margin-mobile text-center md:p-margin-desktop">
      <BrandMark icon="auto_awesome" />
      <div className="flex max-w-[480px] flex-col gap-3">
        <h1 className="font-headline text-headline-md text-on-surface">
          Bem-vindo(a) ao painel, {tenant.name}
        </h1>
        <p className="font-body text-body-md text-on-surface-variant">
          O onboarding foi concluído. O painel administrativo completo (produtos, pedidos,
          clientes, relatórios e demais recursos) é construído em etapas futuras.
        </p>
      </div>
    </div>
  );
}
