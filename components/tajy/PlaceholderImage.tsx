/**
 * Stand-in for a real Clínica Tajy photograph. No real photos were
 * supplied with the Stitch export (only temporary lh3.googleusercontent
 * preview URLs outside our control), so every photo slot renders this
 * instead of a hotlinked or invented image — clearly labeled, per the
 * brief's "criar placeholder claramente identificável" rule.
 */
export function PlaceholderImage({
  label,
  className = "",
  icon = "tooth",
}: {
  label: string;
  className?: string;
  icon?: "tooth" | "smile" | "clinic";
}) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-gradient-to-br from-tajy-surfaceHigh via-tajy-surface to-tajy-black text-center ${className}`}
      role="img"
      aria-label={`Espaço reservado para imagem real: ${label}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(197,160,89,0.14),transparent_60%)]" />
      <ToothIcon icon={icon} />
      <p className="relative max-w-[220px] px-4 text-[11px] font-medium uppercase tracking-[0.18em] text-tajy-gold/80">
        {label}
      </p>
      <span className="relative text-[10px] text-neutral-500">
        imagem a confirmar pela clínica
      </span>
    </div>
  );
}

function ToothIcon({ icon }: { icon: "tooth" | "smile" | "clinic" }) {
  if (icon === "smile") {
    return (
      <svg className="relative h-10 w-10 text-tajy-gold/50" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 13c.8 1.2 2.2 2 4 2s3.2-.8 4-2" strokeLinecap="round" />
        <path d="M9 9h.01M15 9h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "clinic") {
    return (
      <svg className="relative h-10 w-10 text-tajy-gold/50" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="relative h-10 w-10 text-tajy-gold/50" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5c-2-2.5-5.5-2.5-7.5-.5s-1.5 5 0 7.5l7.5 8 7.5-8c1.5-2.5 2-5.5 0-7.5s-5.5-2-7.5.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
