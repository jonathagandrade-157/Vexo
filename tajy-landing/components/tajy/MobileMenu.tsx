"use client";

import { createWhatsAppLink, WHATSAPP_MESSAGES } from "@/lib/tajy/whatsapp";

import { NAV_LINKS } from "./nav-links";
import { scrollToHash } from "./smooth-scroll";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function MobileMenu({
  open,
  onNavigate,
}: {
  open: boolean;
  onNavigate: () => void;
}) {
  return (
    <div
      id="mobile-menu"
      className={`grid overflow-hidden border-b border-tajy-gold/20 bg-tajy-black/98 backdrop-blur-xl transition-[grid-template-rows] duration-300 ease-out lg:hidden ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0">
        <div className="flex flex-col space-y-5 px-6 py-8 text-sm font-medium uppercase tracking-widest text-neutral-300">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="py-1 transition-colors hover:text-tajy-gold"
              onClick={(e) => {
                e.preventDefault();
                onNavigate();
                scrollToHash(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="border-t border-white/10 px-6 pb-8 pt-6">
          <a
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-black shadow-lg"
            href={createWhatsAppLink(WHATSAPP_MESSAGES.general)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavigate}
          >
            <WhatsAppIcon />
            <span>Agendar pelo WhatsApp</span>
          </a>
        </div>
      </div>
    </div>
  );
}
