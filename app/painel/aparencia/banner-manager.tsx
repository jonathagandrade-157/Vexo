"use client";

import { BannerCard } from "@/components/painel/banner-card";
import { BannerFormDialog } from "@/components/painel/banner-form-dialog";
import { MAX_BANNERS_PER_TENANT } from "@/features/settings/banner-storage";
import type { StaffBanner } from "@/features/settings/banner-schema";

/**
 * Sprint 1 — Fase C2. Lista em grid de cards (auditoria §14: "não fazer
 * tabela administrativa crua") + gatilho de criação — a lista em si é só
 * leitura de `banners` (prop vinda do Server Component da página); toda
 * mutação passa por Server Action + `revalidatePath`, que já refaz o
 * fetch e passa a lista nova para cá via prop — sem estado local paralelo.
 */
export function BannerManager({ banners, canEdit }: { banners: StaffBanner[]; canEdit: boolean }) {
  const atLimit = banners.length >= MAX_BANNERS_PER_TENANT;

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          {atLimit ? (
            <p className="font-body text-body-sm text-on-surface-variant">
              Limite de {MAX_BANNERS_PER_TENANT} banners atingido — remova um para adicionar outro.
            </p>
          ) : (
            <BannerFormDialog
              trigger={
                <span className="flex w-fit items-center gap-2 rounded-lg bg-primary-container px-4 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]">
                  <span className="material-symbols-outlined text-[20px]">add</span>
                  Adicionar banner
                </span>
              }
            />
          )}
        </div>
      ) : null}

      {banners.length === 0 ? (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhum banner cadastrado ainda.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {banners.map((banner, index) => (
            <BannerCard
              banner={banner}
              canEdit={canEdit}
              isFirst={index === 0}
              isLast={index === banners.length - 1}
              key={banner.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
