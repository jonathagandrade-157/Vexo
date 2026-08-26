"use client";

import { useId } from "react";

import { HEX_COLOR_PATTERN } from "@/features/settings/appearance-schema";

/**
 * Sprint 1 — Fase A. `<input type="color">` nativo (sem dependência
 * nova) sincronizado com um campo de texto hexadecimal — só aceita
 * `#RRGGBB` (mesma allowlist do schema/servidor; a validação real
 * continua no servidor, isto é só UX). Totalmente controlado pelo pai
 * (`value`/`onChange`, sem estado local espelhado) — nenhum efeito
 * necessário para refletir uma mudança externa como "Aplicar paleta": o
 * valor exibido É o `value` recebido, sempre. Um texto temporariamente
 * incompleto durante a digitação (ex.: "#7C3A") é repassado ao pai como
 * está — nunca persistido de verdade, porque o servidor valida de novo
 * antes de gravar; aqui só marca `aria-invalid`/mensagem de erro.
 */
export function ColorInput({
  label,
  name,
  value,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const isValid = HEX_COLOR_PATTERN.test(value);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          aria-label={`${label} — seletor visual`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-surface-container-highest bg-surface-container-lowest disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          type="color"
          value={isValid ? value : "#000000"}
        />
        <input
          aria-invalid={!isValid || undefined}
          className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm uppercase text-on-surface placeholder:text-outline-variant focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          id={id}
          maxLength={7}
          name={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#RRGGBB"
          type="text"
          value={value}
        />
      </div>
      {!isValid && value.length > 0 ? (
        <p className="font-body text-body-sm text-error" role="alert">
          Use o formato #RRGGBB
        </p>
      ) : null}
    </div>
  );
}
