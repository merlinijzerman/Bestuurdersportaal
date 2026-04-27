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
        navy: {
          DEFAULT: "#0F2744",
          light: "#1A3A5C",
        },
        gold: {
          DEFAULT: "#C9A84C",
          light: "#E8D090",
        },
      },
    },
  },
  plugins: [],
};

export default config;
