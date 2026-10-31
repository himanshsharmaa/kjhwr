/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          900: "#0f172a",
          950: "#020617",
        },
        uk: {
          blue: "#003399",
          red: "#ce2b37",
          gold: "#c7a34b",
        },
      },
    },
  },
  plugins: [],
}
