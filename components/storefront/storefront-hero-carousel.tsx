"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";
import type { PublicBanner } from "@/features/storefront/banners";

const AUTOPLAY_MS = 5000;

/**
 * Sprint 1 — Fase C2. Camada de fundo do Hero (nunca uma seção nova —
 * ver `templates/*\/home.tsx`, que sempre a colocam como o primeiro filho
 * `absolute inset-0` do hero, atrás do overlay/gradiente e do conteúdo
 * real, que continuam por cima). 0 banners: o chamador nem monta este
 * componente (o hero atual fica idêntico). 1 banner: sem nenhum controle
 * de navegação — imagem estática. 2+: autoplay, setas, dots, pausa no
 * hover/foco. Sem lib nova — `setInterval` + crossfade por opacidade.
 *
 * Não intercepta clique fora da própria imagem: o link do banner
 * (`linkUrl`, se houver) cobre só a área da imagem dele; o conteúdo real
 * do hero (título/CTA) fica num `z-10` à parte em cada template, sempre
 * acima — nunca competem pelo mesmo clique.
 */
export function StorefrontHeroCarousel({ banners }: { banners: PublicBanner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const hasMultiple = banners.length > 1;

  useEffect(() => {
    if (!hasMultiple || paused) return;
    const id = setInterval(() => setIndex((current) => (current + 1) % banners.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [hasMultiple, paused, banners.length]);

  if (banners.length === 0) return null;

  return (
    <div
      className="absolute inset-0 z-0"
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {banners.map((banner, position) => {
        const active = position === index;
        const image = (
          <Image
            alt={banner.title ?? ""}
            className="object-cover"
            fill
            priority={position === 0}
            sizes="100vw"
            src={getTenantMediaPublicUrl(banner.imagePath)}
          />
        );

        return (
          <div
            aria-hidden={!active}
            className={`absolute inset-0 transition-opacity duration-700 ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}
            key={banner.id}
          >
            {banner.linkUrl ? (
              <Link className="absolute inset-0 block" href={banner.linkUrl} tabIndex={active ? 0 : -1}>
                <span className="sr-only">{banner.title ?? "Ver oferta"}</span>
                {image}
              </Link>
            ) : (
              image
            )}
          </div>
        );
      })}

      {hasMultiple ? (
        <>
          <button
            aria-label="Banner anterior"
            className="absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => setIndex((current) => (current - 1 + banners.length) % banners.length)}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <button
            aria-label="Próximo banner"
            className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => setIndex((current) => (current + 1) % banners.length)}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-2">
            {banners.map((banner, position) => (
              <button
                aria-current={position === index}
                aria-label={`Ir para o banner ${position + 1}`}
                className={`h-2 w-2 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                  position === index ? "bg-white" : "bg-white/40"
                }`}
                key={banner.id}
                onClick={() => setIndex(position)}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
