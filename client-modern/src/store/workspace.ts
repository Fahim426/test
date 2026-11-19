import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getScreenMeta, isMultiInstance } from './screenMeta';
import type { ScreenParams } from '@/screens/types';

export interface Tab {
  id: string;
  screenId: string;
  title: string;
  params: ScreenParams;
  instanceKey: string;
  pinned: boolean;
  /** bump to remount the screen (Refresh) */
  refreshKey: number;
  dirty?: boolean;
}

export interface OpenArgs {
  screenId: string;
  title?: string;
  params?: ScreenParams;
  /** Override the identity of the tab. Default: list screens = screenId; document screens = `${screenId}:${params.id}` or a fresh key. */
  instanceKey?: string;
  /** open without activating */
  background?: boolean;
}

interface WorkspaceState {
  tabs: Tab[];
  activeId: string | null;
  closed: Omit<Tab, 'id'>[];
  open: (a: OpenArgs) => string;
  activate: (id: string) => void;
  close: (id: string, force?: boolean) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  reopenLast: () => void;
  togglePin: (id: string) => void;
  refresh: (id: string) => void;
  duplicate: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
  /** After creating a new document: rebind the tab to the saved record (instanceKey, params.id, title). */
  retarget: (id: string, p: { id: number | string; title?: string }) => void;
  move: (from: number, to: number) => void;
}

let counter = Date.now() % 100000;
const uid = () => `t${(counter++).toString(36)}`;
const MAX_CLOSED = 20;

const keyFor = (screenId: string, params: ScreenParams | undefined, explicit?: string): string => {
  if (explicit) return explicit;
  if (!isMultiInstance(screenId)) return screenId;
  if (params?.id !== undefined && params.id !== null && params.id !== '') return `${screenId}:${params.id}`;
  return `${screenId}:new:${uid()}`;
};

const defaultTitle = (screenId: string) => getScreenMeta(screenId)?.title ?? screenId;

const sortPinned = (tabs: Tab[]): Tab[] => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      closed: [],

      open: ({ screenId, title, params = {}, instanceKey, background }) => {
        const key = keyFor(screenId, params, instanceKey);
        const existing = get().tabs.find((t) => t.instanceKey === key);
        if (existing) {
          if (!background) set({ activeId: existing.id });
          return existing.id;
        }
        const tab: Tab = {
          id: uid(),
          screenId,
          title: title ?? defaultTitle(screenId),
          params,
          instanceKey: key,
          pinned: false,
          refreshKey: 0,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeId: background ? s.activeId : tab.id }));
        return tab.id;
      },

      activate: (id) => set({ activeId: id }),

      close: (id, force = false) => {
        const { tabs, activeId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const tab = tabs[idx];
        if (tab.dirty && !force && !window.confirm(`"${tab.title}" has unsaved changes. Close anyway?`)) return;
        const rest = tabs.filter((t) => t.id !== id);
        const { id: _drop, ...snap } = tab;
        void _drop;
        set({
          tabs: rest,
          activeId: activeId === id ? (rest[idx] ?? rest[idx - 1] ?? null)?.id ?? null : activeId,
          closed: [{ ...snap, dirty: false }, ...get().closed].slice(0, MAX_CLOSED),
        });
      },

      closeOthers: (id) => {
        const { tabs } = get();
        const keep = tabs.filter((t) => t.id === id || t.pinned);
        const gone = tabs.filter((t) => !keep.includes(t)).map(({ id: _i, dirty: _d, ...s }) => ({ ...s, dirty: false }));
        set({ tabs: keep, activeId: id, closed: [...gone, ...get().closed].slice(0, MAX_CLOSED) });
      },

      closeAll: () => {
        const { tabs } = get();
        const keep = tabs.filter((t) => t.pinned);
        const gone = tabs.filter((t) => !t.pinned).map(({ id: _i, dirty: _d, ...s }) => ({ ...s, dirty: false }));
        set({ tabs: keep, activeId: keep[0]?.id ?? null, closed: [...gone, ...get().closed].slice(0, MAX_CLOSED) });
      },

      reopenLast: () => {
        const [last, ...rest] = get().closed;
        if (!last) return;
        set({ closed: rest });
        get().open({ screenId: last.screenId, title: last.title, params: last.params, instanceKey: last.instanceKey });
      },

      togglePin: (id) => set((s) => ({ tabs: sortPinned(s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))) })),
      refresh: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, refreshKey: t.refreshKey + 1 } : t)) })),

      duplicate: (id) => {
        const t = get().tabs.find((x) => x.id === id);
        if (!t) return;
        const isDoc = isMultiInstance(t.screenId);
        const params: ScreenParams = isDoc ? { ...t.params, id: undefined, copyFrom: t.params.id } : { ...t.params };
        get().open({ screenId: t.screenId, title: t.title, params, instanceKey: `${t.screenId}:dup:${uid()}` });
      },

      setTitle: (id, title) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
      setDirty: (id, dirty) => {
        const t = get().tabs.find((x) => x.id === id);
        if (!t || !!t.dirty === dirty) return;
        set((s) => ({ tabs: s.tabs.map((x) => (x.id === id ? { ...x, dirty } : x)) }));
      },
      retarget: (id, p) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, instanceKey: `${t.screenId}:${p.id}`, params: { ...t.params, id: p.id, copyFrom: undefined }, title: p.title ?? t.title, dirty: false } : t,
          ),
        })),
      move: (from, to) =>
        set((s) => {
          const a = [...s.tabs];
          const [m] = a.splice(from, 1);
          a.splice(to, 0, m);
          return { tabs: sortPinned(a) };
        }),
    }),
    {
      name: 'ss-workspace',
      version: 1,
      partialize: (s) => ({ tabs: s.tabs.map((t) => ({ ...t, dirty: false })), activeId: s.activeId, closed: s.closed }),
    },
  ),
);

/** Public API for screens: `const ws = useWorkspace(); ws.open({ screenId: 'purchase-order-form', params: { id: 12 }, title: 'PO-2026-00012' })` */
export function useWorkspace() {
  const s = useWorkspaceStore();
  return {
    tabs: s.tabs,
    activeId: s.activeId,
    open: s.open,
    close: s.close,
    closeOthers: s.closeOthers,
    closeAll: s.closeAll,
    reopenLast: s.reopenLast,
    pin: s.togglePin,
    refresh: s.refresh,
    duplicate: s.duplicate,
    setTitle: s.setTitle,
    setDirty: s.setDirty,
    retarget: s.retarget,
  };
}

/** Convenience: `const openScreen = useOpenScreen(); openScreen('purchase-order-form', { id: 12 }, 'PO-2026-00012')` */
export function useOpenScreen() {
  const open = useWorkspaceStore((s) => s.open);
  return (screenId: string, params?: ScreenParams, title?: string) => open({ screenId, params, title });
}

/** Imperative open for non-component code */
export const openScreen = (screenId: string, params?: ScreenParams, title?: string) =>
  useWorkspaceStore.getState().open({ screenId, params, title });
