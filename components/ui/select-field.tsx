/**
 * Mesmo padrão visual de TextField (label uppercase, glow de foco), para
 * o `<select>` de segmento em onboarding_sobre_sua_marca — reaproveita
 * `.input-focus-glow` (Etapa 3) em vez da classe `.input-glow` que o CSS
 * do Stitch para esta tela declara com o mesmo efeito, para não manter
 * duas implementações do mesmo glow.
 */
export function SelectField({
  id,
  name,
  label,
  placeholder,
  options,
  error,
  defaultValue,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  error?: string;
  defaultValue?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <select
          className="input-focus-glow w-full appearance-none rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          required
        >
          <option disabled value="">
            {placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant">
          expand_more
        </span>
      </div>
      {error ? (
        <p className="text-label-sm text-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
