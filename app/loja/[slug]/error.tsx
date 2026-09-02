"use client";

import { useParams } from "next/navigation";

/**
 * D14.1 — error boundary compartilhado por toda a loja pública
 * (`app/loja/[slug]/**`: home, produto, carrinho, checkout, confirmação
 * de pedido) — um único arquivo, nunca um por template (auditoria D14.0:
 * nenhum existia antes, apesar de toda rota aqui ser `force-dynamic` com
 * leitura ao vivo do Supabase). Nunca expõe `error.message`/`error.digest`
 * nem qualquer detalhe interno (stack, SQL, UUID) ao cliente — só um
 * "tentar novamente" (reset do boundary) e um link de volta para a loja,
 * a única rota que faz sentido sempre existir aqui.
 *
 * Isto NÃO é uma máscara para bugs conhecidos (prompt §14): não há
 * try/catch escondendo nada, não muda nenhuma lógica de negócio — é
 * só a fronteira de recuperação que o App Router já prevê para erros
 * verdadeiramente inesperados (ex.: uma falha transitória do Supabase a
 * meio de uma compra), que hoje caem na tela crua padrão do Next.js.
 */
export default function StorefrontError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // `useParams` sempre reflete o segmento `[slug]` da rota que caiu neste
  // boundary — nunca lido do `error` em si (que nunca carrega dado de
  // negócio). Se por algum motivo vier vazio, cai para a home da VEXO —
  // nunca um link quebrado para `/loja/undefined`.
  const params = useParams<{ slug: string }>();
  const backHref = params?.slug ? `/loja/${params.slug}` : "/";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-margin-mobile text-center md:p-margin-desktop">
      <span className="material-symbols-outlined text-4xl text-error">error</span>
      <div className="flex max-w-[440px] flex-col gap-2">
        <h1 className="font-headline text-headline-sm text-on-surface">Ops! Tivemos um problema.</h1>
        <p className="font-body text-body-md text-on-surface-variant">Não conseguimos carregar esta página agora.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
          onClick={reset}
          type="button"
        >
          Tentar novamente
        </button>
        <a
          className="rounded-lg border border-outline-variant/50 px-5 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
          href={backHref}
        >
          Voltar para a loja
        </a>
      </div>
    </div>
  );
}
