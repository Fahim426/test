import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface UiState {
  activeModule: string;
  ribbonCollapsed: boolean;
  setModule: (m: string) => void;
  toggleRibbon: () => void;
  // --- modern shell ---
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  /** module id -> expanded (accordion) */
  openModules: Record<string, boolean>;
  toggleModuleOpen: (id: string) => void;
  setModuleOpen: (id: string, open: boolean) => void;
  density: 'comfortable' | 'compact';
  setDensity: (d: 'comfortable' | 'compact') => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      activeModule: 'home',
      ribbonCollapsed: false,
      setModule: (activeModule) => set({ activeModule }),
      toggleRibbon: () => set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed })),
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      openModules: { home: true },
      toggleModuleOpen: (id) => set((s) => ({ openModules: { ...s.openModules, [id]: !s.openModules[id] } })),
      setModuleOpen: (id, open) => set((s) => ({ openModules: { ...s.openModules, [id]: open } })),
      density: 'comfortable',
      setDensity: (density) => set({ density }),
      paletteOpen: false,
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
    }),
    {
      name: 'ss-ui',
      partialize: (s) => ({
        activeModule: s.activeModule,
        ribbonCollapsed: s.ribbonCollapsed,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        openModules: s.openModules,
        density: s.density,
      }),
    },
  ),
);

/** Apply the theme class to <html>. Call once at startup (main.tsx) and it keeps itself in sync. */
export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.dataset.theme = dark ? 'dark' : 'light';
}

export function initTheme() {
  applyTheme(useUi.getState().theme);
  useUi.subscribe((s, p) => {
    if (s.theme !== p.theme) applyTheme(s.theme);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useUi.getState().theme === 'system') applyTheme('system');
  });
}
