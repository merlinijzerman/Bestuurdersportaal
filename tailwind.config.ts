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
          // Rand van bedieningselementen — WCAG 1.4.11 (>= 3:1). Zie besluit 0097;
          // line-strong voldoet daar niet aan en blijft decoratief.
          "line-control": "rgb(var(--app-line-control-rgb) / <alpha-value>)",
          zebra: "rgb(var(--app-zebra-rgb) / <alpha-value>)",
        },
        // Markering in lopende tekst (toegankelijkheidsafspraak, besluit 0097).
        mark: "rgb(var(--mark-rgb) / <alpha-value>)",
        nav: {
          DEFAULT: "rgb(var(--nav-rgb) / <alpha-value>)",
          line: "rgb(var(--nav-line-rgb) / <alpha-value>)",
          text: "rgb(var(--nav-text-rgb) / <alpha-value>)",
          "text-active": "rgb(var(--nav-text-active-rgb) / <alpha-value>)",
          active: "var(--nav-active)",
          accent: "rgb(var(--nav-accent-rgb) / <alpha-value>)",
          // Accentrand van het actieve nav-item (T3). Bewust géén vulvlak met
          // witte tekst erop: wit haalt daar 2,45:1. Zie besluit 0202.
          rail: "rgb(var(--nav-rail-rgb) / <alpha-value>)",
        },
        // Assistent-accent (T3, besluit 0202) — uitsluitend voor AI-elementen.
        // `ai.DEFAULT` is het enige lid dat tekst mag dragen; `ai.500` is
        // grafisch en `ai.line` decoratief. Zie de noot in app/globals.css.
        ai: {
          DEFAULT: "rgb(var(--ai-rgb) / <alpha-value>)",
          500: "rgb(var(--ai-500-rgb) / <alpha-value>)",
          tint: "rgb(var(--ai-tint-rgb) / <alpha-value>)",
          line: "rgb(var(--ai-line-rgb) / <alpha-value>)",
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
        "card-hover": "var(--shadow-card-hover)",
      },
    },
  },
  plugins: [],
};

export default config;
