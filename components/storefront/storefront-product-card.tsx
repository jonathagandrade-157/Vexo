import Image from "next/image";
import Link from "next/link";

import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import type { PublicProductSummary } from "@/features/storefront/catalog";
import { formatPrice } from "@/features/products/format-price";
import { getProductImagePublicUrl } from "@/features/products/image-storage";

interface CardVariantStyle {
  aspect: string;
  frame: string;
  imageGap: string;
  category: string;
  name: string;
  price: string;
  strike: string;
  badge: string | null;
}

/**
 * Sprint 1 — Fase B2 §6. UM `StorefrontProductCard` reaproveitado pelos 5
 * templates — preço, link do produto e imagem são exatamente a mesma
 * lógica de sempre (nunca duplicados); só a apresentação (aspecto,
 * espaçamento, tipografia, badge de promoção) muda por `variant`. Nunca
 * um badge "Novo" (dado fictício, sem coluna correspondente) — só
 * "OFERTA" quando `promotional_price` realmente existe.
 */
const VARIANT_STYLES: Record<StorefrontTemplate, CardVariantStyle> = {
  commerce: {
    aspect: "aspect-[4/5]",
    frame: "rounded-xl border border-neutral-200 bg-neutral-50 group-hover:border-[var(--store-primary)]/40",
    imageGap: "mb-4",
    category: "text-neutral-500",
    name: "text-neutral-900 group-hover:text-[var(--store-primary)]",
    price: "text-neutral-900",
    strike: "text-neutral-400",
    badge: "bg-[var(--store-primary)] text-white",
  },
  premium: {
    aspect: "aspect-[3/4]",
    frame: "border border-transparent bg-neutral-100",
    imageGap: "mb-6",
    category: "text-neutral-400 uppercase tracking-widest",
    name: "text-neutral-900 font-medium",
    price: "text-neutral-700",
    strike: "text-neutral-400",
    badge: null,
  },
  minimal: {
    aspect: "aspect-square",
    frame: "bg-neutral-50",
    imageGap: "mb-3",
    category: "text-neutral-400",
    name: "text-neutral-900",
    price: "text-neutral-700",
    strike: "text-neutral-400",
    badge: null,
  },
  editorial: {
    aspect: "aspect-[3/4]",
    frame: "bg-neutral-100",
    imageGap: "mb-4",
    category: "text-neutral-500 uppercase tracking-wider text-[11px]",
    name: "text-neutral-900 italic",
    price: "text-neutral-800",
    strike: "text-neutral-400",
    badge: null,
  },
  fashion: {
    aspect: "aspect-[4/5]",
    frame: "border border-white/10 bg-neutral-900 group-hover:border-[var(--store-primary)]/50",
    imageGap: "mb-4",
    category: "text-white/50",
    name: "text-white uppercase tracking-tight group-hover:text-[var(--store-primary)]",
    price: "text-[var(--store-primary)]",
    strike: "text-white/40",
    badge: "bg-[var(--store-primary)] text-white",
  },
};

export function StorefrontProductCard({
  product,
  storeSlug,
  variant = "commerce",
}: {
  product: PublicProductSummary;
  storeSlug: string;
  variant?: StorefrontTemplate;
}) {
  const { promotional_price: promotionalPrice } = product;
  const style = VARIANT_STYLES[variant] ?? VARIANT_STYLES.commerce;

  return (
    <Link className="group flex flex-col" href={`/loja/${storeSlug}/produto/${product.slug}`}>
      <div className={`relative overflow-hidden transition-colors ${style.aspect} ${style.frame} ${style.imageGap}`}>
        {product.main_image ? (
          <Image
            alt={product.name}
            className="object-cover"
            fill
            sizes="(min-width: 1280px) 22vw, (min-width: 640px) 45vw, 90vw"
            src={getProductImagePublicUrl(product.main_image)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-neutral-300">image</span>
          </div>
        )}
        {promotionalPrice !== null && style.badge ? (
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 font-label text-label-sm uppercase ${style.badge}`}>
            Oferta
          </span>
        ) : null}
      </div>
      <div className="flex flex-grow flex-col">
        {product.category ? (
          <span className={`mb-1 font-label text-label-sm uppercase tracking-wider ${style.category}`}>
            {product.category.name}
          </span>
        ) : null}
        <h3 className={`mb-2 line-clamp-2 font-headline text-[18px] leading-tight transition-colors ${style.name}`}>
          {product.name}
        </h3>
        <div className="mt-auto flex items-center gap-2">
          {promotionalPrice !== null ? (
            <>
              <span className={`font-label text-label-md ${style.price}`}>{formatPrice(promotionalPrice)}</span>
              <span className={`font-body text-body-sm line-through ${style.strike}`}>{formatPrice(product.price)}</span>
            </>
          ) : (
            <span className={`font-label text-label-md ${style.price}`}>{formatPrice(product.price)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
