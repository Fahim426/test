import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';

interface PendingRow {
  stage: string;
  stageLabel: string;
  sourceType: string;
  sourceLabel: string;
  sourceId: number;
  sourceNo: string;
  sourceDate: string | null;
  sourceStatus: string | null;
  party: string | null;
  targetLabel: string;
  targets: string;
  itemKey: string;
  code: string | null;
  name: string | null;
  sourceQty: number;
  processedQty: number;
  closedQty: number;
  pendingQty: number;
}
interface StageDef { key: string; source: string; target: string; label: string }

const SALES = ['SALES_ENQUIRY', 'SALES_QUOTATION', 'PROFORMA_INVOICE', 'SALES_ORDER', 'DELIVERY_NOTE'];
const IMPORT = ['IMPORT_REQUEST', 'SUPPLIER_PROFORMA', 'IMPORT_SHIPMENT'];
const areaOf = (s: StageDef) => (SALES.includes(s.source) ? 'SALES' : IMPORT.includes(s.source) || s.key === 'PO_SH' ? 'IMPORT' : 'PURCHASE');
const nice = (t: string) => t.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Pending Items: every line of a document that was not carried into the next document of its chain
 * (Quotation -> Order, Order -> Delivery, PO -> GRN, ...). One stage is loaded at a time; paging/sorting is local.
 */
function PendingItemsScreen() {
  const open = useOpenScreen();
  const [area, setArea] = useState('SALES');
  const [stage, setStage] = useState('');
  const stagesQ = useQuery({ queryKey: ['pending-stages'], staleTime: 300_000, queryFn: async () => (await api.get<{ cutoffDate: string; stages: StageDef[] }>('/pending/stages')).data });
  const stages = useMemo(() => (stagesQ.data?.stages ?? []).filter((s) => areaOf(s) === area), [stagesQ.data, area]);
  const stageKeys = stage || stages.map((s) => s.key).join(',');

  const columns: Column<PendingRow>[] = [
    { key: 'sourceNo', header: 'Document', width: 130 },
    { key: 'sourceLabel', header: 'Type', width: 130 },
    { key: 'sourceDate', header: 'Date', type: 'date', width: 95 },
    { key: 'party', header: 'Customer / Supplier' },
    { key: 'stageLabel', header: 'Pending', width: 150 },
    { key: 'code', header: 'Item Code', width: 130 },
    { key: 'name', header: 'Description' },
    { key: 'sourceQty', header: 'Qty', type: 'qty', width: 75 },
    { key: 'processedQty', header: 'Carried', type: 'qty', width: 75 },
    { key: 'closedQty', header: 'Closed', type: 'qty', width: 70, hidden: true },
    { key: 'pendingQty', header: 'Pending Qty', type: 'qty', width: 90, total: 'sum' },
    { key: 'targets', header: 'Taken into', width: 160 },
    { key: 'sourceStatus', header: 'Status', type: 'status', width: 140 },
  ];
  const openSource = (r: PendingRow) => {
    const screenId = formScreenOf(r.sourceType);
    if (screenId) open(screenId, { id: r.sourceId }, r.sourceNo);
  };

  return (
    <DataTable<PendingRow>
      tableKey="pending-items"
      queryKey={`pending-items:${stageKeys}`}
      columns={columns}
      exportName="Pending Items"
      getRowId={(r) => `${r.stage}:${r.sourceId}:${r.itemKey}`}
      defaultSort={{ key: 'sourceDate', dir: 'desc' }}
      searchPlaceholder="Search document, item, customer / supplier..."
      fetcher={async (p) => {
        if (!stageKeys) return { rows: [], total: 0, page: 1, pageSize: Number(p.pageSize) || 50 };
        const all = (await api.get<{ rows: PendingRow[] }>('/pending/report', { params: { stages: stageKeys, q: p.search || undefined } })).data.rows;
        const sort = p.sort as keyof PendingRow | undefined;
        if (sort) {
          const dir = p.dir === 'asc' ? 1 : -1;
          all.sort((a, b) => {
            const x = a[sort] ?? '';
            const y = b[sort] ?? '';
            return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
          });
        }
        const page = Number(p.page) || 1;
        const size = Number(p.pageSize) || 50;
        return { rows: all.slice((page - 1) * size, page * size), total: all.length, page, pageSize: size };
      }}
      onRowDoubleClick={openSource}
      rowActions={[{ label: 'Open document', onClick: openSource }]}
      toolbarExtras={
        <>
          <Select className="w-36" value={area} onChange={(e) => { setArea(e.target.value); setStage(''); }} options={[{ value: 'SALES', label: 'Sales' }, { value: 'PURCHASE', label: 'Purchase' }, { value: 'IMPORT', label: 'Import' }]} />
          <Select
            className="w-64"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            options={[{ value: '', label: 'All stages' }, ...stages.map((s) => ({ value: s.key, label: `${nice(s.source)}: ${s.label.toLowerCase()}` }))]}
          />
          {stagesQ.data?.cutoffDate && <span className="whitespace-nowrap text-xs text-ink-faint">Documents from {stagesQ.data.cutoffDate}</span>}
        </>
      }
    />
  );
}

export default [{ id: 'pending-items', title: 'Pending Items', icon: Hourglass, component: PendingItemsScreen }] satisfies ScreenDef[];
