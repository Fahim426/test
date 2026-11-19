import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, FileDown, FileUp, Upload } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError, saveBlob } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { Badge, Button, Checkbox, Field, Input, Panel, Select } from '@/components/ui';

// Supported entities of /import/:entity and /export/:entity (server ENTITIES in services/admin-import.ts)
const ENTITIES = [
  { value: 'customers', label: 'Customers' },
  { value: 'suppliers', label: 'Suppliers' },
  { value: 'products', label: 'Products' },
];

interface ImportReport {
  entity: string;
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  rows: { row: number; status: 'OK' | 'ERROR'; action?: 'create' | 'update'; code?: string | null; errors: string[] }[];
}

async function download(url: string, params: Record<string, string>, fallbackName: string) {
  const r = await api.get<Blob>(url, { params, responseType: 'blob' });
  const cd = String(r.headers['content-disposition'] ?? '');
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  saveBlob(r.data, m ? decodeURIComponent(m[1]) : fallbackName);
}
/** Error bodies of blob requests are Blobs; extract the message. */
async function blobError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text()) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* fall through */
    }
  }
  return apiError(e);
}

function DataImportScreen() {
  const can = usePermission();
  const [entity, setEntity] = useState('customers');
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [validated, setValidated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readCsv = async (): Promise<string> => {
    if (!file) throw new Error('Choose a CSV file first');
    if (!/\.csv$|\.txt$/i.test(file.name)) throw new Error('Only CSV files can be uploaded. Download the CSV template, or save your Excel sheet as CSV.');
    return file.text();
  };
  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const csv = await readCsv();
      return { dryRun, data: (await api.post<ImportReport>(`/import/${entity}`, { csv, dryRun, updateExisting })).data };
    },
    onSuccess: ({ dryRun, data }) => {
      setReport(data);
      setValidated(dryRun && data.invalid === 0 && data.total > 0);
      if (!dryRun) toast.success(`Import complete: ${data.created} created, ${data.updated} updated, ${data.invalid} failed`);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const tpl = async (format: 'csv' | 'xlsx') => {
    try {
      await download(`/import/${entity}/template`, { format }, `${entity}-import-template.${format}`);
    } catch (e) {
      toast.error(await blobError(e));
    }
  };
  const reset = () => {
    setReport(null);
    setValidated(false);
  };
  const canImport = can('import_export', 'create');
  const errorRows = report?.rows.filter((r) => r.status === 'ERROR') ?? [];

  return (
    <div className="h-full overflow-auto p-3">
      <div className="max-w-[900px] space-y-3">
        <Panel title="1. Choose entity and download the template">
          <div className="flex items-end gap-2">
            <Field label="Entity" className="w-52">
              <Select value={entity} options={ENTITIES} onChange={(e) => { setEntity(e.target.value); reset(); }} />
            </Field>
            <Button icon={FileDown} onClick={() => tpl('csv')}>Template (CSV)</Button>
            <Button icon={FileDown} onClick={() => tpl('xlsx')}>Template (Excel)</Button>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Lookup columns (payment term, salesman, brand, ...) accept the name or code. Existing records are matched by code.</div>
        </Panel>
        <Panel title="2. Upload and validate">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="CSV file">
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
                <Button icon={FileUp} onClick={() => fileRef.current?.click()}>Choose file...</Button>
                <Input readOnly className="w-64" value={file?.name ?? ''} placeholder="No file selected" />
              </div>
            </Field>
            <Checkbox label="Update existing records (match by code)" checked={updateExisting} onChange={(e) => { setUpdateExisting(e.target.checked); reset(); }} />
          </div>
          <div className="mt-2 flex gap-2">
            <Button icon={CheckCircle2} disabled={!file || !canImport} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>Validate (dry run)</Button>
            <Button variant="primary" icon={Upload} disabled={!file || !canImport || (report !== null && !validated && report.dryRun)} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>
              Import
            </Button>
            {!canImport && <span className="self-center text-[11px] text-red-600">You do not have permission to import.</span>}
          </div>
        </Panel>
        {report && (
          <Panel title={report.dryRun ? 'Validation result (nothing saved)' : 'Import result'}>
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Badge tone="gray">Total rows: {report.total}</Badge>
              <Badge tone="green">{report.dryRun ? 'Valid' : 'Saved'}: {report.valid}</Badge>
              <Badge tone="blue">To create / created: {report.created}</Badge>
              <Badge tone="purple">To update / updated: {report.updated}</Badge>
              <Badge tone={report.invalid ? 'red' : 'gray'}>Errors: {report.invalid}</Badge>
            </div>
            {errorRows.length > 0 && (
              <table className="mt-2 w-full border-collapse text-[12px]">
                <thead>
                  <tr><th className="grid-th w-16 text-left">Row</th><th className="grid-th w-32 text-left">Code</th><th className="grid-th text-left">Errors</th></tr>
                </thead>
                <tbody>
                  {errorRows.slice(0, 500).map((r) => (
                    <tr key={r.row}>
                      <td className="grid-td">{r.row}</td>
                      <td className="grid-td">{r.code ?? ''}</td>
                      <td className="grid-td text-red-700">{r.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {errorRows.length > 500 && <div className="mt-1 text-[11px] text-slate-500">Showing first 500 of {errorRows.length} errors.</div>}
            {report.dryRun && report.invalid === 0 && <div className="mt-2 text-[12px] text-green-700">All rows are valid. Click Import to save them.</div>}
          </Panel>
        )}
      </div>
    </div>
  );
}

function DataExportScreen() {
  const can = usePermission();
  const [entity, setEntity] = useState('customers');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const params: Record<string, string> = { format };
      if (search.trim()) params.search = search.trim();
      if (isActive) params.isActive = isActive;
      await download(`/export/${entity}`, params, `${entity}.${format}`);
    } catch (e) {
      toast.error(await blobError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="h-full overflow-auto p-3">
      <div className="max-w-[640px]">
        <Panel title="Export data">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Entity">
              <Select value={entity} options={ENTITIES} onChange={(e) => setEntity(e.target.value)} />
            </Field>
            <Field label="Format">
              <Select value={format} options={[{ value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV (.csv)' }]} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')} />
            </Field>
            <Field label="Search (code / name)">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={isActive} placeholder="All" options={[{ value: 'true', label: 'Active only' }, { value: 'false', label: 'Inactive only' }]} onChange={(e) => setIsActive(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Button variant="primary" icon={Download} loading={busy} disabled={!can('import_export', 'export')} onClick={go}>Download</Button>
            {!can('import_export', 'export') && <span className="ml-2 text-[11px] text-red-600">You do not have permission to export.</span>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default [
  { id: 'data-import', title: 'Data Import', icon: Upload, component: DataImportScreen, permission: 'import_export' },
  { id: 'data-export', title: 'Data Export', icon: Download, component: DataExportScreen, permission: 'import_export' },
] satisfies ScreenDef[];
