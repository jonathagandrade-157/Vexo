"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PlaceholderImage } from "./PlaceholderImage";

/**
 * Antes/Depois comparison slider. Works with mouse drag, touch drag, and
 * arrow keys on the handle (it's a real `role="slider"`). Both halves are
 * placeholders — no real before/after case was supplied, and the brief
 * forbids inventing clinical results.
 */
export function BeforeAfterSlider() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, ratio)));
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateFromClientX]);

  return (
    <div
      ref={containerRef}
      className="relative h-72 select-none overflow-hidden rounded-2xl border border-tajy-gold/30 shadow-xl sm:h-96"
      onPointerDown={(e) => {
        draggingRef.current = true;
        updateFromClientX(e.clientX);
      }}
    >
      <div className="absolute inset-0">
        <PlaceholderImage label="Depois — Lentes em Resina Tajy" icon="smile" className="h-full w-full" />
      </div>

      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <PlaceholderImage label="Antes — foto do caso" icon="tooth" className="h-full w-full" />
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/80 px-3 py-1 text-xs font-semibold text-neutral-300 backdrop-blur-sm">
        Antes
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark px-3 py-1 text-xs font-bold text-black shadow-md">
        Depois
      </span>

      <div
        className="absolute top-0 h-full w-0.5 bg-tajy-gold/80"
        style={{ left: `${position}%` }}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Comparar antes e depois"
          aria-valuenow={Math.round(position)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-black bg-gradient-to-br from-[#ecd38c] via-tajy-gold to-tajy-goldDark text-base font-bold text-black shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 5));
            if (e.key === "ArrowRight") setPosition((p) => Math.min(100, p + 5));
          }}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
