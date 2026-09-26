"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import {
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/features/theme/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_CHANGE_EVENT = "vexo-theme-change";
const SERVER_THEME_SNAPSHOT = "system:dark";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark());
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function getThemeSnapshot(): string {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const preference = isThemePreference(stored) ? stored : "system";
  return `${preference}:${resolveTheme(preference, systemPrefersDark())}`;
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  media.addEventListener("change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => SERVER_THEME_SNAPSHOT);
  const [storedPreference, storedResolvedTheme] = snapshot.split(":");
  const preference = isThemePreference(storedPreference) ? storedPreference : "system";
  const resolvedTheme: ResolvedTheme = storedResolvedTheme === "light" ? "light" : "dark";

  useLayoutEffect(() => {
    applyTheme(preference);
  }, [preference, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference(nextPreference) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
        applyTheme(nextPreference);
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      },
    }),
    [preference, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
