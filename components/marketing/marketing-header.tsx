import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";

const NAV_LINKS = [
  { href: "#recursos", label: "Recursos" },
  { href: "#como-funciona", label: "Soluções" },
  { href: "#planos", label: "Planos" },
];

/** TopAppBar de `vexo_landing_page_oficial_desktop`/`mobile` (Stitch) — fixo, blur, mesmo padrão já usado em `StorefrontHeader`. */
export function MarketingHeader() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-container-max items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
        <Link href="/">
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-2 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              className="rounded-xl px-4 py-2 font-body text-body-md text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Link
          className="rounded-xl bg-primary-container px-6 py-2 font-label text-label-md text-on-primary-container transition-colors hover:bg-primary-container/90"
          href="/cadastro"
        >
          Começar
        </Link>
      </div>
    </header>
  );
}
