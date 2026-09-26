import type { Config } from "tailwindcss";

const colorVar = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

/**
 * Single source of truth for the VEXO design system, ported 1:1 from
 * `docs/architecture/vexo-arquitetura-tecnica.md` §0.3 / §17, which itself
 * ports the tokens from the official Stitch export
 * (`stitch_vexo_design_system/vexo_design_system/DESIGN.md`).
 *
 * Do not hand-tune these values for a single screen — if a token needs to
 * change, it changes here so every screen (painel, storefront, landing)
 * stays consistent, matching the "não redesenhar" rule for the Stitch
 * reference.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: colorVar("surface"),
        "surface-dim": colorVar("surface-dim"),
        "surface-bright": colorVar("surface-bright"),
        "surface-container-lowest": colorVar("surface-container-lowest"),
        "surface-container-low": colorVar("surface-container-low"),
        "surface-container": colorVar("surface-container"),
        "surface-container-high": colorVar("surface-container-high"),
        "surface-container-highest": colorVar("surface-container-highest"),
        "on-surface": colorVar("on-surface"),
        "on-surface-variant": colorVar("on-surface-variant"),
        "inverse-surface": colorVar("inverse-surface"),
        "inverse-on-surface": colorVar("inverse-on-surface"),
        outline: colorVar("outline"),
        "outline-variant": colorVar("outline-variant"),
        "surface-tint": colorVar("surface-tint"),
        primary: colorVar("primary"),
        "on-primary": colorVar("on-primary"),
        "primary-container": colorVar("primary-container"),
        "on-primary-container": colorVar("on-primary-container"),
        "inverse-primary": colorVar("inverse-primary"),
        secondary: colorVar("secondary"),
        "on-secondary": colorVar("on-secondary"),
        "secondary-container": colorVar("secondary-container"),
        "on-secondary-container": colorVar("on-secondary-container"),
        tertiary: colorVar("tertiary"),
        "on-tertiary": colorVar("on-tertiary"),
        "tertiary-container": colorVar("tertiary-container"),
        "on-tertiary-container": colorVar("on-tertiary-container"),
        error: colorVar("error"),
        "on-error": colorVar("on-error"),
        "error-container": colorVar("error-container"),
        "on-error-container": colorVar("on-error-container"),
        "primary-fixed": colorVar("primary-fixed"),
        "primary-fixed-dim": colorVar("primary-fixed-dim"),
        "on-primary-fixed": colorVar("on-primary-fixed"),
        "on-primary-fixed-variant": colorVar("on-primary-fixed-variant"),
        "secondary-fixed": colorVar("secondary-fixed"),
        "secondary-fixed-dim": colorVar("secondary-fixed-dim"),
        "on-secondary-fixed": colorVar("on-secondary-fixed"),
        "on-secondary-fixed-variant": colorVar("on-secondary-fixed-variant"),
        "tertiary-fixed": colorVar("tertiary-fixed"),
        "tertiary-fixed-dim": colorVar("tertiary-fixed-dim"),
        "on-tertiary-fixed": colorVar("on-tertiary-fixed"),
        "on-tertiary-fixed-variant": colorVar("on-tertiary-fixed-variant"),
        background: colorVar("background"),
        "on-background": colorVar("on-background"),
        "surface-variant": colorVar("surface-variant"),
      },
      fontFamily: {
        display: ["var(--font-hanken-grotesk)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        label: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-lg": [
          "48px",
          { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "display-lg-mobile": [
          "36px",
          { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "headline-md": [
          "30px",
          { lineHeight: "38px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        "headline-sm": [
          "24px",
          { lineHeight: "32px", fontWeight: "600" },
        ],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-md": [
          "13px",
          { lineHeight: "16px", letterSpacing: "0.02em", fontWeight: "500" },
        ],
        "label-sm": [
          "11px",
          { lineHeight: "14px", letterSpacing: "0.05em", fontWeight: "500" },
        ],
      },
      borderRadius: {
        sm: "0.125rem",
        DEFAULT: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      spacing: {
        gutter: "24px",
        "margin-mobile": "16px",
        "margin-desktop": "32px",
      },
      maxWidth: {
        "container-max": "1440px",
      },
    },
  },
};

export default config;
