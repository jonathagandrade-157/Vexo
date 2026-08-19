import Image from "next/image";
import Link from "next/link";

import type { PublicProductSummary } from "@/features/storefront/catalog";
import { formatPrice } from "@/features/products/format-price";
import { getProductImagePublicUrl } from "@/features/products/image-storage";

/**
 * Adaptado de `vexo_storefront_categoria_desktop` (Stitch) — mesma
 * estrutura de card (imagem, nome, preço), sem favoritar/carrinho (não
 * existem conta de cliente nem carrinho ainda) e sem badge "Novo" (dado
 * fictício, não derivável de nenhuma coluna real).
 */
export function StorefrontProductCard({
  product,
  storeSlug,
}: {
  product: PublicProductSummary;
  storeSlug: string;
}) {
  const { promotional_price: promotionalPrice } = product;

  return (
    <Link className="group flex flex-col" href={`/loja/${storeSlug}/produto/${product.slug}`}>
      <div className="relative mb-4 aspect-[4/5] overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low transition-colors group-hover:border-primary/30">
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
            <span className="material-symbols-outlined text-4xl text-outline">image</span>
          </div>
        )}
      </div>
      <div className="flex flex-grow flex-col">
        {product.category ? (
          <span className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
            {product.category.name}
          </span>
        ) : null}
        <h3 className="mb-2 line-clamp-2 font-headline text-[18px] leading-tight text-on-surface transition-colors group-hover:text-primary">
          {product.name}
        </h3>
        <div className="mt-auto flex items-center gap-2">
          {promotionalPrice !== null ? (
            <>
              <span className="font-label text-label-md text-on-surface">{formatPrice(promotionalPrice)}</span>
              <span className="font-body text-body-sm text-on-surface-variant line-through">
                {formatPrice(product.price)}
              </span>
            </>
          ) : (
            <span className="font-label text-label-md text-on-surface">{formatPrice(product.price)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
