import Link from "next/link";

import { PanelEmptyState } from "@/components/painel/panel-empty-state";

/** Cobre `notFound()` chamado por qualquer página sob /painel (ex.: editar produto com id de outro tenant) — mantém o shell do painel (layout.tsx já envolve isto). */
export default function PainelNotFound() {
  return (
    <PanelEmptyState
      action={
        <Link
          className="rounded-lg border border-outline-variant px-4 py-2 font-label text-label-md text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
          href="/painel/produtos"
        >
          Voltar para produtos
        </Link>
      }
      description="O item que você tentou acessar não existe ou não pertence à sua loja."
      icon="search_off"
      title="Não encontrado"
    />
  );
}
