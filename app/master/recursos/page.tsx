import type { Metadata } from "next";

import { FeatureFormDialog } from "@/components/master/feature-form-dialog";
import { FeatureRow } from "@/components/master/feature-row";
import { listFeatures } from "@/features/commercial/data";

export const metadata: Metadata = { title: "Recursos — VEXO Master" };

/** `/master/recursos` (prompt Etapa 14 §18) — catálogo de recursos, extensível sem migration (prompt §25: cadastrar um recurso é um INSERT). */
export default async function MasterRecursosPage() {
  const features = await listFeatures();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Recursos</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Catálogo de recursos da VEXO — associe-os aos planos em Planos → Recursos liberados.
          </p>
        </div>
        <FeatureFormDialog
          trigger={
            <span className="flex items-center justify-center gap-2 rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90">
              <span className="material-symbols-outlined text-[20px]">add</span>
              Novo recurso
            </span>
          }
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
        <div className="grid grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4">
          <div className="col-span-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Recurso</div>
          <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Categoria</div>
          <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Descrição</div>
          <div className="col-span-1 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</div>
          <div className="col-span-1 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ações</div>
        </div>
        <div className="divide-y divide-surface-container-highest/50">
          {features.map((feature) => (
            <FeatureRow feature={feature} key={feature.id} />
          ))}
        </div>
      </div>
    </div>
  );
}
