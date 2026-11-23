import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email?: string | null;
  role: string;
  branchId?: number | null;
  businessUnitId?: number | null;
  businessUnit?: { id: number; code: string; name: string } | null;
  permissions: string[]; // "module:action" ; ['*'] = everything
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  setTokens: (a: string, r: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: (callServer?: boolean) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      login: async (username, password) => {
        const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>('/api/auth/login', { username, password });
        set({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken, user: res.data.user });
      },
      logout: (callServer = true) => {
        const rt = get().refreshToken;
        if (callServer && rt) axios.post('/api/auth/logout', { refreshToken: rt }).catch(() => undefined);
        set({ accessToken: null, refreshToken: null, user: null });
      },
    }),
    { name: 'ss-auth', partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }) },
  ),
);

export const hasPermission = (perms: string[] | undefined, module: string, action = 'view') =>
  !!perms && (perms.includes('*') || perms.includes(`${module}:${action}`));

/** `const can = usePermission(); can('purchase_order', 'create')` */
export function usePermission() {
  const perms = useAuth((s) => s.user?.permissions);
  return (module: string, action = 'view') => hasPermission(perms, module, action);
}
