import { describe, expect, it } from "vitest";

import { isThemePreference, resolveTheme } from "@/features/theme/theme";

describe("theme preference", () => {
  it.each(["system", "light", "dark"])("accepts %s", (theme) => {
    expect(isThemePreference(theme)).toBe(true);
  });

  it.each([null, undefined, "", "auto", "white"])("rejects invalid value %s", (theme) => {
    expect(isThemePreference(theme)).toBe(false);
  });

  it("resolves the system preference from the media query", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps an explicit preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
