import { ReactNode, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Lightweight popover menu. `trigger` receives `{ open, toggle }`; `children` receives `close`. */
export function Menu({
  trigger, children, align = 'right', width = 220, className, panelClassName, up,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  width?: number | string;
  className?: string;
  panelClassName?: string;
  /** open upwards */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          style={{ width }}
          className={cn(
            'absolute z-[130] max-w-[92vw] animate-pop-in rounded-xl border border-line bg-surface p-1 text-left shadow-pop',
            up ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon: Icon, children, onClick, danger, disabled, active, hint,
}: { icon?: LucideIcon; children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean; active?: boolean; hint?: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn('menu-item', danger && 'text-danger hover:bg-danger-soft', active && 'bg-brand-soft text-brand-ink')}
    >
      {Icon && <Icon size={15} className={cn('shrink-0', danger ? '' : 'text-ink-faint')} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </button>
  );
}
export const MenuSep = () => <div className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{children}</div>
);
