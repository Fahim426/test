import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Business Unit selector (Admin only). `null` = All BUs (consolidated). Sent to the server as `X-BU` on every request,
 * so every list and report narrows to that BU; documents created while one is selected get that BU.
 * Non-admin users have exactly one BU on their login and cannot change it.
 */
interface BuState {
  selectedBuId: number | null;
  setSelectedBuId: (id: number | null) => void;
}
export const useBuStore = create<BuState>()(
  persist(
    (set) => ({ selectedBuId: null, setSelectedBuId: (selectedBuId) => set({ selectedBuId }) }),
    { name: 'ss-bu' },
  ),
);

/**
 * Admin with "All BUs" creating a document: the Business Unit picked on that document's header, per open tab.
 * Only sent (as X-BU) with the save requests of the active tab, then dropped once the document has a number.
 */
interface DocBuState {
  byTab: Record<string, number>;
  setDocBu: (tabId: string, id: number | null) => void;
}
export const useDocBuStore = create<DocBuState>()((set) => ({
  byTab: {},
  setDocBu: (tabId, id) =>
    set((s) => {
      const byTab = { ...s.byTab };
      if (id) byTab[tabId] = id;
      else delete byTab[tabId];
      return { byTab };
    }),
}));
