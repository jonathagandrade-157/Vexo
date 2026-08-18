/** Mesmo padrão de TextField, para o único campo opcional desta etapa (descrição da marca). */
export function TextareaField({
  id,
  name,
  label,
  placeholder,
  error,
  defaultValue,
  rows = 3,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  error?: string;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor={id}>
        {label}
      </label>
      <textarea
        className="input-focus-glow w-full resize-none rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface transition-all placeholder:text-outline-variant focus:outline-none"
        id={id}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p className="text-label-sm text-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
