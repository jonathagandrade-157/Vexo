import { PlaceholderImage } from "./PlaceholderImage";
import { RevealOnScroll } from "./RevealOnScroll";

const INSTAGRAM_HANDLE = "clinicatajy.sp";
const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;

export function Instagram() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <RevealOnScroll className="space-y-6 rounded-3xl border border-tajy-gold/20 bg-tajy-card p-8 text-center shadow-xl sm:p-12">
        <div className="mx-auto max-w-xl space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-tajy-gold">
            Acompanhe Nosso Trabalho
          </span>
          <h2 className="font-tajy-serif text-2xl font-bold text-white sm:text-3xl">
            Veja mais no Instagram
          </h2>
          <p className="text-xs font-light text-neutral-400 sm:text-sm">
            Bastidores e o dia a dia da clínica compartilhados em @{INSTAGRAM_HANDLE}
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 pt-2 sm:grid-cols-4">
          {["Post 1", "Post 2", "Post 3", "Post 4"].map((label) => (
            <div
              key={label}
              className="h-44 overflow-hidden rounded-2xl border border-white/10 transition-colors hover:border-tajy-gold sm:h-52"
            >
              <PlaceholderImage label={`Prévia do Instagram — ${label}`} className="h-full w-full" />
            </div>
          ))}
        </div>

        <div className="pt-4">
          <a
            className="inline-flex items-center gap-2.5 rounded-xl border border-tajy-gold px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-tajy-gold transition-all duration-300 hover:bg-tajy-gold hover:text-black"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
            <span>Conheça nosso Instagram</span>
          </a>
        </div>
      </RevealOnScroll>
    </section>
  );
}
