import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { LogoutButton } from "@/components/painel/logout-button";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Nenhuma loja encontrada — VEXO",
};

/**
 * Fluxo seguro de recuperação (arquitetura §6 Etapa 5) para uma conta
 * autenticada sem nenhuma membership de tenant — cenário real já
 * documentado desde a Etapa 3 ("uma conta Supabase Auth pode ficar sem
 * tenant se um passo do cadastro falhar depois do signUp()"), não
 * hipotético. Substitui o fallback antigo da Etapa 4 (que caía
 * silenciosamente na home de marketing) por uma explicação clara e um
 * próximo passo seguro — sem tentar "consertar" a conta automaticamente
 * (isso seria inventar uma funcionalidade de suporte/religação de conta
 * que não existe).
 */
export default async function SemLojaPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentMembership();
  if (membership) redirect("/painel");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-margin-mobile text-center md:p-margin-desktop">
      <BrandMark icon="auto_awesome" />
      <div className="flex max-w-[480px] flex-col gap-3">
        <span className="material-symbols-outlined mx-auto text-4xl text-on-surface-variant">
          storefront
        </span>
        <h1 className="font-headline text-headline-md text-on-surface">
          Não encontramos uma loja associada à sua conta
        </h1>
        <p className="font-body text-body-md text-on-surface-variant">
          Isso pode acontecer se o cadastro foi interrompido antes de concluir a criação da sua
          loja. Você pode criar uma nova loja agora.
        </p>
      </div>
      <div className="flex w-full max-w-[320px] flex-col gap-3">
        <a
          className="rounded-lg bg-primary-container px-6 py-3 text-center font-label text-label-md font-bold text-on-primary-container transition-colors hover:bg-inverse-primary"
          href="/cadastro"
        >
          Criar minha loja
        </a>
        <LogoutButton variant="settings" />
      </div>
    </div>
  );
}
