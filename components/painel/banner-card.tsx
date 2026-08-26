"use client";

import Image from "next/image";
import { useTransition } from "react";

import { BannerFormDialog } from "@/components/painel/banner-form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { deleteBannerAction, moveBannerAction, toggleBannerStatusAction } from "@/features/settings/banner-actions";
import type { StaffBanner } from "@/features/settings/banner-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";

/** Sprint 1 — Fase C2. Card (não tabela crua — auditoria §14) reaproveitando `ConfirmDialog`/`BannerFormDialog`, mesmo espírito de `ShippingMethodRow`. */
export function BannerCard({
  banner,
  canEdit,
  isFirst,
  isLast,
}: {
  banner: StaffBanner;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const active = banner.status === "active";

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest">
      <div className="relative aspect-[16/7] w-full bg-surface-container-high">
        <Image alt={banner.title ?? ""} className="object-cover" fill sizes="360px" src={getTenantMediaPublicUrl(banner.image_path)} />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <span className="font-body text-body-md font-medium text-on-surface">{banner.title || "Sem título"}</span>
        <span
          className={
            active
              ? "w-fit rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "w-fit rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {active ? "Ativo" : "Inativo"}
        </span>

        {canEdit ? (
          <div className="mt-2 flex items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              <button
                aria-label="Mover para cima"
                className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isFirst || isPending}
                onClick={() =>
                  startTransition(async () => {
                    await moveBannerAction(banner.id, "up");
                  })
                }
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_upward</span>
              </button>
              <button
                aria-label="Mover para baixo"
                className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isLast || isPending}
                onClick={() =>
                  startTransition(async () => {
                    await moveBannerAction(banner.id, "down");
                  })
                }
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_downward</span>
              </button>
              <button
                aria-label={active ? "Desativar" : "Ativar"}
                className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await toggleBannerStatusAction(banner.id, active ? "inactive" : "active");
                  })
                }
                title={active ? "Desativar" : "Ativar"}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
              </button>
            </div>
            <div className="flex items-center gap-1">
              <BannerFormDialog
                banner={banner}
                trigger={
                  <span
                    className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
                    title="Editar"
                  >
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </span>
                }
              />
              <ConfirmDialog
                confirmLabel="Excluir"
                description={`Tem certeza que deseja excluir o banner "${banner.title || "sem título"}"? Essa ação não pode ser desfeita.`}
                onConfirm={() => deleteBannerAction(banner.id)}
                title="Excluir banner"
                trigger={
                  <span
                    className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error"
                    title="Excluir"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </span>
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
