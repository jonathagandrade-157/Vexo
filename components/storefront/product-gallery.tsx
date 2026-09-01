"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * D13.1 — componente ÚNICO compartilhado pelos 5 templates de storefront
 * (nenhum deles tem página de produto própria — `app/loja/[slug]/produto/[productSlug]/page.tsx`
 * é a mesma para todos, confirmado na auditoria D13.0). 1 imagem: mostra
 * normal, sem nenhuma faixa de miniaturas. 2+: miniaturas abaixo,
 * clicáveis/tocáveis (nunca depende de hover — funciona igual em
 * mobile). 0 imagens: mesmo placeholder de sempre.
 */
export function ProductGallery({ images, productName }: { images: { id: string; url: string }[]; productName: string }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = images[selectedIndex] ?? images[0];

  if (images.length === 0) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low">
        <div className="flex h-full w-full items-center justify-center">
          <span className="material-symbols-outlined text-6xl text-outline">image</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low">
        <Image alt={productName} className="object-cover" fill sizes="(min-width: 768px) 45vw, 90vw" src={selected!.url} />
      </div>

      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <button
              aria-current={index === selectedIndex}
              aria-label={`Ver imagem ${index + 1} de ${images.length}`}
              className={
                index === selectedIndex
                  ? "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-primary"
                  : "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 opacity-70 transition-opacity hover:opacity-100"
              }
              key={image.id}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <Image alt="" className="object-cover" fill sizes="64px" src={image.url} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
