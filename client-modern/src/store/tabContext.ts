import { createContext } from 'react';

/** id of the workspace tab a screen is rendered in (document headers keep per-tab state, e.g. the BU of a new document) */
export const TabIdContext = createContext<string | null>(null);
