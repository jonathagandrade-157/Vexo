import { RevealOnScroll } from "./RevealOnScroll";

const ADDRESS_LINE_1 = "Rua Voluntário da Pátria, 1284";
const ADDRESS_LINE_2 = "Santana, São Paulo - SP, Brasil";
const ADDRESS_QUERY = encodeURIComponent(`${ADDRESS_LINE_1}, ${ADDRESS_LINE_2}`);

// Key-less embed (Google's "share > embed a map" URL shape) — no paid API needed.
const MAP_EMBED_SRC = `https://www.google.com/maps?q=${ADDRESS_QUERY}&output=embed`;
const MAP_DIRECTIONS_URL = `https://maps.google.com/?q=${ADDRESS_QUERY}`;

export function Location() {
  return (
    <section id="localizacao" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="mx-auto mb-16 max-w-3xl space-y-3 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">Localização</span>
        <h2 className="font-tajy-serif text-3xl font-bold text-white sm:text-4xl">Encontre a Clínica Tajy</h2>
      </RevealOnScroll>

      <RevealOnScroll className="grid grid-cols-1 items-center gap-8 rounded-3xl border border-tajy-gold/20 bg-tajy-surface p-6 shadow-2xl sm:p-10 lg:grid-cols-12">
        <div className="space-y-6 text-center lg:col-span-5 lg:text-left">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-tajy-gold/40 bg-black/40 text-tajy-gold shadow-md lg:mx-0">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div>
            <h3 className="font-tajy-serif text-lg font-bold uppercase tracking-wider text-white">Clínica Tajy</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              {ADDRESS_LINE_1}
              <br />
              {ADDRESS_LINE_2}
            </p>
          </div>
          <div className="pt-2">
            <a
              className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-tajy-gold px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-tajy-gold transition-colors hover:bg-tajy-gold hover:text-black"
              href={MAP_DIRECTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              <span>Como chegar</span>
            </a>
          </div>
        </div>

        <div className="relative h-72 overflow-hidden rounded-2xl border border-tajy-gold/30 bg-neutral-900 shadow-inner sm:h-96 lg:col-span-7">
          <iframe
            title="Mapa de localização da Clínica Tajy"
            src={MAP_EMBED_SRC}
            width="100%"
            height="100%"
            style={{ border: 0, filter: "invert(90%) hue-rotate(180deg) contrast(115%)" }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </RevealOnScroll>
    </section>
  );
}
