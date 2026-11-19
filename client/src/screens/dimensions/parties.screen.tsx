import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useForm, UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Save, SaveAll, Trash2, Truck, Users } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocAction, DocActionSep, DocumentLayout, DocSection, HeaderSection } from '@/components/doc';
import { Badge, Button, Checkbox, ConfirmDialog, Field, Input, NumberInput, Select, SelectOption, Tabs, Textarea } from '@/components/ui';
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
      onRowDoubleClick={(r) => open(form, { id: r.id }, r.code)}
      rowActions={[{ label: 'Open', onClick: (r) => open(form, { id: r.id }, r.code) }]}
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
  code: '', name: '', arabicName: '', trn: '', contactPerson: '', phone: '', mobile: '', email: '', address: '', city: '', country: '',
  areaId: '', paymentTermId: '', creditLimit: 0, currencyCode: 'AED', salesmanId: '', territoryId: '', vatCategory: 'TAXABLE',
  openingBalance: 0, bankDetails: '', isActive: true,
};

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const toForm = (d: Party): FormValues => ({
  code: s(d.code), name: s(d.name), arabicName: s(d.arabicName), trn: s(d.trn), contactPerson: s(d.contactPerson), phone: s(d.phone), mobile: s(d.mobile),
  email: s(d.email), address: s(d.address), city: s(d.city), country: s(d.country), areaId: s(d.areaId), paymentTermId: s(d.paymentTermId),
  creditLimit: Number(d.creditLimit ?? 0), currencyCode: s(d.currencyCode) || 'AED', salesmanId: s(d.salesmanId), territoryId: s(d.territoryId),
  vatCategory: s(d.vatCategory) || 'TAXABLE', openingBalance: Number(d.openingBalance ?? 0), bankDetails: s(d.bankDetails), isActive: !!d.isActive,
});
const idOrNull = (v: string | undefined) => (v ? Number(v) : null);

interface Summary {
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
  lastOrder?: { id: number; docNo: string; docDate: string; total: number; status: string } | null;
}

function SummaryPanel({ kind, id }: { kind: Kind; id: number | undefined }) {
  const open = useOpenScreen();
  const url = kind === 'customer' ? '/customers' : '/suppliers';
  const q = useQuery({ queryKey: ['party-summary', kind, id], enabled: !!id, queryFn: async () => (await api.get<Summary>(`${url}/${id}/summary`)).data });
  const d = q.data;
  const Row = ({ l, v, tone }: { l: string; v: ReactNode; tone?: string }) => (
    <div className="flex items-center justify-between gap-3 py-0.5 text-[12px]">
      <span className="text-slate-600">{l}</span>
      <span className={`tabular-nums font-medium ${tone ?? ''}`}>{v}</span>
    </div>
  );
  return (
    <DocSection title="Summary" bodyClassName="p-3">
      {!id ? (
        <div className="text-[12px] italic text-slate-400">Available after the {kind} is saved.</div>
      ) : q.isLoading ? (
        <div className="text-[12px] text-slate-400">Loading...</div>
      ) : !d ? (
        <div className="text-[12px] text-red-600">{q.error ? apiError(q.error) : 'No data'}</div>
      ) : (
        <div className="divide-y divide-app-border">
          <Row l={kind === 'customer' ? 'Receivable Balance' : 'Payable Balance'} v={fmt.money(d.balance)} tone="text-brand" />
          <Row l="Credit Limit" v={fmt.money(d.creditLimit)} />
          <Row l="Available Credit" v={fmt.money(d.availableCredit)} tone={d.availableCredit < 0 ? 'text-red-600' : ''} />
          {d.creditExceeded && <div className="py-1"><Badge tone="red">Credit limit exceeded</Badge></div>}
          <Row l="Open Invoices" v={`${d.openInvoices} (${fmt.money(d.openInvoicesAmount)})`} />
          <Row l="Overdue Invoices" v={d.overdueInvoices} tone={d.overdueInvoices ? 'text-red-600' : ''} />
          <Row l="Open Orders" v={d.openOrders} />
          {kind === 'customer' ? (
            <>
              <Row l="Open Quotations" v={d.openQuotations ?? 0} />
              <Row l="Deliveries to Invoice" v={d.deliveriesAwaitingInvoice ?? 0} />
              <Row l="Total Sales" v={`${fmt.money(d.totalSales ?? 0)} (${d.totalInvoices} inv.)`} />
              {d.lastInvoice && (
                <div className="flex items-center justify-between py-0.5 text-[12px]">
                  <span className="text-slate-600">Last Invoice</span>
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
                <div className="flex items-center justify-between py-0.5 text-[12px]">
                  <span className="text-slate-600">Last PO</span>
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

  const num0 = (k: 'creditLimit' | 'openingBalance'): UseFormRegisterReturn => register(k, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v)) });

  const submit = (andClose: boolean) =>
    form.handleSubmit(
      async (v) => {
        const body: Record<string, unknown> = {
          code: v.code?.trim() || undefined,
          name: v.name,
          trn: v.trn, contactPerson: v.contactPerson, phone: v.phone, email: v.email, address: v.address, country: v.country,
          paymentTermId: idOrNull(v.paymentTermId), creditLimit: v.creditLimit, currencyCode: v.currencyCode || undefined,
          vatCategory: v.vatCategory, openingBalance: v.openingBalance, isActive: v.isActive,
        };
        if (isCust) {
          Object.assign(body, { arabicName: v.arabicName, mobile: v.mobile, city: v.city, areaId: idOrNull(v.areaId), salesmanId: idOrNull(v.salesmanId), territoryId: idOrNull(v.territoryId) });
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
    <HeaderSection title={`${label} Information`} columns={4} className="border-0">
      <Field label="Code" hint="Auto-generated if blank"><Input readOnly={!doc.isNew} disabled={dis} {...register('code')} /></Field>
      <Field label="Name" required error={err('name')} className="col-span-2"><Input disabled={dis} invalid={!!err('name')} {...register('name')} /></Field>
      {isCust && <Field label="Arabic Name"><Input dir="rtl" disabled={dis} {...register('arabicName')} /></Field>}
      <Field label="TRN" error={err('trn')}><Input disabled={dis} {...register('trn')} /></Field>
      <Field label="Contact Person"><Input disabled={dis} {...register('contactPerson')} /></Field>
      <Field label="Phone"><Input disabled={dis} {...register('phone')} /></Field>
      {isCust && <Field label="Mobile"><Input disabled={dis} {...register('mobile')} /></Field>}
      <Field label="Email" error={err('email')}><Input type="email" disabled={dis} invalid={!!err('email')} {...register('email')} /></Field>
    </HeaderSection>
  );

  const contact = (
    <HeaderSection title="Address" columns={4} className="border-0">
      <Field label="Address" error={err('address')} className="col-span-4"><Textarea rows={2} disabled={dis} {...register('address')} /></Field>
      {isCust && <Field label="City"><Input disabled={dis} {...register('city')} /></Field>}
      <Field label="Country"><Input disabled={dis} {...register('country')} /></Field>
      {isCust && <Field label="Area">{sel('areaId', areas.data)}</Field>}
    </HeaderSection>
  );

  const accounts = (
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
        title={label}
        icon={isCust ? Users : Truck}
        docNo={doc.data?.code}
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
        <div className="border border-app-border bg-white">
          <Tabs
            tabs={[
              { key: 'general', label: 'General', content: general },
              { key: 'contact', label: 'Contact / Address', content: contact },
              { key: 'accounts', label: 'Accounts', content: accounts },
              { key: 'bank', label: 'Bank Details', content: bank, hidden: isCust },
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
