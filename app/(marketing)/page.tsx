import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { PricingSection } from "@/components/marketing/pricing-section";
import { ProductPreview } from "@/components/marketing/product-preview";
import { listPublicPlans } from "@/features/commercial/public-plans";

export const metadata: Metadata = {
  title: "VEXO — Crie e gerencie sua loja online",
  description:
    "Crie sua loja online, organize o catálogo, receba pedidos e acompanhe sua operação em um único painel.",
};

// Planos podem mudar a qualquer momento no Painel MASTER — mesma
// justificativa de `app/loja/[slug]/page.tsx` para `force-dynamic`: a
// seção de preços consulta o banco a cada request, nunca fica presa a um
// snapshot gerado em build time.
export const dynamic = "force-dynamic";

const VALUE_CARDS = [
  { icon: "storefront", title: "Publique sua loja", description: "Escolha um modelo, ajuste sua identidade e compartilhe sua vitrine." },
  { icon: "shopping_cart", title: "Venda do seu jeito", description: "Ofereça checkout online, pedido pelo WhatsApp ou os dois caminhos." },
  { icon: "payments", title: "Receba pagamentos", description: "Conecte o Mercado Pago ou combine o pagamento diretamente pelo WhatsApp." },
  { icon: "local_shipping", title: "Acompanhe pedidos", description: "Organize o atendimento, o frete e cada mudança de status do pedido." },
  { icon: "inventory_2", title: "Controle o catálogo", description: "Gerencie produtos, categorias, estoque, imagens e variações." },
  { icon: "palette", title: "Mostre sua marca", description: "Personalize cores, logo, banners e o modelo visual da loja." },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Crie sua conta", description: "Cadastre-se rapidamente e acesse o painel da VEXO." },
  { step: "02", title: "Defina sua identidade", description: "Escolha o visual da loja e configure os dados da sua operação." },
  { step: "03", title: "Adicione o catálogo", description: "Cadastre produtos e conecte pagamento e entrega conforme sua necessidade." },
  { step: "04", title: "Publique e venda", description: "Compartilhe sua loja e acompanhe os pedidos pelo painel." },
];

const RESOURCES = [
  { icon: "store", title: "Loja online", description: "Vitrine publicada com catálogo, carrinho e checkout." },
  { icon: "inventory", title: "Produtos", description: "Fotos, preços, variações e estoque no mesmo cadastro." },
  { icon: "receipt_long", title: "Pedidos", description: "Lista de pedidos e atualização de status pelo painel." },
  { icon: "credit_card", title: "Mercado Pago", description: "Pagamento online conectado à conta da sua loja." },
  { icon: "local_shipping", title: "Frete", description: "Cálculo automático na hora do checkout." },
  { icon: "palette", title: "Personalização", description: "Ajuste a identidade visual da sua loja." },
  { icon: "inventory_2", title: "Estoque", description: "Controle por produto e por variação." },
  { icon: "groups", title: "Equipe", description: "Acessos com papéis e permissões definidos." },
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
              <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/50 bg-surface-container-low px-4 py-2 font-label text-label-md text-on-surface-variant">
                <span className="h-2 w-2 rounded-full bg-primary-container" />
                E-commerce para operar com clareza
              </div>
              <h1 className="font-display text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">
                Sua loja online,
                <br />
                <span className="text-primary">do seu jeito.</span>
              </h1>
              <p className="max-w-xl font-body text-body-lg text-on-surface-variant">
                Catálogo, pedidos, pagamento, entrega e aparência reunidos em um painel simples para a rotina da sua
                operação.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-8 py-4 font-label text-label-md text-on-primary-container shadow-lg shadow-primary-container/15 transition-[background-color,transform] duration-150 hover:bg-primary-container/90 active:scale-[0.97]"
                  href="/cadastro"
                >
                  Começar teste grátis
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </Link>
                <a
                  className="flex items-center justify-center rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-8 py-4 font-label text-label-md text-on-surface transition-[background-color,transform] duration-150 hover:bg-surface-container active:scale-[0.97]"
                  href="#recursos"
                >
                  Conhecer a VEXO
                </a>
                <span className="flex items-center font-body text-body-sm text-on-surface-variant">
                  Sem compromisso
                </span>
              </div>
            </div>

            <div className="relative lg:pl-6">
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* Value proposition */}
        <section className="bg-surface-container-lowest px-margin-mobile py-24 md:px-margin-desktop" id="recursos">
          <div className="mx-auto max-w-container-max">
            <div className="mb-16 space-y-4 text-center">
              <h2 className="font-display text-headline-md text-on-surface">O básico da operação fica conectado</h2>
              <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
                Catálogo, checkout e pedidos compartilham as mesmas informações no painel.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {VALUE_CARDS.map((card) => (
                <div
                  className="group rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-8 transition-colors duration-200 hover:border-primary/30"
                  key={card.title}
                >
                  <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container/10 text-primary">
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

        {/* Resources */}
        <section className="bg-surface-container-lowest px-margin-mobile py-24 md:px-margin-desktop">
          <div className="mx-auto max-w-container-max">
            <div className="mb-16 space-y-4 text-center">
              <h2 className="font-display text-headline-md text-on-surface">O que você controla pelo painel</h2>
              <p className="mx-auto max-w-2xl font-body text-body-md text-on-surface-variant">
                As áreas principais da loja ficam acessíveis sem trocar de ferramenta.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {RESOURCES.map((resource) => (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6" key={resource.title}>
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
            <h2 className="font-display text-headline-md text-on-surface">Sua operação, protegida em cada camada.</h2>
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
              className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-10 py-5 font-label text-label-md text-on-primary-container shadow-lg shadow-primary-container/15 transition-[background-color,transform] duration-150 hover:bg-primary-container/90 active:scale-[0.97]"
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
