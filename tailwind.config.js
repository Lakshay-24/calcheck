/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--color-brand-soft) / <alpha-value>)',
          300: 'rgb(var(--color-brand-mint) / <alpha-value>)',
          400: 'rgb(var(--color-brand-core) / <alpha-value>)',
          500: 'rgb(var(--color-brand-cyan) / <alpha-value>)',
          600: 'rgb(var(--color-brand-core) / <alpha-value>)',
          700: 'rgb(var(--color-brand-deep) / <alpha-value>)',
          900: 'rgb(var(--color-text) / <alpha-value>)',
        },
        primary: 'rgb(var(--color-brand-cyan) / <alpha-value>)',
        accent: 'rgb(var(--color-surface-muted) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        ink: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
      },
      boxShadow: {
        brand: 'var(--shadow-brand)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
