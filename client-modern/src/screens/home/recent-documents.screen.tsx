import { useState } from 'react';
import { History } from 'lucide-react';
import { api, Paged } from '@/lib/api';
import { DataTable, Column, TableParams } from '@/components/DataTable';
import { formScreenOf } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';
import type { ScreenDef } from '@/screens/types';

interface RecentDoc {
  type: string;
  typeLabel?: string;
  id: number;
  no?: string;
  date?: string;
  status?: string;
  party?: string | null;
  amount?: number | null;
  createdAt?: string;
}

const TYPES = [
  'PURCHASE_ORDER', 'GOODS_RECEIPT', 'SALES_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'SALES_QUOTATION', 'RECEIPT_VOUCHER', 'PAYMENT_VOUCHER',
];
const typeLabel = (t: string) => t.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function RecentDocumentsScreen() {
  const open = useOpenScreen();
  const [type, setType] = useState('');

  const fetcher = async (p: TableParams): Promise<Paged<RecentDoc>> => {
    const res = await api.get<RecentDoc[]>('/recent-documents', { params: { limit: 50 } });
    let rows = Array.isArray(res.data) ? res.data : [];
    if (p.type) rows = rows.filter((r) => r.type === p.type);
    if (p.search) {
      const s = String(p.search).toLowerCase();
      rows = rows.filter((r) => `${r.no ?? ''} ${r.party ?? ''} ${r.typeLabel ?? ''}`.toLowerCase().includes(s));
    }
    return { rows, total: rows.length, page: 1, pageSize: rows.length || 1 };
  };

  const openDoc = (r: RecentDoc) => open(formScreenOf(r.type), { id: r.id }, r.no);

  const columns: Column<RecentDoc>[] = [
    { key: 'typeLabel', header: 'Type', accessor: (r) => r.typeLabel ?? typeLabel(r.type), sortable: false },
    { key: 'no', header: 'Document No', sortable: false, cell: (r) => <button className="font-medium text-brand hover:underline" onClick={() => openDoc(r)}>{r.no}</button> },
    { key: 'date', header: 'Date', type: 'date', sortable: false },
    { key: 'party', header: 'Party', sortable: false },
    { key: 'amount', header: 'Amount', type: 'money', sortable: false },
    { key: 'status', header: 'Status', type: 'status', sortable: false },
    { key: 'createdAt', header: 'Created', type: 'datetime', sortable: false },
  ];

  return (
    <DataTable<RecentDoc>
      tableKey="recent-documents"
      queryKey="recent-documents"
      fetcher={fetcher}
      filters={{ type }}
      columns={columns}
      onRowDoubleClick={openDoc}
      getRowId={(r) => `${r.type}:${r.id}`}
      exportName="Recent Documents"
      defaultPageSize={100}
      toolbarExtras={
        <select className="ctl !w-[170px]" value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
      }
    />
  );
}

export default [{ id: 'recent-documents', title: 'Recent Documents', icon: History, component: RecentDocumentsScreen }] satisfies ScreenDef[];
