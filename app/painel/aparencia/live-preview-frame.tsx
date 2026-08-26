"use client";

import { useEffect, useRef, useState } from "react";

import {
  APPEARANCE_PREVIEW_MESSAGE_TYPE,
  isAppearancePreviewReadyMessage,
  type AppearancePreviewMessage,
} from "@/features/storefront/preview-message";

const PREVIEW_URL = "/painel-preview/aparencia";

/**
 * Sprint 1 — Fase B3 §9/§12. Host do `<iframe>` que mostra a loja de
 * verdade (mesmos componentes de `components/storefront/`) reagindo às
 * edições locais do editor — nunca salva nada, só reflete. Um `<iframe>`
 * (não uma `<div>` encolhida) é a única forma correta de ter Desktop/
 * Mobile de verdade aqui: cada um tem seu próprio viewport, então
 * `hidden md:flex`/`grid-cols-2 md:grid-cols-4` (Tailwind, baseado na
 * largura real do viewport) respondem de verdade, e o `<header
 * className="fixed">` da storefront volta a se comportar como na loja
 * pública, sem nenhum hack de CSS. Larguras fixas (390/1280) — as mesmas
 * usadas na validação visual da Fase B2 — garantidas mesmo que a coluna
 * do editor seja mais estreita (o wrapper rola horizontalmente).
 */
export function LivePreviewFrame({ payload }: { payload: Omit<AppearancePreviewMessage, "type"> }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [ready, setReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (isAppearancePreviewReadyMessage(event.data)) setReady(true);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const message: AppearancePreviewMessage = { type: APPEARANCE_PREVIEW_MESSAGE_TYPE, ...payload };
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, [ready, payload]);

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

      <div className="w-full overflow-x-auto rounded-xl border border-surface-container-highest bg-surface-container-lowest p-4">
        <iframe
          className="mx-auto block rounded-lg border border-surface-container-highest bg-white"
          height={device === "mobile" ? 780 : 820}
          ref={iframeRef}
          src={PREVIEW_URL}
          title="Pré-visualização da loja"
          width={device === "mobile" ? 390 : 1280}
        />
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        Prévia real da loja com os dados atuais — links de produto, carrinho e checkout ficam desativados aqui.
      </p>
    </div>
  );
}
