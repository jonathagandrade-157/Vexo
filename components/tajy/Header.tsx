"use client";

import { useEffect, useState } from "react";

import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { MobileMenu } from "./MobileMenu";
import { NAV_LINKS } from "./nav-links";
import { scrollToHash } from "./smooth-scroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes the mobile drawer from anywhere, not just the toggle button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-white/5 bg-tajy-black/95 shadow-lg backdrop-blur-md"
          : "border-white/5 bg-tajy-black/90 backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a
          className="group flex items-center space-x-3"
          href="#hero"
          onClick={(e) => {
            e.preventDefault();
            scrollToHash("#hero");
          }}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-tajy-gold/60 bg-tajy-surface shadow-sm transition-colors group-hover:border-tajy-gold">
            <svg
              className="h-6 w-6 text-tajy-gold transition-transform group-hover:scale-110"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 4.5c-2-2.5-5.5-2.5-7.5-.5s-1.5 5 0 7.5l7.5 8 7.5-8c1.5-2.5 2-5.5 0-7.5s-5.5-2-7.5.5z" />
            </svg>
          </span>
          <span className="flex flex-col">
            <span className="font-tajy-serif text-lg font-bold leading-tight tracking-[0.28em] text-white">
              TAJY
            </span>
            <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.32em] text-tajy-gold">
              Odontologia Estética
            </span>
          </span>
        </a>

        <nav className="hidden items-center space-x-8 text-xs font-medium uppercase tracking-widest text-neutral-300 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-tajy-gold"
              onClick={(e) => {
                e.preventDefault();
                scrollToHash(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center space-x-4">
          <a
            className="hidden items-center gap-2.5 rounded-full bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_20px_rgba(197,160,89,0.35)] transition-all hover:brightness-110 active:scale-95 sm:inline-flex"
            href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <WhatsAppIcon />
            <span>Agendar pelo WhatsApp</span>
          </a>

          <button
            type="button"
            className="rounded-xl border border-tajy-gold/20 bg-tajy-surface p-2.5 text-neutral-200 transition-colors hover:text-tajy-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-tajy-gold lg:hidden"
            aria-label={menuOpen ? "Fechar menu de navegação" : "Abrir menu de navegação"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <MobileMenu open={menuOpen} onNavigate={() => setMenuOpen(false)} />
    </header>
  );
}
