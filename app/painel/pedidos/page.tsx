import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Pedidos — VEXO" };

export default function PedidosPage() {
  return (
    <ComingSoon
      description="A gestão de pedidos e checkout chega em uma etapa futura do produto."
      icon="shopping_cart"
      title="Pedidos"
    />
  );
}
