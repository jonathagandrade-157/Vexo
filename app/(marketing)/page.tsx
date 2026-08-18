import Link from "next/link";

/**
 * Placeholder only — NOT the Stitch landing page
 * (`vexo_landing_page_oficial_desktop`). Recreating that screen from the
 * design reference is scoped to a later stage (architecture §24); this
 * route exists so the (marketing) route group and the design tokens can be
 * verified end-to-end. The "Começar teste grátis" link is Etapa 3's real
 * signup flow — the only functional part of this page for now.
 */
export default function MarketingHomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-margin-mobile text-center">
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
        Em construção
      </p>
      <h1 className="font-display text-display-lg-mobile text-on-background sm:text-display-lg">
        VEXO
      </h1>
      <p className="max-w-prose font-body text-body-md text-on-surface-variant">
        Esta página será substituída pela landing page oficial do Stitch em
        uma etapa posterior.
      </p>
      <Link
        className="mt-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-primary"
        href="/cadastro"
      >
        Começar teste grátis
      </Link>
    </main>
  );
}
