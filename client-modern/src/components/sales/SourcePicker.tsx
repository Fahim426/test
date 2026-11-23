/* Modal that lists eligible source documents and lets the user pick one (used by the "New" button of derived documents). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, LoadingBlock, StatusBadge, Tabs } from '@/components/ui';
import { api, apiError, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { AnyRec } from './shared';

export interface SourceCol {
  header: string;
  render: (r: AnyRec) => ReactNode;
  right?: boolean;
}
export interface SourceTab {
  key: string;
  label: string;
  url: string;
  params?: Record<string, unknown>;
  /** filter rows client side (e.g. pending quantities) */
  filter?: (r: AnyRec) => boolean;
  columns: SourceCol[];
  actionLabel: string;
  onPick: (row: AnyRec) => Promise<void> | void;
  empty?: string;
}

function SourceList({ tab, onDone }: { tab: SourceTab; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [dq, setDq] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = useQuery({
    queryKey: ['source-picker', tab.url, JSON.stringify(tab.params), dq],
    queryFn: async () => {
      const d = (await api.get<Paged<AnyRec> | AnyRec[]>(tab.url, { params: { pageSize: 100, search: dq || undefined, ...(tab.params ?? {}) } })).data;
      return Array.isArray(d) ? d : d.rows;
    },
  });
  const rows = (q.data ?? []).filter((r) => (tab.filter ? tab.filter(r) : true)).filter((r) => !dq || !Array.isArray(q.data) || JSON.stringify(r).toLowerCase().includes(dq.toLowerCase()));
  return (
    <div className="space-y-2">
      <Input placeholder="Search by number or customer..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      {err && <div className="border border-danger bg-danger-soft px-3 py-2 text-[13px] text-danger rounded-lg">{err}</div>}
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <div className="text-[13px] text-danger">{apiError(q.error)}</div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-line p-4 text-center text-[13px] text-ink-muted">{tab.empty ?? 'No eligible documents found.'}</div>
      ) : (
        <div className="max-h-[50vh] overflow-auto border border-line">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0">
              <tr className="h-9">
                {tab.columns.map((c) => <th key={c.header} className={`grid-th ${c.right ? '!text-right' : ''}`}>{c.header}</th>)}
                <th className="grid-th w-[110px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-9 odd:bg-surface even:bg-surface-2 hover:bg-brand-soft">
                  {tab.columns.map((c) => <td key={c.header} className={`grid-td ${c.right ? 'text-right tabular-nums' : ''}`}>{c.render(r)}</td>)}
                  <td className="grid-td text-right">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy === r.id}
                      onClick={async () => {
                        setBusy(r.id);
                        setErr('');
                        try {
                          await tab.onPick(r);
                          onDone();
                        } catch (e) {
                          setErr(apiError(e));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {tab.actionLabel}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SourcePicker({ open, title, hint, tabs, onClose, footerExtra }: { open: boolean; title: string; hint?: ReactNode; tabs: SourceTab[]; onClose: () => void; footerExtra?: ReactNode }) {
  return (
    <Modal open={open} title={title} onClose={onClose} width="xl" footer={<>{footerExtra}<Button onClick={onClose}>Close</Button></>}>
      {hint && <div className="mb-2 text-[13px] text-ink-muted">{hint}</div>}
      {tabs.length === 1 ? (
        <SourceList tab={tabs[0]} onDone={onClose} />
      ) : (
        <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, content: <SourceList tab={t} onDone={onClose} /> }))} />
      )}
    </Modal>
  );
}

export const colDoc = (h: string, k: string): SourceCol => ({ header: h, render: (r) => <b>{r[k]}</b> });
export const colDate = (h = 'Date', k = 'docDate'): SourceCol => ({ header: h, render: (r) => fmt.date(r[k]) });
export const colCustomer: SourceCol = { header: 'Customer', render: (r) => r.customer?.name ?? '' };
export const colStatus: SourceCol = { header: 'Status', render: (r) => <StatusBadge status={r.status} /> };
export const colMoney = (h: string, k: string): SourceCol => ({ header: h, right: true, render: (r) => fmt.money(r[k]) });
export const colQty = (h: string, k: string): SourceCol => ({ header: h, right: true, render: (r) => fmt.qty(r[k]) });
