import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { resolveOnboardingTenant } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BrandInfoForm } from "./brand-info-form";

export const metadata: Metadata = {
  title: "Conte um pouco sobre sua marca — VEXO",
};

/**
 * Recria `onboarding_sobre_sua_marca` (Stitch) — "Etapa 1 de 8" é
 * literalmente correto aqui: esta etapa do produto cobre só o primeiro
 * dos 8 passos do onboarding completo que o Stitch desenha; os demais
 * (identidade visual, produtos, pagamento, frete, publicação...) ficam
 * para etapas futuras, fora do escopo desta.
 *
 * Sem tela de "boas-vindas" separada antes deste formulário: as telas
 * onboarding_boas_vindas/onboarding_escolha_de_plano_trial do Stitch só
 * repetem o "inicie seu teste grátis" que /trial/sucesso (Etapa 3) já
 * cobre — o botão "Configurar minha loja" de lá já leva direto para cá.
 *
 * Gate 100% server-side (arquitetura §24 Etapa 4 / §6 Etapa 5): decide
 * com base em tenants.onboarding_completed_at, nunca em localStorage/
 * estado de cliente. Sem sessão → /login. Sem tenant OWNER pendente →
 * /painel (que decide o resto) ou /sem-loja (nenhum tenant nenhum).
 */
export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    // Sem tenant pendente. Só manda para /painel se de fato existir um
    // tenant já concluído — do contrário /painel faria o redirect
    // simétrico de volta para cá (nenhum tenant, nem pendente nem
    // concluído) e as duas páginas ficariam em loop infinito. Cenário
    // real, não hipotético: Etapa 3 já documenta que uma conta Supabase
    // Auth pode ficar sem tenant se um passo do cadastro falhar depois do
    // signUp() — não é desta etapa consertar essa causa raiz, só não
    // travar quem cair nela. /sem-loja (Etapa 5) é o destino correto
    // agora — mais preciso que a home de marketing.
    const completedTenant = await resolveOnboardingTenant(supabase, false);
    redirect(completedTenant ? "/painel" : "/sem-loja");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="h-1 w-full border-b border-outline-variant/20 bg-surface-container-lowest">
        <div className="h-full bg-primary-container transition-all duration-500" style={{ width: "12.5%" }} />
      </div>

      <header className="flex items-center justify-between px-margin-mobile py-6 md:px-margin-desktop">
        <BrandMark icon="auto_awesome" />
        <span className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
          Etapa 1 de 8
        </span>
      </header>

      <main className="flex flex-grow items-center justify-center px-margin-mobile py-12 md:px-margin-desktop">
        <div className="flex w-full max-w-[600px] flex-col gap-10">
          <div className="flex flex-col gap-3 text-center md:text-left">
            <h1 className="font-headline text-headline-md text-on-surface md:text-display-lg">
              Conte um pouco sobre sua marca
            </h1>
            <p className="font-body text-body-lg text-on-surface-variant">
              Essas informações ajudam a Vexo a criar uma experiência personalizada para o seu
              e-commerce.
            </p>
          </div>

          <BrandInfoForm
            defaultValues={{
              storeName: tenant.name,
              segment: tenant.segment ?? "",
              description: tenant.description ?? "",
              instagram: tenant.instagram_handle ?? "",
              whatsapp: tenant.whatsapp_phone ?? "",
              email: tenant.contact_email ?? "",
            }}
          />
        </div>
      </main>
    </div>
  );
}
