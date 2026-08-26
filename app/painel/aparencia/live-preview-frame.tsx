"use client";

import { useEffect, useRef, useState } from "react";

import {
  APPEARANCE_PREVIEW_MESSAGE_TYPE,
  isAppearancePreviewReadyMessage,
  type AppearancePreviewMessage,
} from "@/features/storefront/preview-message";

const PREVIEW_URL = "/painel-preview/aparencia";

const VIEWPORT = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

/**
 * Sprint 1 — Fase B3/C2 — ajuste final do preview Mobile. Sem teto de
 * escala para o dispositivo mobile — o antigo `Math.min(1, ...)` deixava
 * o quadro sempre do tamanho físico real (390×844), então em qualquer
 * painel maior que isso (praticamente sempre) sobrava uma moldura preta
 * enorme ao redor. Um teto alto (nunca infinito, para não borrar/pixelar
 * num monitor gigante) ainda deixa a escala crescer para preencher a
 * área disponível de verdade.
 */
const MAX_MOBILE_SCALE = 3;

/**
 * Sprint 1 — Fase B3 — ajuste final. Host do `<iframe>` que mostra a loja
 * de verdade (mesmos componentes de `components/storefront/`) reagindo às
 * edições locais do editor — nunca salva nada, só reflete. Um `<iframe>`
 * (não uma `<div>` encolhida) é a única forma correta de ter Desktop/
 * Mobile de verdade aqui: cada um tem seu próprio viewport, então
 * `hidden md:flex`/`grid-cols-2 md:grid-cols-4` (Tailwind, baseado na
 * largura real do viewport) respondem de verdade, e o `<header
 * className="fixed">` da storefront volta a se comportar como na loja
 * pública, sem nenhum hack de CSS.
 *
 * O `<iframe>` sempre usa o viewport REAL (1280/390) — nunca `width:
 * 100%` (isso quebraria as media queries reais dos templates). Um
 * wrapper externo aplica `transform: scale()` (medido via
 * `ResizeObserver`) só visualmente; o iframe por dentro continua
 * pensando que tem 1280×900 (Desktop) ou 390×844 (Mobile). Desktop nunca
 * amplia além do tamanho real (`Math.min(1, ...)`, inalterado — o
 * objetivo ali é só nunca cortar). Mobile É apresentado maior que
 * 390×844 quando há espaço (`MAX_MOBILE_SCALE`), calculado a partir da
 * largura E da altura disponíveis (a moldura mobile é estreita e alta;
 * escalar só pela largura sem olhar a altura poderia gerar um quadro
 * mais alto que o próprio painel). Os dois ficam centralizados.
 */
export function LivePreviewFrame({ payload, publicStoreHref }: { payload: Omit<AppearancePreviewMessage, "type">; publicStoreHref: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const viewport = VIEWPORT[device];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function recomputeScale() {
      const availableWidth = container!.clientWidth;
      const availableHeight = container!.clientHeight;

      if (device === "desktop") {
        // Nunca amplia além do tamanho real — só evita que o quadro fique maior que a coluna.
        setScale(Math.min(1, availableWidth / viewport.width));
        return;
      }

      // Mobile: preenche o espaço disponível (largura E altura, o menor
      // dos dois manda — mesma lógica de "object-fit: contain"), sem o
      // teto de 1 — é isso que elimina a moldura preta desproporcional.
      const scaleToFitWidth = availableWidth / viewport.width;
      const scaleToFitHeight = availableHeight / viewport.height;
      setScale(Math.min(scaleToFitWidth, scaleToFitHeight, MAX_MOBILE_SCALE));
    }

    recomputeScale();
    const observer = new ResizeObserver(recomputeScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [device, viewport.width, viewport.height]);

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

  const footprintWidth = viewport.width * scale;
  const footprintHeight = viewport.height * scale;

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-headline text-headline-sm text-on-surface">Pré-visualização</h2>
        <div className="flex items-center gap-3">
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
          <a
            className="flex items-center gap-1.5 rounded-lg border border-surface-container-highest px-3 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
            href={publicStoreHref}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            Abrir loja
          </a>
        </div>
      </div>

      <div
        className="w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-surface-container-highest bg-surface-container-lowest p-4"
        ref={containerRef}
      >
        <div
          style={{
            width: footprintWidth,
            height: footprintHeight,
            marginLeft: "auto",
            marginRight: "auto",
            overflow: "hidden",
          }}
        >
          <div style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <iframe
              className="block rounded-lg border border-surface-container-highest bg-white"
              height={viewport.height}
              ref={iframeRef}
              src={PREVIEW_URL}
              title="Pré-visualização da loja"
              width={viewport.width}
            />
          </div>
        </div>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        Prévia real da loja com os dados atuais (ainda não salvos) — links de produto, carrinho e checkout ficam
        desativados aqui.
      </p>
    </div>
  );
}
