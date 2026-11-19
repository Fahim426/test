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
      <div className="flex min-w-[200px] items-center gap-2">
        <img src="/brand/fortune7-logo.jpeg" alt="Fortune 7" className="h-7 w-[76px] shrink-0 rounded-sm bg-white object-contain" />
        <span className="truncate text-[13px] font-semibold tracking-wide">{company.data?.name ?? 'Fortune 7 ERP'}</span>
        <DemoBadge />
      </div>
      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>
      <ReminderBell />
      <div ref={ref} className="relative min-w-[200px] text-right">
        <button onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] hover:bg-brand-dark">
          <UserCircle2 size={16} />
          <span className="text-left leading-3">
            <span className="block">{user?.fullName ?? user?.username}</span>
            <span className="block text-[10px] opacity-75">{user?.role}</span>
          </span>
          <ChevronDown size={12} />
        </button>
        {menu && (
          <div className="absolute right-0 top-9 w-[180px] border border-slate-400 bg-white py-0.5 text-left text-[12px] text-slate-800 shadow-lg">
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
