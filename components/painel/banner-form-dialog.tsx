"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { createBannerAction, updateBannerAction } from "@/features/settings/banner-actions";
import { BANNER_STATUSES, initialBannerActionState, type StaffBanner } from "@/features/settings/banner-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";

const STATUS_OPTIONS = BANNER_STATUSES.map((value) => ({ value, label: value === "active" ? "Ativo" : "Inativo" }));

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Sprint 1 — Fase C2. Cria OU edita — mesma forma de `ShippingMethodFormDialog`
 * (Action escolhida pela presença de `banner`). Imagem é obrigatória só
 * ao criar (a Action valida); ao editar, deixar em branco mantém a atual.
 * Preview local instantâneo ao escolher arquivo (§15 da auditoria) — sem
 * envio automático como a logo: só ao clicar "Criar banner"/"Salvar
 * alterações" é que o upload de fato acontece.
 */
export function BannerFormDialog({ trigger, banner }: { trigger: React.ReactNode; banner?: StaffBanner }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = banner ? updateBannerAction : createBannerAction;
  const [state, formAction] = useActionState(action, initialBannerActionState);
  const [previewUrl, setPreviewUrl] = useState<string | null>(banner ? getTenantMediaPublicUrl(banner.image_path) : null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  useEffect(() => {
    if (!localPreview) return;
    return () => URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setPreviewUrl(objectUrl);
  }

  return (
    <>
      <button onClick={() => dialogRef.current?.showModal()} type="button">
        {trigger}
      </button>
      <dialog
        className="w-full max-w-[480px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <form action={formAction} className="flex flex-col gap-5 p-6" noValidate>
          <h2 className="font-headline text-headline-sm text-on-surface">{banner ? "Editar banner" : "Novo banner"}</h2>

          {banner ? <input name="bannerId" type="hidden" value={banner.id} /> : null}

          <div className="flex flex-col gap-2">
            <label className="font-label text-label-md uppercase text-on-surface-variant">
              Imagem{banner ? " (opcional — mantém a atual se não escolher outra)" : ""}
            </label>
            <div className="relative flex h-32 w-full items-center justify-center overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
              {previewUrl ? (
                <Image alt="" className="object-cover" fill sizes="480px" src={previewUrl} unoptimized={localPreview !== null} />
              ) : (
                <span className="material-symbols-outlined text-3xl text-outline">image</span>
              )}
            </div>
            <label className="w-fit cursor-pointer rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface">
              {previewUrl ? "Substituir imagem" : "Selecionar imagem"}
              <input accept="image/jpeg,image/png,image/webp" className="hidden" name="file" onChange={handleFileChange} type="file" />
            </label>
            <p className="font-body text-body-sm text-on-surface-variant">PNG, JPEG ou WebP — até 5MB.</p>
          </div>

          <TextField
            defaultValue={banner?.title ?? ""}
            error={state.fieldErrors?.title}
            icon="title"
            id="bannerTitle"
            label="Título (opcional)"
            name="title"
            required={false}
          />

          <TextField
            defaultValue={banner?.link_url ?? ""}
            error={state.fieldErrors?.linkUrl}
            icon="link"
            id="bannerLink"
            label="Link (opcional)"
            name="linkUrl"
            placeholder="#promocoes ou https://…"
            required={false}
          />

          <SelectField
            defaultValue={banner?.status ?? "active"}
            error={state.fieldErrors?.status}
            id="bannerStatus"
            label="Status"
            name="status"
            options={STATUS_OPTIONS}
            placeholder="Selecione um status"
          />

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
              {state.message}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-3">
            <button
              className="rounded-lg px-4 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancelar
            </button>
            <SaveButton label={banner ? "Salvar alterações" : "Criar banner"} pendingLabel="Salvando…" />
          </div>
        </form>
      </dialog>
    </>
  );
}
