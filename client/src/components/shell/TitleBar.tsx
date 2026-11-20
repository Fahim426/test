import { startClientDemo } from '@/lib/clientDemo';
import { QuickCreate } from './QuickCreate';
import { Search } from 'lucide-react';
import { useUi } from '@/store/ui';
import { TreeControls } from './TreeNavigation';
import { startTour, startSalesFlowTour } from '@/lib/tour';
import { CompanyLogo } from '@/components/CompanyLogo';
import { ReminderBell } from './ReminderBell';
import { DemoBadge } from './DemoBadge';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogOut, UserCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { useCompany } from '@/hooks/useCompany';
import { GlobalSearch } from './GlobalSearch';
import { ChangePasswordModal } from './ChangePassword';

export function TitleBar() {
  const {paletteOpen,setPaletteOpen}=useUi();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const company = useCompany();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="no-print relative z-40 flex h-9 shrink-0 items-center gap-4 bg-brand px-3 text-white">
      <div className="flex min-w-0 items-center gap-2">
        <CompanyLogo className="h-7 w-[76px]" />
        <span className="hidden sm:block truncate text-[13px] font-semibold tracking-wide">{company.data?.name ?? 'Business ERP'}</span>
        <DemoBadge />
      </div>
      <div className="hidden sm:flex flex-1 justify-center">
        <div data-tour="search" className="w-full"><GlobalSearch /></div>
      </div>
      <button type="button" data-tour="search-icon" aria-label="Search" className="sm:hidden" onClick={()=>setPaletteOpen(!paletteOpen)}><Search size={17}/></button><QuickCreate /><TreeControls /><ReminderBell />
      {paletteOpen&&<div data-tour="mobile-search" className="fixed left-2 right-2 top-10 rounded border bg-white p-3 text-gray-900 sm:hidden"><GlobalSearch /><button onClick={()=>setPaletteOpen(false)}>Close search</button></div>}
      <div ref={ref} className="relative ml-auto shrink-0 text-right">
        <button data-tour="user" aria-label="Profile menu" onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] hover:bg-brand-dark">
          <UserCircle2 size={16} />
          <span className="hidden sm:block text-left leading-3">
            <span className="block">{user?.fullName ?? user?.username}</span>
            <span className="block text-[10px] opacity-75">{user?.role}</span>
          </span>
          <ChevronDown size={12} />
        </button>
        {menu && (
          <div className="absolute right-0 top-9 w-[180px] border border-slate-400 bg-white py-0.5 text-left text-[12px] text-slate-800 shadow-lg">
            <button onClick={()=>{setMenu(false);startTour();}} className="block w-full px-3 py-2 text-left">Take the product tour</button>
            <button onClick={()=>{setMenu(false);void startClientDemo();}} className="block w-full px-3 py-2 text-left">Client Demo</button>
            <button onClick={()=>{setMenu(false);startSalesFlowTour();}} className="block w-full px-3 py-2 text-left">Sales flow walkthrough</button>
            <a className="block px-3 py-2" href={import.meta.env.VITE_MODERN_URL||'http://localhost:5174'}>Switch to Modern UI</a>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-brand-light"
              onClick={() => {
                setMenu(false);
                setPw(true);
              }}
            >
              <KeyRound size={13} /> Change password
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-brand-light"
              onClick={() => {
                logout();
                nav('/login', { replace: true });
              }}
            >
              <LogOut size={13} /> Log out
            </button>
          </div>
        )}
      </div>
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
