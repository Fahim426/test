// Breaks the registry <-> workspace-store import cycle: the registry registers a resolver here at load time.
export interface ScreenMeta {
  multiInstance?: boolean;
  title?: string;
}
let resolver: ((id: string) => ScreenMeta | undefined) | null = null;
export const setScreenMetaResolver = (fn: (id: string) => ScreenMeta | undefined) => {
  resolver = fn;
};
export const getScreenMeta = (id: string): ScreenMeta | undefined => resolver?.(id);
export const isMultiInstance = (id: string): boolean => getScreenMeta(id)?.multiInstance ?? id.endsWith('-form');
