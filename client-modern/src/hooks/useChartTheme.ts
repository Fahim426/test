import { useUi } from '@/store/ui';

/** Hex colours for Recharts (SVG attributes cannot use CSS variables). Re-renders when the theme changes. */
export function useChartTheme() {
  useUi((s) => s.theme);
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return {
    dark,
    brand: dark ? '#818cf8' : '#4f46e5',
    accent: dark ? '#a78bfa' : '#8b5cf6',
    teal: dark ? '#2dd4bf' : '#0d9488',
    amber: dark ? '#fbbf24' : '#d97706',
    sky: dark ? '#38bdf8' : '#0ea5e9',
    grid: dark ? '#2a2d3e' : '#eceef4',
    axis: dark ? '#70768e' : '#8b91a7',
    tipBg: dark ? '#1c1e2b' : '#ffffff',
    tipBorder: dark ? '#3e4258' : '#e4e7ee',
    tipText: dark ? '#ecedf7' : '#181828',
  };
}
