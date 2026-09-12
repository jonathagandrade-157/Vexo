"use client";

import { useEffect, useState } from "react";

import { PlaceholderImage } from "./PlaceholderImage";

const GALLERY_ITEMS = [
  "Caso 1 — a confirmar pela clínica",
  "Caso 2 — a confirmar pela clínica",
  "Caso 3 — a confirmar pela clínica",
  "Caso 4 — a confirmar pela clínica",
] as const;

/** Grid of result photos with hover zoom and a keyboard-navigable lightbox. */
export function ResultsGallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? i : (i + 1) % GALLERY_ITEMS.length));
      if (e.key === "ArrowLeft")
        setOpenIndex((i) => (i === null ? i : (i - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openIndex]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {GALLERY_ITEMS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="group relative h-36 overflow-hidden rounded-xl border border-white/10 transition-colors hover:border-tajy-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-tajy-gold sm:h-44"
            onClick={() => setOpenIndex(i)}
            aria-label={`Ampliar: ${label}`}
          >
            <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-110">
              <PlaceholderImage label={label} icon="smile" className="h-full w-full" />
            </div>
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Galeria de resultados ampliada"
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full border border-white/20 p-2 text-white transition-colors hover:border-tajy-gold hover:text-tajy-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-tajy-gold"
            aria-label="Fechar galeria"
            onClick={() => setOpenIndex(null)}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 p-2 text-white transition-colors hover:border-tajy-gold hover:text-tajy-gold sm:left-6"
            aria-label="Imagem anterior"
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex((i) => (i === null ? i : (i - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length));
            }}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div
            className="aspect-video w-full max-w-2xl overflow-hidden rounded-2xl border border-tajy-gold/30"
            onClick={(e) => e.stopPropagation()}
          >
            <PlaceholderImage label={GALLERY_ITEMS[openIndex] ?? GALLERY_ITEMS[0]} icon="smile" className="h-full w-full" />
          </div>

          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 p-2 text-white transition-colors hover:border-tajy-gold hover:text-tajy-gold sm:right-6"
            aria-label="Próxima imagem"
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex((i) => (i === null ? i : (i + 1) % GALLERY_ITEMS.length));
            }}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
