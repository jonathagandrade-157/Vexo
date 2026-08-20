import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { PricingSection } from "@/components/marketing/pricing-section";
import { listPublicPlans } from "@/features/commercial/public-plans";

export const metadata: Metadata = {
  title: "VEXO — Crie sua loja online com IA",
  description:
    "Uma plataforma de e-commerce completa, impulsionada por IA, projetada para marcas que exigem excelência sem complexidade técnica.",
};

// Planos podem mudar a qualquer momento no Painel MASTER — mesma
// justificativa de `app/loja/[slug]/page.tsx` para `force-dynamic`: a
// seção de preços consulta o banco a cada request, nunca fica presa a um
// snapshot gerado em build time.
export const dynamic = "force-dynamic";

const VALUE_CARDS = [
  { icon: "storefront", title: "Crie sua loja", description: "Design de nível empresarial, adaptado à sua marca em minutos." },
  { icon: "shopping_cart", title: "Venda online", description: "Carrinho otimizado para conversão com checkout fluido e seguro em qualquer dispositivo." },
  { icon: "payments", title: "Receba pagamentos", description: "Integração nativa com os principais gateways. Receba via PIX, cartões e boletos." },
  { icon: "local_shipping", title: "Gerencie pedidos", description: "Fluxo de fulfillment com cálculo de frete e acompanhamento de status." },
  { icon: "inventory_2", title: "Controle produtos", description: "Gestão de catálogo com categorias, estoque e variações." },
  { icon: "monitoring", title: "Entenda suas vendas", description: "Indicadores reais da sua loja, direto no painel." },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Crie sua conta", description: "Cadastre-se rapidamente e acesse o painel da VEXO." },
  { step: "02", title: "Configure sua loja", description: "Conte sobre sua marca, seus produtos e o estilo desejado." },
  { step: "03", title: "A VEXO prepara tudo", description: "Loja, catálogo e formas de pagamento prontos para publicar." },
  { step: "04", title: "Comece a vender", description: "Sua loja está pronta para receber clientes e processar pedidos." },
];

const RESOURCES = [
  { icon: "store", title: "Loja online", description: "Plataforma robusta e escalável." },
  { icon: "inventory", title: "Produtos", description: "Gestão fácil de catálogos completos." },
  { icon: "receipt_long", title: "Pedidos", description: "Controle total do fluxo de vendas." },
  { icon: "credit_card", title: "Pagamentos", description: "Integração com os principais meios de pagamento." },
  { icon: "local_shipping", title: "Frete", description: "Cálculo automático na hora do checkout." },
  { icon: "palette", title: "Personalização", description: "Ajuste a identidade visual da sua loja." },
  { icon: "bar_chart", title: "Relatórios", description: "Métricas reais sobre a sua operação." },
  { icon: "auto_awesome", title: "Vexo AI", description: "Inteligência artificial para ajudar na sua loja." },
];

const FAQ_ITEMS = [
  {
    question: "Como funciona o período de teste?",
    answer: "Você cria sua conta e sua loja fica disponível por um período de teste gratuito, sem precisar cadastrar um cartão de crédito.",
  },
  {
    question: "Quais métodos de pagamento são aceitos?",
    answer: "A loja aceita os métodos configurados através da integração com Mercado Pago, incluindo PIX e cartão.",
  },
  {
    question: "Posso usar meu próprio domínio?",
    answer: "O suporte a domínio próprio está previsto na arquitetura da plataforma e chega em uma etapa futura do produto.",
  },
  {
    question: "É fácil personalizar minha loja depois?",
    answer: "Sim — o painel administrativo permite ajustar produtos, categorias, frete e os dados da loja a qualquer momento.",
  },
  {
    question: "Tem limite de produtos cadastrados?",
    answer: "Cada plano tem seus próprios limites, definidos pela VEXO e visíveis antes da assinatura.",
  },
];

/**
 * Landing page oficial (`vexo_landing_page_oficial_desktop`/`mobile`,
 * Stitch) — Etapa 15. Substitui o placeholder da Etapa 1 (arquitetura
 * §24 original: "recriar esta tela é escopo de uma etapa posterior").
 *
 * Reconstrução em React/Tailwind, não HTML estático copiado — mesma
 * hierarquia/seções/copy do export, mockups de imagem (dashboard/preview
 * de loja) trocados por blocos CSS abstratos em vez de hotlink para os
 * assets `lh3.googleusercontent.com` do Stitch (fora do nosso controle).
 * Única seção com dado real: Planos (`PricingSection`), usando a RLS
 * pública que a Etapa 14 já preparou para isto.
 */
export default async function MarketingHomePage() {
  const plans = await listPublicPlans();

  return (
    <div className="overflow-x-hidden bg-surface text-on-surface">
      <MarketingHeader />

      <main className="pt-24">
        {/* Hero */}
        <section className="relative flex min-h-[720px] items-center justify-center overflow-hidden px-margin-mobile py-20 md:px-margin-desktop">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,theme(colors.primary-container/15),transparent_70%)]" />
          <div className="z-10 mx-auto grid max-w-container-max grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-container/30 bg-primary-container/10 px-4 py-2 font-label text-label-md text-primary">
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                Sua loja criada com inteligência artificial
              </div>
              <h1 className="font-display text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">
                Crie sua loja online.
                <br />
                <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  A VEXO cuida do resto.
                </span>
              </h1>
              <p className="max-w-xl font-body text-body-lg text-on-surface-variant">
                Uma plataforma de e-commerce completa, projetada para marcas que exigem excelência sem complexidade
                técnica.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link
                  className="ai-glow flex items-center justify-center gap-2 rounded-xl bg-primary-container px-8 py-4 font-label text-label-md text-white transition-all hover:bg-primary-container/90"
                  href="/cadastro"
                >
                  Começar teste grátis
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </Link>
                <a
                  className="flex items-center justify-center rounded-xl border border-outline-variant/50 bg-surface-container px-8 py-4 font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
                  href="#recursos"
                >
                  Conhecer a VEXO
                </a>
                <span className="flex items-center font-body text-body-sm text-on-surface-variant">
                  Sem compromisso
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 z-0 rounded-full bg-primary-container/20 blur-[100px]" />
              <div className="ai-glow relative z-10 flex aspect-[4/3] flex-col gap-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-6 shadow-2xl">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-error/60" />
                  <span className="h-3 w-3 rounded-full bg-tertiary/60" />
                  <span className="h-3 w-3 rounded-full bg-primary/60" />
                </div>
                <div className="grid flex-1 grid-cols-3 gap-3">
                  <div className="col-span-2 rounded-lg bg-surface-container-high" />
                  <div className="rounded-lg bg-primary-container/30" />
                  <div className="rounded-lg bg-surface-container-high" />
                  <div className="rounded-lg bg-surface-container-high" />
                  <div className="rounded-lg bg-secondary/20" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value proposition */}
        <section className="bg-surface-container-lowest px-margin-mobile py-24 md:px-margin-desktop" id="recursos">
          <div className="mx-auto max-w-container-max">
            <div className="mb-16 space-y-4 text-center">
              <h2 className="font-display text-headline-md text-on-surface">Tudo que você precisa em um só lugar</h2>
              <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
                Da criação da loja à primeira venda, sem depender de várias ferramentas diferentes.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {VALUE_CARDS.map((card) => (
                <div
                  className="group rounded-xl border border-surface-container-highest bg-[#121212] p-8 transition-colors hover:border-primary/30"
                  key={card.title}
                >
                  <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container/10 text-primary transition-transform group-hover:scale-110">
                    <span className="material-symbols-outlined">{card.icon}</span>
                  </div>
                  <h3 className="mb-2 font-display text-lg text-on-surface">{card.title}</h3>
                  <p className="font-body text-body-sm text-on-surface-variant">{card.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-surface px-margin-mobile py-24 md:px-margin-desktop" id="como-funciona">
          <div className="mx-auto max-w-container-max">
            <div className="mb-16 space-y-4 text-center">
              <h2 className="font-display text-headline-md text-on-surface">Como a VEXO funciona</h2>
              <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
                Do zero à primeira venda em quatro passos simples.
              </p>
            </div>
            <div className="relative grid grid-cols-1 gap-8 md:grid-cols-4">
              <div className="absolute left-0 top-12 hidden h-px w-full bg-outline-variant/30 md:block" />
              {HOW_IT_WORKS.map((item) => (
                <div className="relative z-10 flex flex-col items-center space-y-4 text-center" key={item.step}>
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-surface bg-surface-container font-display text-headline-sm text-primary">
                    {item.step}
                  </div>
                  <h3 className="font-display text-lg text-on-surface">{item.title}</h3>
                  <p className="font-body text-body-sm text-on-surface-variant">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Vexo AI */}
        <section className="relative overflow-hidden px-margin-mobile py-24 md:px-margin-desktop">
          <div className="relative z-10 mx-auto max-w-container-max text-center">
            <h2 className="mb-16 font-display text-headline-md text-on-surface">Sua loja começa com uma ideia</h2>
            <div className="ai-glow relative mx-auto max-w-4xl rounded-xl border border-primary/40 bg-[#121212] p-8">
              <div className="pointer-events-none absolute inset-0 rounded-xl bg-primary/5" />
              <div className="relative z-10 flex flex-col items-center gap-8">
                <div className="flex w-full max-w-2xl items-center gap-3 rounded-lg border border-surface-container-highest bg-surface-container p-4">
                  <span className="material-symbols-outlined text-primary">edit_square</span>
                  <p className="flex-1 text-left font-label text-label-md text-on-surface-variant">
                    Quero uma loja de perfumes premium com design minimalista escuro e foco em fotografias de alta
                    qualidade.
                  </p>
                </div>
                <div className="ai-glow flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-gradient-to-b from-primary-container to-secondary-container">
                  <span className="material-symbols-outlined text-2xl text-white">auto_awesome</span>
                </div>
                <div className="grid w-full grid-cols-3 gap-3">
                  <div className="col-span-2 aspect-video rounded-lg border border-surface-container-highest bg-surface-container-high" />
                  <div className="aspect-video rounded-lg border border-surface-container-highest bg-primary-container/20" />
                </div>
                <Link
                  className="mt-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-container to-secondary-container px-8 py-3 font-label text-label-md text-white transition-opacity hover:opacity-90"
                  href="/cadastro"
                >
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  Conhecer a Vexo AI
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Resources */}
        <section className="bg-surface-container-lowest px-margin-mobile py-24 md:px-margin-desktop">
          <div className="mx-auto max-w-container-max">
            <div className="mb-16 space-y-4 text-center">
              <h2 className="font-display text-headline-md text-on-surface">Recursos poderosos</h2>
              <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
                Tudo que sua operação precisa, de um lado só.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {RESOURCES.map((resource) => (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-6" key={resource.title}>
                  <span className="material-symbols-outlined mb-4 text-3xl text-primary">{resource.icon}</span>
                  <h3 className="mb-2 font-display text-lg text-on-surface">{resource.title}</h3>
                  <p className="font-body text-body-sm text-on-surface-variant">{resource.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="bg-surface px-margin-mobile py-24 md:px-margin-desktop">
          <div className="mx-auto max-w-container-max space-y-8 text-center">
            <span className="material-symbols-outlined text-5xl text-primary">security</span>
            <h2 className="font-display text-headline-md text-on-surface">Seu negócio merece segurança.</h2>
            <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
              Cada loja é isolada por tenant, com autenticação e controle de acesso em cada camada da plataforma.
            </p>
          </div>
        </section>

        <PricingSection plans={plans} />

        {/* FAQ */}
        <section className="bg-surface px-margin-mobile py-24 md:px-margin-desktop">
          <div className="mx-auto max-w-3xl space-y-8">
            <h2 className="mb-12 text-center font-display text-headline-md text-on-surface">Perguntas frequentes</h2>
            <div className="space-y-4">
              {FAQ_ITEMS.map((item) => (
                <details
                  className="group rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6 open:bg-surface-container"
                  key={item.question}
                >
                  <summary className="flex cursor-pointer items-center justify-between font-display text-lg text-on-surface">
                    {item.question}
                    <span className="material-symbols-outlined transition-transform group-open:rotate-180">
                      expand_more
                    </span>
                  </summary>
                  <p className="mt-4 font-body text-body-sm text-on-surface-variant">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-surface px-margin-mobile py-32 md:px-margin-desktop">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,theme(colors.primary-container/20),transparent_70%)]" />
          <div className="relative z-10 mx-auto max-w-container-max space-y-8 text-center">
            <h2 className="font-display text-display-lg-mobile text-on-surface md:text-display-lg">
              Pronto para criar sua loja?
            </h2>
            <Link
              className="ai-glow inline-flex items-center gap-2 rounded-full bg-primary px-10 py-5 font-label text-label-md text-on-primary transition-all hover:bg-primary/90"
              href="/cadastro"
            >
              Começar teste grátis
              <span className="material-symbols-outlined">arrow_forward</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="w-full border-t border-outline-variant/20 bg-surface-container-lowest px-margin-mobile py-16 md:px-margin-desktop">
        <div className="mx-auto grid max-w-container-max grid-cols-2 gap-gutter md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2 mb-8 lg:col-span-2 lg:mb-0">
            <div className="mb-4">
              <BrandMark />
            </div>
            <p className="max-w-xs font-body text-body-sm text-on-surface-variant">
              Plataforma de criação e gerenciamento de lojas virtuais.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="mb-2 font-label text-label-md text-on-surface">Produto</h4>
            <a className="font-body text-body-sm text-on-surface-variant transition-colors hover:text-primary" href="#recursos">
              Recursos
            </a>
            <a className="font-body text-body-sm text-on-surface-variant transition-colors hover:text-primary" href="#planos">
              Planos
            </a>
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="mb-2 font-label text-label-md text-on-surface">Conta</h4>
            <Link className="font-body text-body-sm text-on-surface-variant transition-colors hover:text-primary" href="/login">
              Entrar
            </Link>
            <Link className="font-body text-body-sm text-on-surface-variant transition-colors hover:text-primary" href="/cadastro">
              Criar conta
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
