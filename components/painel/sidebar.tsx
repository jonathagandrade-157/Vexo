"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AI_SPARK_ITEM, MAIN_NAV_ITEMS, SUPPORT_ITEM } from "./nav-items";
import { LogoutButton } from "./logout-button";

/**
 * Único motivo de ser Client Component nesta etapa (arquitetura §19 —
 * "Client Components apenas onde existir interação real"): o estado ativo
 * do item de menu depende de `usePathname()`, que não existe em Server
 * Component. O resto do shell do painel (header, conteúdo) é servidor.
 */
export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 hidden h-screen w-[260px] flex-col border-r border-outline-variant bg-surface-container-lowest py-unit md:flex">
      <div className="mb-8 mt-4 flex items-center gap-3 px-gutter">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-container text-white">
          <span className="material-symbols-outlined text-[20px]">storefront</span>
        </div>
        <div className="min-w-0">
          <h1 className="font-headline text-headline-md font-bold tracking-tight text-primary">VEXO</h1>
          <p className="truncate font-label text-label-sm text-on-surface-variant" title={tenantName}>
            {tenantName}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-unit">
        <ul className="space-y-1">
          {MAIN_NAV_ITEMS.map((item) => {
            const active = item.href === "/painel" ? pathname === "/painel" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  className={
                    active
                      ? "flex items-center gap-3 rounded-lg border-l-2 border-primary bg-surface-container-low px-3 py-2 font-bold text-primary transition-colors duration-200 hover:bg-surface-container-high"
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
          className="ai-glow flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary-container to-[#3B82F6] px-4 py-2 font-label text-label-md text-white transition-opacity hover:opacity-90"
          href={AI_SPARK_ITEM.href}
        >
          <span className="material-symbols-outlined text-[18px]">{AI_SPARK_ITEM.icon}</span>
          {AI_SPARK_ITEM.label}
        </Link>
        <ul className="space-y-1">
          <li>
            <Link
              className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-high hover:text-on-surface"
              href={SUPPORT_ITEM.href}
            >
              <span className="material-symbols-outlined">{SUPPORT_ITEM.icon}</span>
              <span className="font-label text-label-md">{SUPPORT_ITEM.label}</span>
            </Link>
          </li>
          <li>
            <LogoutButton variant="nav" />
          </li>
        </ul>
      </div>
    </nav>
  );
}
