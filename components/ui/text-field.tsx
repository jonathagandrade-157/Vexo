/**
 * Labeled input matching the Stitch reference's field pattern (uppercase
 * JetBrains Mono label, left icon, focus glow) — see e.g.
 * criar_conta_e_elegibilidade_trial/code.html's "Store Name"/"Email"
 * fields. Shared by every (auth) form instead of each page re-declaring
 * the same markup.
 */
export function TextField({
  id,
  name,
  label,
  icon,
  type = "text",
  placeholder,
  autoComplete,
  error,
  rightSlot,
  defaultValue,
  value,
  disabled,
  onChange,
  required = true,
}: {
  id: string;
  name: string;
  label: string;
  icon: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  rightSlot?: React.ReactNode;
  defaultValue?: string;
  /**
   * D3.2-A — opcional, só para o caso raro de um campo precisar ser
   * preenchido programaticamente depois da montagem (autofill de
   * endereço pelo CEP no checkout). Quando presente, o campo vira
   * controlado (exige `onChange`); quando ausente (todo o resto do
   * app), o campo continua exatamente como sempre foi — não controlado,
   * via `defaultValue`.
   */
  value?: string;
  disabled?: boolean;
  /** Opcional — só quando um Client Component precisa reagir ao valor digitado (ex.: CEP disparando cotação de frete, Etapa 12). O campo continua não controlado (defaultValue), isto é só um listener adicional. */
  onChange?: (value: string) => void;
  /** Default `true` (mesmo comportamento de sempre) — só usado como `false` por um campo genuinamente opcional (Etapa 12: CEP de origem). */
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="font-label text-label-md uppercase text-on-surface-variant"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant">
          {icon}
        </span>
        <input
          className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface transition-all placeholder:text-outline-variant focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          id={id}
          name={name}
          placeholder={placeholder}
          type={type}
          autoComplete={autoComplete}
          {...(value !== undefined ? { value } : { defaultValue })}
          disabled={disabled}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          required={required}
        />
        {rightSlot}
      </div>
      {error ? (
        <p className="text-label-sm text-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
