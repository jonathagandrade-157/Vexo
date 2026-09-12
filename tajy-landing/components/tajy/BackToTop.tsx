"use client";

import { useEffect, useState } from "react";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 900);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Voltar ao topo"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-5 left-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-tajy-gold/40 bg-tajy-black/90 text-tajy-gold shadow-lg backdrop-blur-md transition-all hover:border-tajy-gold hover:bg-tajy-gold hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-tajy-gold sm:bottom-6 sm:left-6"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
