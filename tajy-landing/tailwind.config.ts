import type { Config } from "tailwindcss";

/**
 * Design tokens for the Clínica Tajy landing page — ported 1:1 from the
 * Stitch export's `tailwind.config` (brand.*) and DESIGN.md. This file
 * has no dependency on any other project; every token this app uses
 * lives here.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tajy: {
          black: "#0c0f10",
          deep: "#111415",
          surface: "#191c1d",
          surfaceHigh: "#222628",
          card: "#16191b",
          gold: "#c5a059",
          goldLight: "#dfba73",
          goldDark: "#9e7d3b",
        },
      },
      fontFamily: {
        "tajy-serif": ["var(--font-tajy-serif)", "Georgia", "serif"],
        "tajy-sans": ["var(--font-tajy-sans)", "system-ui", "sans-serif"],
      },
    },
  },
};

export default config;
