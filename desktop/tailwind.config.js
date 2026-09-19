/** @type {import('tailwindcss').Config} */
const HUE_SCALES = [
  "amber",
  "rose",
  "red",
  "emerald",
  "sky",
  "violet",
  "teal",
  "orange",
];
const SHADES = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
];
/** 非 zinc 色阶也走 CSS 变量，便于浅色主题按语义反转（与 zinc 同机制） */
function varScale(hue) {
  return Object.fromEntries(
    SHADES.map((n) => [n, `rgb(var(--${hue}-${n}) / <alpha-value>)`])
  );
}

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)",
          dark: "#128C7E",
          deeper: "#075E54",
        },
        zinc: {
          50: "rgb(var(--zinc-50) / <alpha-value>)",
          100: "rgb(var(--zinc-100) / <alpha-value>)",
          200: "rgb(var(--zinc-200) / <alpha-value>)",
          300: "rgb(var(--zinc-300) / <alpha-value>)",
          400: "rgb(var(--zinc-400) / <alpha-value>)",
          500: "rgb(var(--zinc-500) / <alpha-value>)",
          600: "rgb(var(--zinc-600) / <alpha-value>)",
          700: "rgb(var(--zinc-700) / <alpha-value>)",
          800: "rgb(var(--zinc-800) / <alpha-value>)",
          900: "rgb(var(--zinc-900) / <alpha-value>)",
          950: "rgb(var(--zinc-950) / <alpha-value>)",
        },
        ...Object.fromEntries(HUE_SCALES.map((h) => [h, varScale(h)])),
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.35" }],
        ui: ["13px", { lineHeight: "1.45" }],
      },
      spacing: {
        row: "36px",
        control: "32px",
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(39,39,42,0.9)",
      },
    },
  },
  plugins: [],
};
