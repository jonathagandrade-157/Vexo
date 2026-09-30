import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-surface text-on-surface">
      <header className="border-b border-outline-variant/20 bg-surface-container-lowest">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-margin-mobile py-5 md:px-margin-desktop">
          <Link aria-label="VEXO — página inicial" href="/">
            <BrandMark />
          </Link>
          <Link
            className="font-label text-label-md text-on-surface-variant transition-colors hover:text-primary"
            href="/"
          >
            Voltar ao início
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-margin-mobile py-14 md:px-margin-desktop md:py-20">
        {children}
      </main>

      <footer className="border-t border-outline-variant/20 bg-surface-container-lowest">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-margin-mobile py-8 font-body text-body-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between md:px-margin-desktop">
          <span>© 2026 VEXO</span>
          <nav aria-label="Documentos legais" className="flex gap-5">
            <Link className="transition-colors hover:text-primary" href="/termos">
              Termos de Uso
            </Link>
            <Link className="transition-colors hover:text-primary" href="/privacidade">
              Privacidade
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
