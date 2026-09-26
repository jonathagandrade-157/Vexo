"use client";

import type { ReactNode } from "react";

import { THEME_PREFERENCES, type ThemePreference } from "@/features/theme/theme";
import { useTheme } from "./theme-provider";

const LABELS: Record<ThemePreference, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Escuro",
};

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (theme === "light") {
    return (
      <svg aria-hidden="true" {...common}>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" {...common}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function ThemeButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`Usar tema ${label.toLowerCase()}`}
      aria-pressed={active}
      className={
        active
          ? "flex h-8 w-8 items-center justify-center rounded-md bg-surface text-primary shadow-sm transition-[background-color,color,transform] duration-150 active:scale-[0.97]"
          : "flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-[background-color,color,transform] duration-150 hover:bg-surface hover:text-on-surface active:scale-[0.97]"
      }
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme();
  const nextTheme = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length] ?? "system";

  return (
    <>
      <div
        aria-label="Aparência"
        className="hidden items-center gap-0.5 rounded-lg border border-outline-variant/40 bg-surface-container-low p-0.5 sm:flex"
        role="group"
      >
        {THEME_PREFERENCES.map((theme) => (
          <ThemeButton
            active={preference === theme}
            key={theme}
            label={LABELS[theme]}
            onClick={() => setPreference(theme)}
          >
            <ThemeIcon theme={theme} />
          </ThemeButton>
        ))}
      </div>
      <div className="sm:hidden">
        <ThemeButton
          active
          label={`${LABELS[preference]}. Alternar para ${LABELS[nextTheme]}`}
          onClick={() => setPreference(nextTheme)}
        >
          <ThemeIcon theme={preference} />
        </ThemeButton>
      </div>
    </>
  );
}
