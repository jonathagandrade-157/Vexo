import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Produtos — VEXO" };

export default function ProdutosPage() {
  return (
    <ComingSoon
      description="Você ainda não possui produtos cadastrados. O cadastro de produtos e categorias chega em uma etapa futura do produto."
      icon="inventory_2"
      title="Produtos"
    />
  );
}
