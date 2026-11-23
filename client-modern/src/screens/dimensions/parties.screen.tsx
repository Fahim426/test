import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useForm, UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronRight, ExternalLink, Image as ImageIcon, Plus, RefreshCw, Save, SaveAll, Trash2, Truck, Upload, Users, X } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { AttachmentsSection, DocAction, DocActionSep, DocumentLayout, DocSection, HeaderSection } from '@/components/doc';
import { Badge, Button, Checkbox, ConfirmDialog, Field, IconButton, Input, NumberInput, Select, SelectOption, Tabs, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, apiFieldErrors, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';

type Kind = 'customer' | 'supplier';

interface Party {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  [k: string]: unknown;
}

const vatCats: SelectOption[] = [
  { value: 'TAXABLE', label: 'Taxable' },
  { value: 'ZERO_RATED', label: 'Zero Rated' },
  { value: 'EXEMPT', label: 'Exempt' },
  { value: 'OUT_OF_SCOPE', label: 'Out of Scope' },
];

interface Opt {
  id: number;
  code?: string;
  name?: string;
}
function useMasterOptions(url: string, valueKey: 'id' | 'code' = 'id', enabled = true) {
  return useQuery({
    queryKey: ['party-opts', url, valueKey],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SelectOption[]> => {
      const r = await api.get<Paged<Opt> | Opt[]>(url, { params: { pageSize: 500 } });
      const rows = Array.isArray(r.data) ? r.data : r.data.rows;
      return rows.map((x) => ({ value: valueKey === 'code' ? (x.code ?? '') : x.id, label: [x.code, x.name].filter(Boolean).join(' - ') }));
    },
  });
}

/* ---------------------------------- LISTS ---------------------------------- */
function PartyList({ kind }: { kind: Kind }) {
  const open = useOpenScreen();
  const can = usePermission();
  const mod = kind === 'customer' ? 'customers' : 'suppliers';
  const base = kind === 'customer' ? '/customers' : '/suppliers';
  const form = `${kind}-form`;
  const label = kind === 'customer' ? 'Customer' : 'Supplier';
  const [status, setStatus] = useState('');

  const columns: Column<Party>[] = [
    ...(kind === 'customer'
      ? [{
          key: 'photoThumb', header: '', width: 44, sortable: false,
          cell: (r: Party) => (r.photoThumb ? <img src={String(r.photoThumb)} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="inline-block h-7 w-7 rounded-md bg-surface-3" />),
        } as Column<Party>]
      : []),
    { key: 'code', header: 'Code', width: 90 },
    { key: 'name', header: 'Name' },
    { key: 'trn', header: 'TRN', sortable: false, width: 130 },
    { key: 'phone', header: 'Phone', sortable: false, width: 120 },
    kind === 'customer' ? { key: 'city', header: 'City', width: 110 } : { key: 'country', header: 'Country', width: 110 },
    { key: 'paymentTermName', header: 'Payment Term', sortable: false, width: 120 },
    { key: 'creditLimit', header: 'Credit Limit', type: 'money', width: 110 },
    { key: 'balance', header: 'Balance', type: 'money', sortable: false, width: 110 },
    { key: 'isActive', header: 'Active', type: 'boolean', sortable: false, width: 70 },
  ];

  return (
    <DataTable<Party>
      tableKey={base.slice(1)}
      url={base}
      queryKey={base.slice(1)}
      columns={columns}
      filters={{ isActive: status || undefined }}
      exportName={`${label}s`}
      searchPlaceholder={`Search ${label.toLowerCase()}s...`}
      onRowDoubleClick={(r) => open(form, { id: r.id }, r.name)}
      rowActions={[{ label: 'Open', onClick: (r) => open(form, { id: r.id }, r.name) }]}
      toolbarExtras={
        <>
          {can(mod, 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open(form, {}, `New ${label}`)}>
              New
            </Button>
          )}
          <Select className="w-28" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} placeholder="All status" />
        </>
      }
    />
  );
}
const CustomersScreen = () => <PartyList kind="customer" />;
const SuppliersScreen = () => <PartyList kind="supplier" />;

/* ---------------------------------- FORM ---------------------------------- */
const str = z.string().optional();
const num = (label: string) => z.number({ invalid_type_error: `${label} must be a number` });
const schema = z.object({
  code: str,
  name: z.string().trim().min(1, 'Name is required'),
  arabicName: str,
  trn: str,
  contactPerson: str,
  phone: str,
  mobile: str,
  email: z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional(),
  website: str,
  photo: str,
  photoThumb: str,
  address: str,
  city: str,
  country: str,
  areaId: str,
  paymentTermId: str,
  creditLimit: num('Credit limit').min(0, 'Must be >= 0'),
  currencyCode: str,
  salesmanId: str,
  territoryId: str,
  vatCategory: z.string().min(1),
  openingBalance: num('Opening balance'),
  bankDetails: str,
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const emptyValues: FormValues = {
  code: '', name: '', arabicName: '', trn: '', contactPerson: '', phone: '', mobile: '', email: '', website: '', photo: '', photoThumb: '', address: '', city: '', country: '',
  areaId: '', paymentTermId: '', creditLimit: 0, currencyCode: 'AED', salesmanId: '', territoryId: '', vatCategory: 'TAXABLE',
  openingBalance: 0, bankDetails: '', isActive: true,
};

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const toForm = (d: Party): FormValues => ({
  code: s(d.code), name: s(d.name), arabicName: s(d.arabicName), trn: s(d.trn), contactPerson: s(d.contactPerson), phone: s(d.phone), mobile: s(d.mobile),
  email: s(d.email), website: s(d.website), photo: s(d.photo), photoThumb: s(d.photoThumb), address: s(d.address), city: s(d.city), country: s(d.country), areaId: s(d.areaId), paymentTermId: s(d.paymentTermId),
  creditLimit: Number(d.creditLimit ?? 0), currencyCode: s(d.currencyCode) || 'AED', salesmanId: s(d.salesmanId), territoryId: s(d.territoryId),
  vatCategory: s(d.vatCategory) || 'TAXABLE', openingBalance: Number(d.openingBalance ?? 0), bankDetails: s(d.bankDetails), isActive: !!d.isActive,
});
const idOrNull = (v: string | undefined) => (v ? Number(v) : null);

interface LinkedLedgerInfo {
  accountId: number;
  code: string;
  name: string;
  path: { id: number; code: string; name: string }[];
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyId: number;
  balance: number;
  debit: number;
  credit: number;
}

/** Resize an image file in the browser: max side `max` px, WEBP (JPEG fallback). */
function resizeImage(file: File, max: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d');
      if (!g) return reject(new Error('Canvas not available'));
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const webp = c.toDataURL('image/webp', quality);
      resolve(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a readable image'));
    };
    img.src = url;
  });
}

/** Optional profile photo: upload / replace / remove. Stores a 512 px copy and a 96 px list thumbnail. */
function PhotoBox({ photo, name, disabled, onChange }: { photo: string; name: string; disabled: boolean; onChange: (photo: string, thumb: string) => void }) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type)) return toast.warning('Choose a PNG, JPEG or WEBP image');
    if (f.size > 15 * 1024 * 1024) return toast.warning('Image is larger than 15 MB');
    setBusy(true);
    try {
      onChange(await resizeImage(f, 512), await resizeImage(f, 96, 0.8));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="flex flex-col items-center gap-2">
      {photo ? (
        <img src={photo} alt="" className="h-[150px] w-[150px] rounded-xl border border-line object-cover shadow-card" />
      ) : (
        <label
          htmlFor={disabled ? undefined : inputId}
          className={`flex h-[150px] w-[150px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2 text-ink-faint ${disabled ? '' : 'cursor-pointer hover:border-brand/50 hover:bg-brand-soft/40'}`}
        >
          {initials ? <span className="text-3xl font-semibold">{initials}</span> : <ImageIcon size={26} />}
          {!disabled && <span className="text-[11px]">Add photo</span>}
        </label>
      )}
      {!disabled && (
        <div className="flex items-center gap-3">
          <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            <Upload size={12} /> {busy ? 'Processing...' : photo ? 'Replace' : 'Upload'}
          </label>
          <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          {photo && (
            <button type="button" className="inline-flex items-center gap-1 text-[12px] text-danger hover:underline" onClick={() => onChange('', '')}>
              <X size={12} /> Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Accounts tab: the ledger head this customer/supplier posts to, its balance and a link to its ledger. */
function LinkedLedger({ kind, id }: { kind: Kind; id: number | undefined }) {
  const open = useOpenScreen();
  const url = kind === 'customer' ? '/customers' : '/suppliers';
  // same query as the Summary panel (cached)
  const q = useQuery({ queryKey: ['party-summary', kind, id], enabled: !!id, queryFn: async () => (await api.get<Summary>(`${url}/${id}/summary`)).data });
  const l = q.data?.ledger;
  return (
    <HeaderSection title="Linked Ledger" columns={2} className="border-0 border-t border-line">
      <div className="col-span-full">
      {!id ? (
        <div className="text-[13px] italic text-ink-faint">Available after the {kind} is saved.</div>
      ) : q.isLoading ? (
        <div className="text-[13px] text-ink-faint">Loading...</div>
      ) : !l ? (
        <div className="text-[13px] text-danger">{q.error ? apiError(q.error) : `No ${kind === 'customer' ? 'Trade Debtors (AR)' : 'Trade Creditors (AP)'} account is set up in the Chart of Accounts.`}</div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1 text-[13px]">
              {l.path.map((p, i) => (
                <span key={p.id} className={i === l.path.length - 1 ? 'font-semibold text-ink' : 'text-ink-muted'}>
                  {p.code} {p.name}
                  <ChevronRight size={12} className="mx-0.5 inline text-ink-faint" />
                </span>
              ))}
              <span className="font-semibold text-brand">{`${q.data?.code ?? ''} ${q.data?.name ?? ''}`.trim()}</span>
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              Postings go to {l.code} {l.name}, tagged with this {kind}. Balance includes the opening balance on this record.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">Balance</div>
              <div className="text-base font-semibold tabular-nums">
                {fmt.money(l.debit || l.credit)} {l.debit ? 'Dr' : l.credit ? 'Cr' : ''}
              </div>
            </div>
            <Button icon={BookOpen} onClick={() => open('general-ledger', { accountId: l.accountId, partyType: l.partyType, partyId: l.partyId }, `Ledger · ${q.data?.name ?? l.code}`)}>
              View Ledger
            </Button>
          </div>
        </div>
      )}
      </div>
    </HeaderSection>
  );
}

interface Summary {
  code?: string;
  name?: string;
  balance: number;
  creditLimit: number;
  availableCredit: number;
  creditExceeded?: boolean;
  openInvoices: number;
  openInvoicesAmount: number;
  overdueInvoices: number;
  openOrders: number;
  totalInvoices: number;
  totalSales?: number;
  totalPurchases?: number;
  openQuotations?: number;
  deliveriesAwaitingInvoice?: number;
  goodsReceiptsNotInvoiced?: number;
  lastInvoice?: { id: number; docNo: string; docDate: string; total: number } | null;
  ledger?: LinkedLedgerInfo | null;
  lastOrder?: { id: number; docNo: string; docDate: string; total: number; status: string } | null;
}

function SummaryPanel({ kind, id }: { kind: Kind; id: number | undefined }) {
  const open = useOpenScreen();
  const url = kind === 'customer' ? '/customers' : '/suppliers';
  const q = useQuery({ queryKey: ['party-summary', kind, id], enabled: !!id, queryFn: async () => (await api.get<Summary>(`${url}/${id}/summary`)).data });
  const d = q.data;
  const Row = ({ l, v, tone }: { l: string; v: ReactNode; tone?: string }) => (
    <div className="flex items-center justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-ink-muted">{l}</span>
      <span className={`tabular-nums font-medium ${tone ?? ''}`}>{v}</span>
    </div>
  );
  return (
    <DocSection title="Summary" bodyClassName="p-3">
      {!id ? (
        <div className="text-[13px] italic text-ink-faint">Available after the {kind} is saved.</div>
      ) : q.isLoading ? (
        <div className="text-[13px] text-ink-faint">Loading...</div>
      ) : !d ? (
        <div className="text-[13px] text-danger">{q.error ? apiError(q.error) : 'No data'}</div>
      ) : (
        <div className="divide-y divide-line">
          <Row l={kind === 'customer' ? 'Receivable Balance' : 'Payable Balance'} v={fmt.money(d.balance)} tone="text-brand" />
          <Row l="Credit Limit" v={fmt.money(d.creditLimit)} />
          <Row l="Available Credit" v={fmt.money(d.availableCredit)} tone={d.availableCredit < 0 ? 'text-danger' : ''} />
          {d.creditExceeded && <div className="py-1"><Badge tone="red">Credit limit exceeded</Badge></div>}
          <Row l="Open Invoices" v={`${d.openInvoices} (${fmt.money(d.openInvoicesAmount)})`} />
          <Row l="Overdue Invoices" v={d.overdueInvoices} tone={d.overdueInvoices ? 'text-danger' : ''} />
          <Row l="Open Orders" v={d.openOrders} />
          {kind === 'customer' ? (
            <>
              <Row l="Open Quotations" v={d.openQuotations ?? 0} />
              <Row l="Deliveries to Invoice" v={d.deliveriesAwaitingInvoice ?? 0} />
              <Row l="Total Sales" v={`${fmt.money(d.totalSales ?? 0)} (${d.totalInvoices} inv.)`} />
              {d.lastInvoice && (
                <div className="flex items-center justify-between py-0.5 text-[13px]">
                  <span className="text-ink-muted">Last Invoice</span>
                  <button type="button" className="text-brand hover:underline" onClick={() => open('sales-invoice-form', { id: d.lastInvoice!.id }, d.lastInvoice!.docNo)}>
                    {d.lastInvoice.docNo} - {fmt.date(d.lastInvoice.docDate)}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <Row l="GRN not Invoiced" v={d.goodsReceiptsNotInvoiced ?? 0} />
              <Row l="Total Purchases" v={`${fmt.money(d.totalPurchases ?? 0)} (${d.totalInvoices} inv.)`} />
              {d.lastOrder && (
                <div className="flex items-center justify-between py-0.5 text-[13px]">
                  <span className="text-ink-muted">Last PO</span>
                  <button type="button" className="text-brand hover:underline" onClick={() => open('purchase-order-form', { id: d.lastOrder!.id }, d.lastOrder!.docNo)}>
                    {d.lastOrder.docNo} - {fmt.date(d.lastOrder.docDate)}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </DocSection>
  );
}

function PartyForm({ kind, params, tabId }: ScreenProps & { kind: Kind }) {
  const isCust = kind === 'customer';
  const mod = isCust ? 'customers' : 'suppliers';
  const label = isCust ? 'Customer' : 'Supplier';
  const ws = useWorkspace();
  const can = usePermission();
  const doc = useDocument<Party>(isCust ? '/customers' : '/suppliers', params.id, { tabId });
  const [confirmDel, setConfirmDel] = useState(false);

  const terms = useMasterOptions('/payment-terms');
  const currencies = useMasterOptions('/currencies', 'code');
  const salesmen = useMasterOptions('/salesmen', 'id', isCust);
  const territories = useMasterOptions('/territories', 'id', isCust);
  const areas = useMasterOptions('/areas', 'id', isCust);

  const values = useMemo(() => (doc.data ? toForm(doc.data) : undefined), [doc.data]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), values, defaultValues: emptyValues });
  const { register, formState } = form;
  const err = (k: keyof FormValues) => formState.errors[k]?.message as string | undefined;
  const editable = doc.isNew ? can(mod, 'create') : can(mod, 'edit');

  useEffect(() => {
    ws.setDirty(tabId, formState.isDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formState.isDirty, tabId]);

  // the open tab shows the customer / supplier name (also after saving a new one or renaming)
  const savedName = doc.data?.name;
  useEffect(() => {
    if (savedName) ws.setTitle(tabId, savedName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedName, tabId]);

  const num0 = (k: 'creditLimit' | 'openingBalance'): UseFormRegisterReturn => register(k, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v)) });

  const submit = (andClose: boolean) =>
    form.handleSubmit(
      async (v) => {
        const body: Record<string, unknown> = {
          code: v.code?.trim() || undefined,
          name: v.name,
          trn: v.trn, contactPerson: v.contactPerson, phone: v.phone, email: v.email, website: v.website, address: v.address, country: v.country,
          paymentTermId: idOrNull(v.paymentTermId), creditLimit: v.creditLimit, currencyCode: v.currencyCode || undefined,
          vatCategory: v.vatCategory, openingBalance: v.openingBalance, isActive: v.isActive,
        };
        if (isCust) {
          Object.assign(body, {
            arabicName: v.arabicName, mobile: v.mobile, city: v.city, areaId: idOrNull(v.areaId), salesmanId: idOrNull(v.salesmanId), territoryId: idOrNull(v.territoryId),
            photo: v.photo || null, photoThumb: v.photoThumb || null,
          });
        } else body.bankDetails = v.bankDetails;
        try {
          await doc.save(body);
          form.reset(v);
          ws.setDirty(tabId, false);
          if (andClose) ws.close(tabId);
        } catch (e) {
          Object.entries(apiFieldErrors(e)).forEach(([k, m]) => form.setError(k as keyof FormValues, { message: m }));
        }
      },
      () => toast.warning('Please fix the highlighted fields'),
    )();

  const remove = async () => {
    try {
      await doc.remove();
      setConfirmDel(false);
      ws.setDirty(tabId, false);
      ws.close(tabId);
    } catch {
      setConfirmDel(false);
    }
  };

  const dis = !editable;
  const sel = (k: keyof FormValues, options: SelectOption[] | undefined) => <Select options={options} placeholder="" disabled={dis} invalid={!!err(k)} {...register(k)} />;

  const general = (
    <div className="flex">
    {isCust && (
      <div className="flex shrink-0 flex-col items-center border-r border-line px-5 pb-4 pt-5">
        <PhotoBox
          photo={form.watch('photo') ?? ''}
          name={form.watch('name') ?? ''}
          disabled={dis}
          onChange={(p, t) => {
            form.setValue('photo', p, { shouldDirty: true });
            form.setValue('photoThumb', t, { shouldDirty: true });
          }}
        />
      </div>
    )}
    <HeaderSection title={`${label} Information`} columns={4} className="min-w-0 flex-1 border-0">
      <Field label="Code" hint="Auto-generated if blank"><Input readOnly={!doc.isNew} disabled={dis} {...register('code')} /></Field>
      <Field label="Name" required error={err('name')} className="col-span-2"><Input disabled={dis} invalid={!!err('name')} {...register('name')} /></Field>
      {isCust && <Field label="Arabic Name"><Input dir="rtl" disabled={dis} {...register('arabicName')} /></Field>}
      <Field label="TRN" error={err('trn')}><Input disabled={dis} {...register('trn')} /></Field>
      <Field label="Contact Person"><Input disabled={dis} {...register('contactPerson')} /></Field>
      <Field label="Phone"><Input disabled={dis} {...register('phone')} /></Field>
      {isCust && <Field label="Mobile"><Input disabled={dis} {...register('mobile')} /></Field>}
      <Field label="Email" error={err('email')}><Input type="email" disabled={dis} invalid={!!err('email')} {...register('email')} /></Field>
    </HeaderSection>
    </div>
  );

  const website = form.watch('website');
  const siteHref = website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : '';

  const contact = (
    <HeaderSection title="Address" columns={4} className="border-0">
      <Field label="Address" error={err('address')} className="col-span-4"><Textarea rows={2} disabled={dis} {...register('address')} /></Field>
      {isCust && <Field label="City"><Input disabled={dis} {...register('city')} /></Field>}
      <Field label="Country"><Input disabled={dis} {...register('country')} /></Field>
      {isCust && <Field label="Area">{sel('areaId', areas.data)}</Field>}
      <Field label="Website" className="col-span-2" error={err('website')}>
        <div className="flex items-center gap-1">
          <Input placeholder="www.example.com" disabled={dis} {...register('website')} />
          <IconButton icon={ExternalLink} label="Open website" disabled={!siteHref} onClick={() => siteHref && window.open(siteHref, '_blank', 'noopener,noreferrer')} />
        </div>
      </Field>
    </HeaderSection>
  );

  const accounts = (
    <>
    <HeaderSection title="Account Settings" columns={4} className="border-0">
      <Field label="Credit Limit" error={err('creditLimit')}><NumberInput min={0} disabled={dis} invalid={!!err('creditLimit')} {...num0('creditLimit')} /></Field>
      <Field label="Payment Term">{sel('paymentTermId', terms.data)}</Field>
      <Field label="Currency">{sel('currencyCode', currencies.data)}</Field>
      <Field label="VAT Category">{sel('vatCategory', vatCats)}</Field>
      {isCust && <Field label="Salesman">{sel('salesmanId', salesmen.data)}</Field>}
      {isCust && <Field label="Territory">{sel('territoryId', territories.data)}</Field>}
      <Field label={`Opening Balance${isCust ? ' (Dr)' : ' (Cr)'}`} error={err('openingBalance')}><NumberInput disabled={dis} {...num0('openingBalance')} /></Field>
      <div className="flex items-end pb-1"><Checkbox label="Active" disabled={dis} {...register('isActive')} /></div>
    </HeaderSection>
    <LinkedLedger kind={kind} id={doc.data?.id} />
    </>
  );

  const documents = doc.data?.id ? (
    <div className="p-3">
      <AttachmentsSection docType={isCust ? 'CUSTOMER' : 'SUPPLIER'} docId={doc.data.id} readOnly={dis} />
    </div>
  ) : (
    <div className="p-4 text-[13px] italic text-ink-faint">Save the {label.toLowerCase()} first, then attach documents.</div>
  );

  const bank = (
    <HeaderSection title="Bank Details" columns={2} className="border-0">
      <Field label="Bank details (name, account, IBAN, SWIFT)" error={err('bankDetails')} className="col-span-2">
        <Textarea rows={6} disabled={dis} {...register('bankDetails')} />
      </Field>
    </HeaderSection>
  );

  return (
    <>
      <DocumentLayout
        title={doc.data?.code ? `${label} · ${doc.data.code}` : label}
        icon={isCust ? Users : Truck}
        docNo={doc.data?.name}
        status={doc.data ? (doc.data.isActive ? undefined : 'INACTIVE') : undefined}
        loading={doc.isLoading}
        error={doc.error}
        aside={<SummaryPanel kind={kind} id={doc.data?.id} />}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={dis} loading={doc.saving} onClick={() => submit(false)}>Save</DocAction>
            <DocAction icon={SaveAll} hidden={dis} loading={doc.saving} onClick={() => submit(true)}>Save &amp; Close</DocAction>
            <DocActionSep />
            <DocAction icon={Trash2} variant="danger" hidden={doc.isNew || !can(mod, 'delete')} onClick={() => setConfirmDel(true)}>Delete</DocAction>
            <DocAction icon={RefreshCw} hidden={doc.isNew} onClick={() => { doc.refetch(); form.reset(); }}>Refresh</DocAction>
          </>
        }
      >
        <div className="border border-line bg-surface rounded-lg">
          <Tabs
            tabs={[
              { key: 'general', label: 'General', content: general },
              { key: 'contact', label: 'Contact / Address', content: contact },
              { key: 'accounts', label: 'Accounts', content: accounts },
              { key: 'bank', label: 'Bank Details', content: bank, hidden: isCust },
              { key: 'documents', label: 'Documents', content: documents },
            ]}
          />
        </div>
      <RevisionHistory entity={isCust ? 'Customer' : 'Supplier'} id={doc.id} />
      </DocumentLayout>
      <ConfirmDialog
        open={confirmDel}
        danger
        title={`Delete ${label}`}
        message={`Delete ${label.toLowerCase()} "${doc.data?.name ?? ''}"? If it has transactions it will be deactivated instead.`}
        confirmLabel="Delete"
        loading={doc.removing}
        onCancel={() => setConfirmDel(false)}
        onConfirm={remove}
      />
    </>
  );
}
const CustomerForm = (p: ScreenProps) => <PartyForm kind="customer" {...p} />;
const SupplierForm = (p: ScreenProps) => <PartyForm kind="supplier" {...p} />;

export default [
  { id: 'customers', title: 'Customers', icon: Users, component: CustomersScreen, permission: 'customers' },
  { id: 'customer-form', title: 'Customer', icon: Users, component: CustomerForm, multiInstance: true, permission: 'customers' },
  { id: 'suppliers', title: 'Suppliers', icon: Truck, component: SuppliersScreen, permission: 'suppliers' },
  { id: 'supplier-form', title: 'Supplier', icon: Truck, component: SupplierForm, multiInstance: true, permission: 'suppliers' },
] satisfies ScreenDef[];
