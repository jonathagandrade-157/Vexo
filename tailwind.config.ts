import type { Config } from "tailwindcss";

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
        surface: "#131316",
        "surface-dim": "#131316",
        "surface-bright": "#39393c",
        "surface-container-lowest": "#0e0e11",
        "surface-container-low": "#1b1b1e",
        "surface-container": "#1f1f22",
        "surface-container-high": "#2a2a2d",
        "surface-container-highest": "#353437",
        "on-surface": "#e4e1e5",
        "on-surface-variant": "#ccc3d8",
        "inverse-surface": "#e4e1e5",
        "inverse-on-surface": "#303033",
        outline: "#958da1",
        "outline-variant": "#4a4455",
        "surface-tint": "#d2bbff",
        primary: "#d2bbff",
        "on-primary": "#3f008e",
        "primary-container": "#7c3aed",
        "on-primary-container": "#ede0ff",
        "inverse-primary": "#732ee4",
        secondary: "#adc6ff",
        "on-secondary": "#002e6a",
        "secondary-container": "#0566d9",
        "on-secondary-container": "#e6ecff",
        tertiary: "#ffb784",
        "on-tertiary": "#4f2500",
        "tertiary-container": "#a15100",
        "on-tertiary-container": "#ffe0cd",
        error: "#ffb4ab",
        "on-error": "#690005",
        "error-container": "#93000a",
        "on-error-container": "#ffdad6",
        "primary-fixed": "#eaddff",
        "primary-fixed-dim": "#d2bbff",
        "on-primary-fixed": "#25005a",
        "on-primary-fixed-variant": "#5a00c6",
        "secondary-fixed": "#d8e2ff",
        "secondary-fixed-dim": "#adc6ff",
        "on-secondary-fixed": "#001a42",
        "on-secondary-fixed-variant": "#004395",
        "tertiary-fixed": "#ffdcc6",
        "tertiary-fixed-dim": "#ffb784",
        "on-tertiary-fixed": "#301400",
        "on-tertiary-fixed-variant": "#713700",
        background: "#131316",
        "on-background": "#e4e1e5",
        "surface-variant": "#353437",
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
