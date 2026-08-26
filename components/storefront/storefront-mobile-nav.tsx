"use client";

import Link from "next/link";
import { useId, useState } from "react";

/**
 * Sprint 1 — Fase B2 — correção final. Botão hambúrguer + painel de
 * navegação para mobile, compartilhado pelos 5 templates (nunca um menu
 * por template — só muda `panelClassName`/`navLinkClassName`/`iconClassName`
 * via as classes já calculadas em `storefront-header.tsx`). Usa os mesmos
 * `NAV_ITEMS` e os mesmos hrefs por âncora do header — nada de rota nova.
 * Não trava o scroll da página (painel é apenas um dropdown, não um modal
 * de tela cheia) e fecha sozinho ao navegar para uma âncora.
 */
export function StorefrontMobileNav({
  navItems,
  homeHref,
  navLinkClassName,
  panelClassName,
  iconClassName,
}: {
  navItems: { label: string; anchor: string }[];
  homeHref: string;
  navLinkClassName: string;
  panelClassName: string;
  iconClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        className={`rounded-full p-2 transition-opacity hover:opacity-70 md:hidden ${iconClassName}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="material-symbols-outlined text-2xl">{open ? "close" : "menu"}</span>
      </button>

      {open ? (
        <nav
          className={`absolute inset-x-0 top-full flex flex-col gap-2 px-margin-mobile py-3 shadow-lg md:hidden ${panelClassName}`}
          id={panelId}
        >
          {navItems.map((item) => (
            <Link
              className={`block w-full rounded-md px-6 py-3 text-left ${navLinkClassName}`}
              href={`${homeHref}${item.anchor}`}
              key={item.label}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
