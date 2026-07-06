import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy (nergens meer als benoemde class gebruikt; verwijderen in fase 4)
        navy: {
          DEFAULT: "#0F2744",
          light: "#1A3A5C",
        },
        gold: {
          DEFAULT: "#C9A84C",
          light: "#E8D090",
        },
        // Semantische tokenlaag — bron van waarheid in app/globals.css
        paper: "var(--paper)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: {
          DEFAULT: "var(--accent)",
          ink: "var(--accent-ink)",
          tint: "var(--accent-tint)",
        },
        card: "var(--card)",
        app: {
          bg: "var(--app-bg)",
          surface: "var(--app-surface)",
          line: "var(--app-line)",
          "line-strong": "var(--app-line-strong)",
          zebra: "var(--app-zebra)",
        },
        nav: {
          DEFAULT: "var(--nav)",
          line: "var(--nav-line)",
          text: "var(--nav-text)",
          "text-active": "var(--nav-text-active)",
          active: "var(--nav-active)",
          accent: "var(--nav-accent)",
        },
        ok: "var(--ok)",
        err: "var(--err)",
        warn: "var(--warn)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
