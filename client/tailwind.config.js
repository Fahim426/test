/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1f5fae', dark: '#174a8a', light: '#e8f0fa', mid: '#c9dcf2' },
        app: { bg: '#f0f2f5', panel: '#ffffff', border: '#d0d5dd', head: '#f3f5f8' },
      },
      fontFamily: { sans: ['"Segoe UI"', 'Inter', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'] },
      borderRadius: { DEFAULT: '2px', sm: '2px', md: '3px', lg: '4px' },
      fontSize: { xs: ['11px', '15px'], sm: ['12px', '16px'], base: ['13px', '18px'] },
    },
  },
  plugins: [],
};
