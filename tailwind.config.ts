import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tokens canônicos do design system
        cobre: "#C9B79C",
        "orange-primary": "#E85600",
        "green-accent": "#a5d2ff",
        "neutral-100": "#0E0F11",
        "neutral-70": "#1A1B1D",
        "neutral-20": "#8D8D8D",

        // Aliases
        elevated: "#141517",
        card: "#1A1B1D",
        "card-hover": "#232427",
        bright: "#fafafa",
        primary: "#e8e8e8",
        secondary: "#8D8D8D",
        muted: "#555555",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "var(--font-jetbrains-mono)", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.03em",
      },
    },
  },
  plugins: [],
} satisfies Config;
