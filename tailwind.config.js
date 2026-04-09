/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto-sans-jp)', 'Noto Sans JP', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#faf3ed',
          100: '#f5ebe0',
          200: '#d4c0a9',
          300: '#d4a574',
          400: '#c9956a',
          500: '#8b6f5e',  // Was #b39578 — darkened for WCAG AA contrast on #faf3ed (4.5:1+)
          600: '#7a5c4f',
          700: '#53352b',
          800: '#3e2723',
          900: '#2d1f1a',
        },
        sage: '#7eb88a',
        gold: '#d4a574',
      },
    },
  },
  plugins: [],
};
