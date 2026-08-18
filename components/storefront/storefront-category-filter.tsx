import Link from "next/link";

import type { PublicCategory } from "@/features/storefront/catalog";

/**
 * Links reais (`?categoria=slug`), server-rendered — não checkboxes com
 * estado de cliente como o mockup do Stitch mostra. Mais simples e sem
 * JS extra, mesmo resultado (filtrar por categoria) — arquitetura §16
 * Etapa 7: "categorias disponíveis".
 */
export function StorefrontCategoryFilter({
  storeSlug,
  categories,
  activeCategorySlug,
}: {
  storeSlug: string;
  categories: PublicCategory[];
  activeCategorySlug?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        className={
          !activeCategorySlug
            ? "rounded-full bg-primary-container px-4 py-2 font-label text-label-sm text-on-primary-container"
            : "rounded-full border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
        }
        href={`/loja/${storeSlug}`}
      >
        Todas
      </Link>
      {categories.map((category) => (
        <Link
          className={
            activeCategorySlug === category.slug
              ? "rounded-full bg-primary-container px-4 py-2 font-label text-label-sm text-on-primary-container"
              : "rounded-full border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
          }
          href={`/loja/${storeSlug}?categoria=${category.slug}`}
          key={category.id}
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}
