import { TourBootstrap } from './TourBootstrap';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, AuthUser } from '@/store/auth';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/store/workspace';
import { MenuStrip } from './TopMenu';
import { Topbar } from './Topbar';
import { TabBar } from './TabBar';
import { Workspace, Breadcrumb } from './Workspace';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { useUi } from '@/store/ui';

export default function Shell() {
  const token = useAuth((s) => s.accessToken);
  const nav = useNavigate();
  const treeMenu = useUi((s) => s.treeMenu);

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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 't') {
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
    <div data-tour="workspace-modern" className="flex h-full flex-col overflow-hidden bg-canvas">
      <Topbar />
      {!treeMenu && <MenuStrip />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {treeMenu && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <div className="no-print flex h-8 shrink-0 items-center border-b border-line bg-surface px-4">
            <Breadcrumb />
          </div>
          <Workspace />
        </div>
      </div>
      <TourBootstrap />
      <CommandPalette />
    </div>
  );
}
