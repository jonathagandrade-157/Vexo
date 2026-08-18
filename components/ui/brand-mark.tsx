/** "VEXO" wordmark + icon, as it appears at the top of every (auth) screen. */
export function BrandMark({ icon = "auto_awesome" }: { icon?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="material-symbols-outlined text-primary"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <span className="font-display text-headline-sm font-bold tracking-tight text-on-surface">
        VEXO
      </span>
    </div>
  );
}
