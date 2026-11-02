/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // This tells Tailwind to scan all your React files for class names
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}