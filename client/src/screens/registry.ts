import type { ScreenDef } from './types';
import { setScreenMetaResolver } from '@/store/screenMeta';

export type { ScreenDef, ScreenProps, ScreenParams } from './types';

const modules = import.meta.glob<{ default: ScreenDef[] | ScreenDef }>('./**/*.screen.tsx', { eager: true });

const registry = new Map<string, ScreenDef>();
for (const [path, mod] of Object.entries(modules)) {
  const defs = Array.isArray(mod.default) ? mod.default : mod.default ? [mod.default] : [];
  if (!defs.length) console.warn(`[registry] ${path} has no default export of ScreenDef[]`);
  for (const d of defs) {
    if (registry.has(d.id)) console.warn(`[registry] duplicate screen id "${d.id}" in ${path}`);
    registry.set(d.id, d);
  }
}

export const getScreen = (id: string): ScreenDef | undefined => registry.get(id);
export const allScreens = (): ScreenDef[] => [...registry.values()];
export { isMultiInstance } from '@/store/screenMeta';

setScreenMetaResolver((id) => registry.get(id));
