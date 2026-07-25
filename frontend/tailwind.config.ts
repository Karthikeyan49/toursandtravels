import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Every colour is an `hsl(var(--token))` reference — no literal hex or palette
 * class (`bg-amber-50`) belongs in a shared component. Adding a theme means
 * editing src/index.css only.
 */
const config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Document / workflow states. `.fg` is the text+icon colour, `.bg` the
        // soft surface behind it; both are tuned per theme in index.css.
        status: {
          draft: { DEFAULT: "hsl(var(--status-draft))", bg: "hsl(var(--status-draft-bg))" },
          confirmed: { DEFAULT: "hsl(var(--status-confirmed))", bg: "hsl(var(--status-confirmed-bg))" },
          vouchered: { DEFAULT: "hsl(var(--status-vouchered))", bg: "hsl(var(--status-vouchered-bg))" },
          "in-progress": { DEFAULT: "hsl(var(--status-in-progress))", bg: "hsl(var(--status-in-progress-bg))" },
          completed: { DEFAULT: "hsl(var(--status-completed))", bg: "hsl(var(--status-completed-bg))" },
          cancelled: { DEFAULT: "hsl(var(--status-cancelled))", bg: "hsl(var(--status-cancelled-bg))" },
          pending: { DEFAULT: "hsl(var(--status-pending))", bg: "hsl(var(--status-pending-bg))" },
          paid: { DEFAULT: "hsl(var(--status-paid))", bg: "hsl(var(--status-paid-bg))" },
          overdue: { DEFAULT: "hsl(var(--status-overdue))", bg: "hsl(var(--status-overdue-bg))" },
          won: { DEFAULT: "hsl(var(--status-won))", bg: "hsl(var(--status-won-bg))" },
          lost: { DEFAULT: "hsl(var(--status-lost))", bg: "hsl(var(--status-lost-bg))" },
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        // Tabular figures for money columns and document numbers.
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.18s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
