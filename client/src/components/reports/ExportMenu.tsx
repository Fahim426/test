import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer, Table2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from '@/store/toast';
import { blobError, type ExportFmt } from './reportTypes';

/** Export dropdown (PDF / Excel / CSV) + Print. Handlers may throw; errors become toasts. */
export function ExportMenu({ onExport, onPrint, disabled }: {
  onExport: (f: ExportFmt) => Promise<void>;
  onPrint: () => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setOpen(false);
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(await blobError(e)); } finally { setBusy(false); }
  };
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-brand-light';
  return (
    <>
      <div className="relative">
        <Button size="sm" icon={Download} loading={busy} disabled={disabled} onClick={() => setOpen((o) => !o)}>Export</Button>
        {open && (
          <div className="absolute left-0 top-7 z-30 w-36 rounded border border-app-border bg-white py-1 shadow" onMouseLeave={() => setOpen(false)}>
            <button type="button" className={item} onClick={() => run(() => onExport('pdf'))}><FileText size={13} /> PDF</button>
            <button type="button" className={item} onClick={() => run(() => onExport('xlsx'))}><FileSpreadsheet size={13} /> Excel</button>
            <button type="button" className={item} onClick={() => run(() => onExport('csv'))}><Table2 size={13} /> CSV</button>
          </div>
        )}
      </div>
      <Button size="sm" icon={Printer} disabled={disabled || busy} onClick={() => run(onPrint)}>Print</Button>
    </>
  );
}
