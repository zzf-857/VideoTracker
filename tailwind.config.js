/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#0071E3", // Apple Blue
        "on-primary": "#FFFFFF",
        background: "#F5F5F7",
        surface: "#FFFFFF",
        "on-surface": "#1D1D1F",
        "on-surface-variant": "#86868B",
        outline: "#D2D2D7",
        secondary: "#6E6E73",
        tertiary: "#515154"
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        headline: ["Outfit", "sans-serif"],
      }
    },
  },
  plugins: [],
}
