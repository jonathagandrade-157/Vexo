import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Lojas — VEXO Master" };

export default function MasterLojasPage() {
  return (
    <ComingSoon
      description="A gestão de lojas (suspender, reativar, visualizar) chega em uma etapa futura do produto."
      icon="storefront"
      title="Lojas"
    />
  );
}
