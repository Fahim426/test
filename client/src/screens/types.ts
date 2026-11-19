import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Params passed when opening a tab. Document screens receive `{ id }` (undefined when creating a new doc). */
export type ScreenParams = { id?: number | string; [key: string]: unknown };

export interface ScreenProps {
  params: ScreenParams;
  /** Unique id of the workspace tab hosting this screen instance. */
  tabId: string;
  /** Stable key of the instance (e.g. `purchase-order-form:12`). */
  instanceKey: string;
}

export interface ScreenDef {
  /** e.g. 'purchase-orders' (list) or 'purchase-order-form' (document) */
  id: string;
  title: string;
  icon?: LucideIcon;
  component: ComponentType<ScreenProps>;
  /** Allow several tabs of this screen (documents). Defaults to true for ids ending in '-form'. */
  multiInstance?: boolean;
  /** Permission module key (e.g. 'purchase_order') -> requires `<key>:view`; or full 'module:action'. */
  permission?: string;
}
