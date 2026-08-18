"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV_ITEMS } from "./nav-items";

/** `vexo_dashboard_principal_mobile` — só 4 itens no bottom nav, não a lista inteira do sidebar de desktop. */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 z-50 flex h-[64px] w-full items-center justify-around border-t border-outline-variant bg-surface-container-lowest px-2 md:hidden">
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = item.href === "/painel" ? pathname === "/painel" : pathname.startsWith(item.href);
        return (
          <Link
            className={
              active
                ? "flex h-full w-16 flex-col items-center justify-center text-primary"
                : "flex h-full w-16 flex-col items-center justify-center text-on-surface-variant transition-colors hover:text-on-surface"
            }
            href={item.href}
            key={item.href}
          >
            <span className="material-symbols-outlined mb-1">{item.icon}</span>
            <span className={active ? "font-label text-[10px] font-bold" : "font-label text-[10px]"}>
              {item.href === "/painel/configuracoes" ? "Config." : item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
