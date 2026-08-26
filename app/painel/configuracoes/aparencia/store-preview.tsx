"use client";

import { useState } from "react";

import { STOREFRONT_TEMPLATE_LABELS, type StorefrontTemplate } from "@/features/settings/appearance-schema";

const NAV_ITEMS = ["Início", "Categorias", "Produtos", "Promoções", "Sobre"];

/**
 * Sprint 1 — Fase A. Representação visual DENTRO DO PAINEL, para o
 * lojista entender como a identidade vai ficar — nunca a loja pública de
 * verdade (`app/loja/[slug]`, que não é tocada nesta fase). Reage
 * imediatamente a logo/nome/cores/modelo porque só lê o estado local do
 * formulário pai, sem round-trip ao servidor.
 */
export function StorePreview({
  storeName,
  logoUrl,
  primaryColor,
  secondaryColor,
  template,
}: {
  storeName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  template: StorefrontTemplate;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-headline-sm text-on-surface">Pré-visualização</h2>
        <div className="flex overflow-hidden rounded-lg border border-surface-container-highest">
          <button
            className={
              device === "desktop"
                ? "flex items-center gap-1.5 bg-primary-container px-3 py-1.5 font-label text-label-sm text-on-primary-container"
                : "flex items-center gap-1.5 px-3 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
            }
            onClick={() => setDevice("desktop")}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">desktop_windows</span>
            Desktop
          </button>
          <button
            className={
              device === "mobile"
                ? "flex items-center gap-1.5 bg-primary-container px-3 py-1.5 font-label text-label-sm text-on-primary-container"
                : "flex items-center gap-1.5 px-3 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
            }
            onClick={() => setDevice("mobile")}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">smartphone</span>
            Mobile
          </button>
        </div>
      </div>

      <div className={device === "mobile" ? "mx-auto w-full max-w-[280px]" : "w-full"}>
        <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-white text-[#111]">
          {/* Header mockado */}
          <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
            <div className="flex items-center gap-2">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- preview isolado dentro do painel, nunca a Image real da storefront
                <img alt="" className="h-7 w-7 rounded-full object-cover" src={logoUrl} />
              ) : (
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  {storeName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="text-sm font-bold">{storeName || "Sua loja"}</span>
            </div>
            {device === "desktop" ? (
              <nav className="flex gap-3 text-[11px] text-black/60">
                {NAV_ITEMS.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </nav>
            ) : (
              <span className="material-symbols-outlined text-[18px] text-black/60">menu</span>
            )}
          </div>

          {/* Hero mockado */}
          <div className="px-4 py-6 text-center" style={{ backgroundColor: `${primaryColor}1a` }}>
            <span
              className="mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white"
              style={{ backgroundColor: secondaryColor }}
            >
              {STOREFRONT_TEMPLATE_LABELS[template]}
            </span>
            <p className="text-lg font-bold">{storeName || "Sua loja"}</p>
            <p className="mt-1 text-[11px] text-black/60">Produtos selecionados especialmente para você</p>
          </div>

          {/* Produtos representativos */}
          <div className="grid grid-cols-2 gap-2 p-4">
            {[1, 2, 3, 4].map((n) => (
              <div className="flex flex-col gap-1" key={n}>
                <div className="aspect-square rounded-lg bg-black/5" />
                <div className="h-2 w-3/4 rounded bg-black/10" />
                <div className="h-2 w-1/2 rounded" style={{ backgroundColor: primaryColor }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        Representação simplificada — não é a loja pública completa.
      </p>
    </div>
  );
}
