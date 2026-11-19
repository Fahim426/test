import { ReactNode, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Modal({
  open, title, onClose, children, footer, width = 'md', closeOnBackdrop = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'w-[420px]', md: 'w-[600px]', lg: 'w-[840px]', xl: 'w-[1100px]', full: 'w-[96vw]' }[width];
  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div className={cn('flex max-h-[90vh] max-w-full animate-pop-in flex-col rounded-2xl border border-line bg-surface shadow-pop', w)} role="dialog" aria-modal="true">
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
          <span className="text-base font-semibold text-ink">{title}</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-3 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, title = 'Confirm', message, confirmLabel = 'Confirm', danger, loading, onConfirm, onCancel,
}: {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-3">
          {danger && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle size={18} />
            </span>
          )}
          {title}
        </span>
      }
      onClose={onCancel}
      width="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-5 text-ink-muted">{message}</div>
    </Modal>
  );
}
