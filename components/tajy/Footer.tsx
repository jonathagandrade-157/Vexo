import { DEVELOPER_WHATSAPP, WHATSAPP_NUMBER } from "@/lib/tajy/whatsapp";

const CRO = "147011";

export function Footer() {
  const developerHref = DEVELOPER_WHATSAPP
    ? `https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent("Olá Jonatha, vi o projeto da Clínica Tajy")}`
    : undefined;

  return (
    <footer className="mt-28 border-t border-tajy-gold/10 bg-[#07090a] px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col items-center space-y-2">
          <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-tajy-gold/60 bg-tajy-surface">
            <svg className="h-6 w-6 text-tajy-gold" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4.5c-2-2.5-5.5-2.5-7.5-.5s-1.5 5 0 7.5l7.5 8 7.5-8c1.5-2.5 2-5.5 0-7.5s-5.5-2-7.5.5z" />
            </svg>
          </span>
          <span className="font-tajy-serif text-xl font-bold tracking-[0.28em] text-white">TAJY</span>
          <span className="text-[10px] uppercase tracking-[0.32em] text-tajy-gold">Odontologia Estética</span>
        </div>

        <div className="space-y-2 text-xs text-neutral-400 sm:text-sm">
          <p>Rua Voluntário da Pátria, 1284 — Santana, São Paulo - SP</p>
          <p className="text-[11px] text-neutral-500">CRO {CRO}</p>
          <div className="flex items-center justify-center gap-4 pt-1 text-xs">
            <a className="text-tajy-gold hover:underline" href="https://instagram.com/clinicatajy.sp" target="_blank" rel="noopener noreferrer">
              @clinicatajy.sp
            </a>
            <span aria-hidden="true">•</span>
            <a className="text-tajy-gold hover:underline" href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
              WhatsApp Oficial
            </a>
          </div>
        </div>

        <div className="mx-auto max-w-2xl space-y-2 border-t border-white/5 pt-4">
          <p className="text-[11px] text-neutral-500">
            Demonstração conceitual — informações sujeitas à confirmação pela Clínica Tajy.
          </p>
        </div>

        <div className="text-xs text-neutral-500">
          <span>Desenvolvido por </span>
          {developerHref ? (
            <a className="font-medium text-tajy-gold hover:underline" href={developerHref} target="_blank" rel="noopener noreferrer">
              Jonatha Andrade
            </a>
          ) : (
            <span className="font-medium text-neutral-300">Jonatha Andrade</span>
          )}
        </div>
      </div>
    </footer>
  );
}
