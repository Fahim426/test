import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
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
  const w = { sm: 'w-[380px]', md: 'w-[560px]', lg: 'w-[800px]', xl: 'w-[1080px]', full: 'w-[96vw]' }[width];
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[6vh]"
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div className={cn('flex max-h-[88vh] max-w-[96vw] flex-col rounded border border-slate-400 bg-white shadow-lg', w)} role="dialog">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-app-border bg-app-head px-3">
          <span className="text-[12px] font-semibold text-slate-700">{title}</span>
          <button onClick={onClose} className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-app-border bg-app-head px-3 py-2">{footer}</div>}
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
      title={title}
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
      <div className="text-[12px] text-slate-700">{message}</div>
    </Modal>
  );
}
