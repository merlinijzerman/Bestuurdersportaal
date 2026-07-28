import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // T9-splitsing (besluit 0052): componenten/lib leven sinds de core/-split ook
    // in core/, platform/ en fondsen/. Zonder deze globs scant Tailwind die lagen
    // niet en worden classes die ALLEEN daar voorkomen (bv. de inklap-sidebar
    // md:w-14 / md:ml-14) niet gegenereerd. Zelfde roots als de kleur-guard
    // (scripts/check-brand-hex.mjs).
    "./core/**/*.{js,ts,jsx,tsx,mdx}",
    "./platform/**/*.{js,ts,jsx,tsx,mdx}",
    "./fondsen/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantische tokenlaag — bron van waarheid in app/globals.css.
        // RGB-channel patroon zodat Tailwind opacity-modifiers (bg-accent/15,
        // ring-accent/40) correct renderen. Losse --x kleuren blijven bestaan
        // voor direct CSS/SVG-gebruik (fill="var(--ok)").
        paper: "rgb(var(--paper-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--muted-rgb) / <alpha-value>)",
        line: "rgb(var(--line-rgb) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          ink: "rgb(var(--accent-ink-rgb) / <alpha-value>)",
          tint: "rgb(var(--accent-tint-rgb) / <alpha-value>)",
        },
        card: "rgb(var(--card-rgb) / <alpha-value>)",
        app: {
          bg: "rgb(var(--app-bg-rgb) / <alpha-value>)",
          surface: "rgb(var(--app-surface-rgb) / <alpha-value>)",
          line: "rgb(var(--app-line-rgb) / <alpha-value>)",
          "line-strong": "rgb(var(--app-line-strong-rgb) / <alpha-value>)",
          zebra: "rgb(var(--app-zebra-rgb) / <alpha-value>)",
        },
        nav: {
          DEFAULT: "rgb(var(--nav-rgb) / <alpha-value>)",
          line: "rgb(var(--nav-line-rgb) / <alpha-value>)",
          text: "rgb(var(--nav-text-rgb) / <alpha-value>)",
          "text-active": "rgb(var(--nav-text-active-rgb) / <alpha-value>)",
          active: "var(--nav-active)",
          accent: "rgb(var(--nav-accent-rgb) / <alpha-value>)",
        },
        ok: {
          DEFAULT: "rgb(var(--ok-rgb) / <alpha-value>)",
          tint: "rgb(var(--ok-tint-rgb) / <alpha-value>)",
          ink: "rgb(var(--ok-ink-rgb) / <alpha-value>)",
        },
        err: {
          DEFAULT: "rgb(var(--err-rgb) / <alpha-value>)",
          tint: "rgb(var(--err-tint-rgb) / <alpha-value>)",
          ink: "rgb(var(--err-ink-rgb) / <alpha-value>)",
        },
        warn: {
          DEFAULT: "rgb(var(--warn-rgb) / <alpha-value>)",
          tint: "rgb(var(--warn-tint-rgb) / <alpha-value>)",
          ink: "rgb(var(--warn-ink-rgb) / <alpha-value>)",
        },
        phase: {
          DEFAULT: "rgb(var(--phase-rgb) / <alpha-value>)",
          tint: "rgb(var(--phase-tint-rgb) / <alpha-value>)",
          ink: "rgb(var(--phase-ink-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "-apple-system", "Segoe UI", "sans-serif"],
      },
      // Kaart-elevatie voor de stuurinformatie-opmaak (T17): shadow-card mapt
      // op het --shadow-card-token in globals.css (bron van waarheid).
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};

export default config;
