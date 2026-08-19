"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutButton } from "@/components/painel/logout-button";
import { MASTER_NAV_ITEMS } from "@/features/master/nav-items";

/**
 * Shell visual próprio do MASTER (prompt §33: "não copiar o layout do
 * storefront/painel do lojista... deve ficar visualmente claro que MASTER
 * = administração da plataforma") — mesma base técnica (tokens Tailwind
 * já existentes), acento `tertiary` (âmbar) em vez de `primary` (roxo, já
 * é a identidade do painel do lojista), única diferença estrutural real.
 */
export function MasterSidebar({ adminRole }: { adminRole: string }) {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 hidden h-screen w-[260px] flex-col border-r border-outline-variant bg-surface-container-lowest py-unit md:flex">
      <div className="mb-8 mt-4 flex items-center gap-3 px-gutter">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-tertiary-container text-white">
          <span className="material-symbols-outlined text-[20px]">shield_person</span>
        </div>
        <div className="min-w-0">
          <h1 className="font-headline text-headline-md font-bold tracking-tight text-tertiary">VEXO MASTER</h1>
          <p className="truncate font-label text-label-sm text-on-surface-variant">{adminRole}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-unit">
        <ul className="space-y-1">
          {MASTER_NAV_ITEMS.map((item) => {
            const active = item.href === "/master" ? pathname === "/master" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  className={
                    active
                      ? "flex items-center gap-3 rounded-lg border-l-2 border-tertiary bg-surface-container-low px-3 py-2 font-bold text-tertiary transition-colors duration-200 hover:bg-surface-container-high"
                      : "flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 font-medium text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-high hover:text-on-surface"
                  }
                  href={item.href}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span className="font-label text-label-md">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto space-y-4 px-unit">
        <Link
          className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-high hover:text-on-surface"
          href="/painel"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span className="font-label text-label-md">Voltar ao painel</span>
        </Link>
        <ul className="space-y-1">
          <li>
            <LogoutButton variant="nav" />
          </li>
        </ul>
      </div>
    </nav>
  );
}
