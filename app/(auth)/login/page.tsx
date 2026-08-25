import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { resolvePostLoginDestination } from "@/features/auth/post-login-destination";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — VEXO",
};

/** Um item da lista de benefícios do painel esquerdo — todos recursos reais do produto (Etapa 18 Commerce), nenhum inventado. */
const BENEFITS: { icon: string; label: string }[] = [
  { icon: "inventory_2", label: "Gestão de produtos e categorias" },
  { icon: "shopping_cart", label: "Pedidos e vendas em tempo real" },
  { icon: "payments", label: "Pagamentos integrados com Mercado Pago" },
  { icon: "local_shipping", label: "Frete configurável para a sua loja" },
];

function BenefitsList({ className = "" }: { className?: string }) {
  return (
    <ul className={`grid gap-4 ${className}`}>
      {BENEFITS.map((benefit) => (
        <li className="flex items-center gap-3" key={benefit.label}>
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-container/15 text-primary">
            <span className="material-symbols-outlined text-[18px]">{benefit.icon}</span>
          </span>
          <span className="font-body text-body-sm text-on-surface-variant">{benefit.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Etapa 19.1 — tela de login redesenhada como vitrine premium do produto
 * (layout dividido no desktop: painel de marca à esquerda, card de acesso
 * à direita), inspirada na referência visual fornecida, mas adaptada aos
 * tokens já existentes do design system VEXO (cores, tipografia,
 * componentes de formulário) em vez de introduzir um novo. Puramente
 * visual — nenhuma linha da lógica de autenticação/redirect abaixo foi
 * tocada (Etapa 19 continua intacta).
 *
 * Não é uma tela do Stitch (o export não tem mockup dedicado de login) —
 * mesma decisão de sempre para telas fora da referência: reaproveitar os
 * tokens existentes, nunca inventar uma linguagem visual nova.
 */
export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Etapa 19 — mesmo destino automático do login bem-sucedido (nunca "/"
  // hardcoded), para quem já está autenticado e revisita /login.
  if (user) redirect(await resolvePostLoginDestination());

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-surface lg:flex-row">
      {/* Painel de marca — só desktop (prompt: "não simplesmente comprimir o layout desktop no mobile"). */}
      <div className="relative hidden overflow-hidden border-r border-outline-variant/10 bg-surface-container-lowest p-margin-desktop lg:flex lg:w-1/2 lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-primary-container opacity-[0.08] blur-[140px]" />
          <div className="absolute -bottom-40 -right-20 h-[360px] w-[360px] rounded-full bg-primary-container opacity-[0.06] blur-[120px]" />
        </div>

        <BrandMark />

        <div className="relative z-10 max-w-[440px]">
          <h1 className="font-headline text-display-lg text-on-surface">
            Gestão inteligente para o seu negócio
          </h1>
          <p className="mt-5 font-body text-body-lg text-on-surface-variant">
            A VEXO ajuda você a administrar sua loja, produtos, pedidos e vendas em um só lugar — sem complicação.
          </p>

          <BenefitsList className="mt-10" />

          <div className="mt-10 rounded-xl border border-outline-variant/20 bg-surface-container-low/60 px-5 py-4">
            <p className="font-body text-body-sm italic text-on-surface-variant">
              &ldquo;Ferramentas de verdade para quem vive de vender online.&rdquo;
            </p>
          </div>
        </div>

        <p className="relative z-10 font-label text-label-sm text-on-surface-variant">
          VEXO — plataforma de criação e gerenciamento de lojas virtuais.
        </p>
      </div>

      {/* Card de acesso — layout único, ocupa a tela inteira no mobile e metade no desktop. */}
      <main className="relative z-10 flex w-full flex-1 flex-col items-center justify-center overflow-hidden px-margin-mobile py-10 md:px-margin-desktop lg:w-1/2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden opacity-30 mix-blend-screen lg:hidden"
        >
          <div className="h-[800px] w-[800px] -translate-y-1/4 transform rounded-full bg-primary-container opacity-20 blur-[150px]" />
        </div>

        <div className="relative z-10 mb-8 lg:hidden">
          <BrandMark />
        </div>

        <div className="relative z-10 w-full max-w-[440px]">
          <LoginForm />

          {/* Benefícios compactos — só mobile, abaixo do card (prompt: "benefícios abaixo ou em uma seção compacta"). */}
          <BenefitsList className="mt-10 grid-cols-2 gap-x-4 gap-y-4 lg:hidden" />
        </div>
      </main>
    </div>
  );
}
