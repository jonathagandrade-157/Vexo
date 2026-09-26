import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";

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
        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeSwitcher />
          <Link
            className="rounded-lg px-3 py-2 font-label text-label-md text-on-surface-variant transition-[background-color,color,transform] duration-150 hover:bg-surface-container hover:text-on-surface active:scale-[0.97] sm:px-4"
            href="/login"
          >
            Entrar
          </Link>
          <Link
            className="rounded-lg bg-primary-container px-4 py-2 font-label text-label-md text-on-primary-container transition-[background-color,transform] duration-150 hover:bg-primary-container/90 active:scale-[0.97] sm:px-6"
            href="/cadastro"
          >
            Começar
          </Link>
        </div>
      </div>
    </header>
  );
}
