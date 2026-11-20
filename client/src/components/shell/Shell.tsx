import { TreeNavigation } from './TreeNavigation';
import { TourBootstrap } from './TourBootstrap';
import { useUi } from '@/store/ui';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, AuthUser } from '@/store/auth';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/store/workspace';
import { TitleBar } from './TitleBar';
import { Ribbon } from './Ribbon';
import { TabBar } from './TabBar';
import { Breadcrumb, Workspace } from './Workspace';
import { StatusBar } from './StatusBar';

export default function Shell() {
  const treeMenu = useUi(s=>s.treeMenu);
  const token = useAuth((s) => s.accessToken);
  const nav = useNavigate();

  // refresh the profile/permissions on load
  useEffect(() => {
    api.get<AuthUser>('/auth/me').then((r) => useAuth.setState({ user: r.data })).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!token) nav('/login', { replace: true });
  }, [token, nav]);

  // first run: open the dashboard
  useEffect(() => {
    const s = useWorkspaceStore.getState();
    if (s.tabs.length === 0) s.open({ screenId: 'dashboard' });
  }, []);

  // global shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ws = useWorkspaceStore.getState();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k' && window.innerWidth < 640) {e.preventDefault();useUi.getState().setPaletteOpen(true);requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[data-tour="mobile-search"] input')?.focus());}
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 't') {
        e.preventDefault();
        ws.reopenLast();
      } else if (((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'w') || (e.altKey && k === 'w')) {
        e.preventDefault();
        const t = ws.tabs.find((x) => x.id === ws.activeId);
        if (t && !t.pinned) ws.close(t.id);
      } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const i = ws.tabs.findIndex((x) => x.id === ws.activeId);
        const n = ws.tabs[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (n) ws.activate(n.id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TitleBar />
      {!treeMenu && <div data-tour="ribbon"><Ribbon /></div>}
      <div className="flex min-h-0 flex-1"><TreeNavigation /><div className="flex min-w-0 flex-1 flex-col">
      <div data-tour="tabs" className="shrink-0"><TabBar /></div>
      <Breadcrumb />
      <Workspace />
      </div></div>
      <TourBootstrap />
      <StatusBar />
    </div>
  );
}
