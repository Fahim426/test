import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  activeModule: string;
  ribbonCollapsed: boolean;
  setModule: (m: string) => void;
  toggleRibbon: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      activeModule: 'home',
      ribbonCollapsed: false,
      setModule: (activeModule) => set({ activeModule }),
      toggleRibbon: () => set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed })),
    }),
    { name: 'ss-ui' },
  ),
);
