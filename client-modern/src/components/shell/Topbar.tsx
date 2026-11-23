import { startClientDemo } from '@/lib/clientDemo';
import { ReminderBell } from './ReminderBell';
import { DemoBadge } from './DemoBadge';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, KeyRound, LogOut, Monitor, Moon, Plus, Sun, Search, PanelLeft, HelpCircle, Route, ShoppingCart, Menu as MenuIcon } from 'lucide-react';
import { useAuth, usePermission } from '@/store/auth';
import { ThemeMode, useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { api } from '@/lib/api';
import { Menu, MenuItem, MenuLabel, MenuSep } from '@/components/ui';
import { cn } from '@/lib/cn';
import { GlobalSearch } from './GlobalSearch';
import { BuSwitcher } from './BuSwitcher';
import { ChangePasswordModal } from './ChangePassword';
import { Logo } from './Sidebar';
import { ModuleTabs } from './TopMenu';
import { useCompany } from '@/hooks/useCompany';
import { QUICK_GROUPS } from './nav';
import { startTour, startSalesFlowTour, startPurchaseFlowTour } from '@/lib/tour';


const initials = (n?: string) =>
  (n ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Avatar({ name, size = 32, className }: { name?: string; size?: number; className?: string }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 font-semibold text-white', className)}
    >
      {initials(name)}
    </span>
  );
}

const themes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

function TreeMenuToggle() {
  const on = useUi((s) => s.treeMenu);
  const toggle = useUi((s) => s.toggleTreeMenu);
  return (
    <button
      data-tour="tree-toggle"
      onClick={toggle}
      title={on ? 'Hide tree menu panel' : 'Show tree menu panel'}
      aria-pressed={on}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-surface-3 ${on ? 'bg-brand-soft text-brand' : 'text-ink-muted'}`}
    >
      <PanelLeft size={17} />
    </button>
  );
}

export function ThemeMenu() {
  const { theme, setTheme } = useUi();
  const Cur = themes.find((t) => t.id === theme)!.icon;
  return (
    <Menu
      width={160}
      trigger={({ toggle }) => (
        <button onClick={toggle} title="Theme" aria-label="Theme" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-3 hover:text-ink">
          <Cur size={17} />
        </button>
      )}
    >
      {(close) =>
        themes.map((t) => (
          <MenuItem
            key={t.id}
            icon={t.icon}
            active={theme === t.id}
            onClick={() => {
              setTheme(t.id);
              close();
            }}
          >
            {t.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

function NewMenu() {
  const open = useWorkspaceStore((s) => s.open);
  const can = usePermission();
  return (
    <Menu
      width={260}
      panelClassName="max-h-[70vh] overflow-y-auto"
      trigger={({ toggle, open: o }) => (
        <button
          data-tour="new"
          onClick={toggle}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgb(var(--brand)/0.4),inset_0_1px_0_rgb(255_255_255/0.15)] transition hover:bg-brand-dark dark:text-[#0c0d14]',
            o && 'bg-brand-dark',
          )}
        >
          <Plus size={16} /> <span className="hidden sm:inline">New</span>
          <ChevronDown size={13} className="opacity-70" />
        </button>
      )}
    >
      {(close) =>
        QUICK_GROUPS.map((g) => {
          const items = g.items.filter((a) => can(a.perm, 'create'));
          if (!items.length) return null;
          return (
            <div key={g.name}>
              <MenuLabel>{g.name}</MenuLabel>
              {items.map((a) => (
                <MenuItem
                  key={a.form}
                  icon={Plus}
                  onClick={() => {
                    open({ screenId: a.form, title: a.label });
                    close();
                  }}
                >
                  {a.label}
                </MenuItem>
              ))}
            </div>
          );
        })
      }
    </Menu>
  );
}

function Approvals() {
  const open = useWorkspaceStore((s) => s.open);
  const q = useQuery({
    queryKey: ['pending-approvals-count'],
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => (await api.get<{ count: number }>('/pending-approvals-count')).data.count,
  });
  const n = q.data ?? 0;
  return (
    <button
      onClick={() => open({ screenId: 'pending-approvals', title: 'Pending Approvals' })}
      title={n ? `${n} pending approval${n > 1 ? 's' : ''}` : 'No pending approvals'}
      aria-label="Pending approvals"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-3 hover:text-ink"
    >
      <Bell size={17} />
      {n > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-surface">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </button>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const nav = useNavigate();
  const [pw, setPw] = useState(false);
  return (
    <>
      <Menu
        width={248}
        trigger={({ toggle }) => (
          <button data-tour="user" onClick={toggle} className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition hover:bg-surface-3">
            <Avatar name={user?.fullName ?? user?.username} />
            <span className="hidden text-left leading-tight xl:block">
              <span className="block max-w-[150px] truncate text-[13px] font-medium text-ink">{user?.fullName ?? user?.username}</span>
              <span className="block text-[11px] text-ink-faint">{user?.role}</span>
            </span>
            <ChevronDown size={13} className="hidden text-ink-faint xl:block" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="flex items-center gap-3 px-2.5 py-2">
              <Avatar name={user?.fullName ?? user?.username} size={36} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[13px] font-semibold text-ink">{user?.fullName ?? user?.username}</div>
                <div className="truncate text-xs text-ink-faint">{user?.role} · @{user?.username}</div>
              </div>
            </div>
            <MenuSep />
            <MenuItem onClick={() => { close(); void startClientDemo(); }}>Client Demo</MenuItem>
            <a href={import.meta.env.VITE_CLASSIC_URL || 'http://localhost:5173'} className="menu-item">Switch to Classic UI</a>
            <MenuItem icon={KeyRound} onClick={() => { close(); setPw(true); }}>Change password</MenuItem>
            <MenuItem icon={HelpCircle} onClick={() => { close(); setTimeout(startTour, 150); }}>Take the product tour</MenuItem>
            <MenuItem icon={Route} onClick={() => { close(); setTimeout(startSalesFlowTour, 150); }}>Tour: Sales flow (Enquiry → Receipt)</MenuItem>
            <MenuItem icon={ShoppingCart} onClick={() => { close(); setTimeout(startPurchaseFlowTour, 150); }}>Tour: Purchase flow (Request → Payment)</MenuItem>
            <MenuSep />
            <MenuItem
              icon={LogOut}
              danger
              onClick={() => {
                logout();
                nav('/login', { replace: true });
              }}
            >
              Log out
            </MenuItem>
          </>
        )}
      </Menu>
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </>
  );
}

export function Topbar() {
  const { setPaletteOpen } = useUi();
  const treeMenu = useUi((s) => s.treeMenu);
  const company = useCompany();
  return (
    <header className="no-print sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-md">
      <div className={`shrink-0 items-center gap-2.5 ${treeMenu ? 'flex md:hidden' : 'flex'}`}>
        <Logo size={32} />
        <div className="hidden leading-tight xl:block">
          <div className="max-w-[170px] truncate text-[14px] font-semibold text-ink">{company.data?.name ?? 'FlixERP'}</div>
          <div className="truncate text-[11px] text-ink-faint">{(company.data?.tagline as string | undefined) || 'ERP workspace'} <DemoBadge /></div>
        </div>
      </div>
      {!treeMenu && <span className="hidden h-6 w-px bg-line md:block" />}
      <div className="min-w-0 flex-1 overflow-hidden">
        {treeMenu ? (
          <div data-tour="search" className="hidden w-full lg:block">
            <GlobalSearch />
          </div>
        ) : (
          <ModuleTabs />
        )}
      </div>
      <div data-tour={treeMenu ? undefined : 'search'} className={treeMenu ? 'hidden' : 'hidden w-[300px] shrink-0 2xl:block'}>
        <GlobalSearch />
      </div>
      <button data-tour="search-icon" onClick={() => setPaletteOpen(true)} className={`flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 ${treeMenu ? 'lg:hidden' : '2xl:hidden'}`} aria-label="Search">
        <Search size={17} />
      </button>
      <button type="button" data-tour="tree-mobile-toggle" aria-label="Open navigation" onClick={() => useUi.getState().setMobileNavOpen(true)} className="rounded-lg p-2 md:hidden"><MenuIcon size={18} /></button>
      <BuSwitcher />
      <NewMenu />
      <div className="flex items-center gap-0.5">
        <ReminderBell />
        <Approvals />
        <TreeMenuToggle />
        <ThemeMenu />
      </div>
      <span className="hidden h-6 w-px bg-line sm:block" />
      <UserMenu />
    </header>
  );
}

export const CLASSIC_URL = import.meta.env.VITE_CLASSIC_URL || 'http://localhost:5173';
