import { useFeatures } from '@/hooks/useFeatures';
import { useProductConfig } from '@/hooks/useProductConfig';
import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { ProductPhoto, uploadProductPhoto } from '@/components/inventory/ProductPhoto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Package, Plus, Save, Trash2, X, Copy, ImageOff } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocAction, DocActionSep, DocumentLayout, HeaderSection } from '@/components/doc';
import { Button, Checkbox, ConfirmDialog, Field, Input, NumberInput, Select, Tabs, Textarea, IconButton } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { DocLink, numOr0, numOrNull, strOrNull, toStr, useMasterRows, useOptions } from '@/components/inventory/common';

/* ----------------------------------- types ----------------------------------- */
interface ProductRow {
  id: number;
  code: string;
  name: string;
  imageUrl?: string | null;
  oemNumber?: string | null;
  barcode?: string | null;
  brand?: { name: string } | null;
  category?: { name: string } | null;
  retailPrice?: number | string;
  wholesalePrice?: number | string;
  costPrice?: number | string;
  minStock?: number | string;
  reorderLevel?: number | string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStock: boolean;
}

interface HistoryLine {
  type: string;
  docId: number;
  docNo: string;
  date: string;
  status: string;
  supplier?: { name: string } | null;
  customer?: { name: string } | null;
  qty: number;
  rate?: number;
}
interface ProductDoc extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
  imageUrl?: string | null;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  stockValue: number;
  lowStock: boolean;
  partNumbers?: { number: string; kind: string }[];
  vehicles?: Record<string, unknown>[];
  balances?: { warehouseId: number; warehouse?: { code: string; name: string } | null; onHand: number; reserved: number; available: number; avgCost: number; value: number }[];
  history?: {
    summary?: { lastPurchase?: HistoryLine | null; lastSale?: HistoryLine | null };
    purchaseOrders: HistoryLine[];
    goodsReceipts: HistoryLine[];
    purchaseInvoices: HistoryLine[];
    salesInvoices: HistoryLine[];
    deliveries: HistoryLine[];
    quotations: HistoryLine[];
  };
}

interface PForm {
  code: string; stockNumber: string; name: string; arabicName: string; description: string; barcode: string; oemNumber: string;
  brandId: string; categoryId: string; subCategoryId: string; productGroupId: string; productTypeId: string;
  purchaseUnit: string; salesUnit: string; isActive: boolean;
  costPrice: string; averageCost: string; lastPurchasePrice: string; retailPrice: string; wholesalePrice: string;
  minStock: string; maxStock: string; reorderLevel: string; vatRate: string;
  weight: string; length: string; width: string; height: string; countryOfOrigin: string; warranty: string;
  primarySupplierId: string; defaultWarehouseId: string; rack: string; shelf: string; bin: string;
  partNumbers: { number: string; kind: 'OEM' | 'ALTERNATE'; brand: string }[];
  vehicles: { make: string; model: string; variant: string; yearFrom: string; yearTo: string; engine: string; fuel: string; transmission: string }[];
}

const EMPTY: PForm = {
  code: '', stockNumber: '', name: '', arabicName: '', description: '', barcode: '', oemNumber: '',
  brandId: '', categoryId: '', subCategoryId: '', productGroupId: '', productTypeId: '',
  purchaseUnit: 'PCS', salesUnit: 'PCS', isActive: true,
  costPrice: '0', averageCost: '0', lastPurchasePrice: '0', retailPrice: '0', wholesalePrice: '0',
  minStock: '0', maxStock: '0', reorderLevel: '0', vatRate: '5',
  weight: '0', length: '0', width: '0', height: '0', countryOfOrigin: '', warranty: '',
  primarySupplierId: '', defaultWarehouseId: '', rack: '', shelf: '', bin: '',
  partNumbers: [], vehicles: [],
};

function toForm(p: ProductDoc): PForm {
  const g = (k: string) => toStr(p[k]);
  const oem = (p.oemNumber as string | null | undefined)?.toUpperCase();
  return {
    code: p.code, stockNumber: g('stockNumber'), name: p.name, arabicName: g('arabicName'), description: g('description'), barcode: g('barcode'), oemNumber: g('oemNumber'),
    brandId: g('brandId'), categoryId: g('categoryId'), subCategoryId: g('subCategoryId'), productGroupId: g('productGroupId'), productTypeId: g('productTypeId'),
    purchaseUnit: g('purchaseUnit') || 'PCS', salesUnit: g('salesUnit') || 'PCS', isActive: !!p.isActive,
    costPrice: g('costPrice'), averageCost: g('averageCost'), lastPurchasePrice: g('lastPurchasePrice'), retailPrice: g('retailPrice'), wholesalePrice: g('wholesalePrice'),
    minStock: g('minStock'), maxStock: g('maxStock'), reorderLevel: g('reorderLevel'), vatRate: g('vatRate'),
    weight: g('weight'), length: g('length'), width: g('width'), height: g('height'), countryOfOrigin: g('countryOfOrigin'), warranty: g('warranty'),
    primarySupplierId: g('primarySupplierId'), defaultWarehouseId: g('defaultWarehouseId'), rack: g('rack'), shelf: g('shelf'), bin: g('bin'),
    // the server regenerates the primary OEM row from oemNumber, so don't duplicate it in the grid
    partNumbers: (p.partNumbers ?? []).filter((x) => !(x.kind === 'OEM' && x.number.toUpperCase() === oem)).map((x) => ({ number: x.number, kind: x.kind === 'OEM' ? 'OEM' : 'ALTERNATE', brand: toStr((x as { brand?: string | null }).brand) })),
    vehicles: (p.vehicles ?? []).map((v) => ({
      make: toStr(v.make), model: toStr(v.model), variant: toStr(v.variant), yearFrom: toStr(v.yearFrom), yearTo: toStr(v.yearTo),
      engine: toStr(v.engine), fuel: toStr(v.fuel), transmission: toStr(v.transmission),
    })),
  };
}

function toPayload(v: PForm, isNew: boolean) {
  return {
    ...(v.code.trim() ? { code: v.code.trim() } : {}),
    name: v.name.trim(),
    stockNumber: strOrNull(v.stockNumber),
    arabicName: strOrNull(v.arabicName),
    description: strOrNull(v.description),
    oemNumber: strOrNull(v.oemNumber),
    barcode: strOrNull(v.barcode),
    brandId: numOrNull(v.brandId),
    categoryId: numOrNull(v.categoryId),
    subCategoryId: numOrNull(v.subCategoryId),
    productGroupId: numOrNull(v.productGroupId),
    productTypeId: numOrNull(v.productTypeId),
    purchaseUnit: v.purchaseUnit || 'PCS',
    salesUnit: v.salesUnit || 'PCS',
    isActive: v.isActive,
    costPrice: numOr0(v.costPrice),
    ...(isNew ? { averageCost: numOr0(v.costPrice), lastPurchasePrice: numOr0(v.lastPurchasePrice) } : {}),
    retailPrice: numOr0(v.retailPrice),
    wholesalePrice: numOr0(v.wholesalePrice),
    minStock: numOr0(v.minStock),
    maxStock: numOr0(v.maxStock),
    reorderLevel: numOr0(v.reorderLevel),
    vatRate: numOr0(v.vatRate),
    weight: numOr0(v.weight),
    length: numOr0(v.length),
    width: numOr0(v.width),
    height: numOr0(v.height),
    countryOfOrigin: strOrNull(v.countryOfOrigin),
    warranty: strOrNull(v.warranty),
    primarySupplierId: numOrNull(v.primarySupplierId),
    defaultWarehouseId: numOrNull(v.defaultWarehouseId),
    rack: strOrNull(v.rack),
    shelf: strOrNull(v.shelf),
    bin: strOrNull(v.bin),
    partNumbers: v.partNumbers.filter((p) => p.number.trim()).map((p) => ({ number: p.number.trim(), kind: p.kind, brand: p.kind === 'ALTERNATE' ? strOrNull(p.brand) : null })),
    vehicles: v.vehicles
      .filter((x) => x.make.trim() && x.model.trim())
      .map((x) => ({
        make: x.make.trim(), model: x.model.trim(), variant: strOrNull(x.variant), yearFrom: numOrNull(x.yearFrom), yearTo: numOrNull(x.yearTo),
        engine: strOrNull(x.engine), fuel: strOrNull(x.fuel), transmission: strOrNull(x.transmission),
      })),
  };
}

/* ----------------------------------- LIST ----------------------------------- */
function ProductsScreen() {
  const features = useFeatures();
  const open = useOpenScreen();
  const can = usePermission();
  const brands = useOptions('/brands');
  const cats = useOptions('/categories');
  const groups = useOptions('/product-groups');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productGroupId, setGroup] = useState('');
  const [active, setActive] = useState('true');
  const [lowStock, setLow] = useState(false);

  const columns: Column<ProductRow>[] = [
    { key: 'photo', header: 'Photo', noExport: true, width: 80, sortable: false, cell: r => <ProductPhoto productId={r.id} name={r.name} /> },
    { key: 'code', header: 'Code', width: 110 },
    { key: 'stockNumber', header: 'Stock No', width: 110 },
    { key: 'oemNumber', header: 'Mfr Part No', width: 130 },
    { key: 'name', header: 'Description' },
    { key: 'brand.name', header: 'Brand', width: 110, sortable: false },
    { key: 'category.name', header: 'Category', width: 120, sortable: false },
    { key: 'barcode', header: 'Barcode', hidden: true, width: 110, sortable: false },
    { key: 'onHand', header: 'On Hand', type: 'qty', width: 80, sortable: false, total: 'sum',
      cell: (r) => <span className={r.lowStock ? 'font-semibold text-danger' : ''}>{fmt.qty(r.onHand)}</span> },
    { key: 'reserved', header: 'Reserved', type: 'qty', width: 80, sortable: false },
    { key: 'available', header: 'Available', type: 'qty', width: 80, sortable: false,
      cell: (r) => <span className={r.available <= 0 ? 'text-danger' : ''}>{fmt.qty(r.available)}</span> },
    { key: 'reorderLevel', header: 'Reorder', type: 'qty', width: 70, hidden: true, sortable: false },
    { key: 'costPrice', header: 'Cost', type: 'money', width: 85 },
    { key: 'averageCost', header: 'Avg Cost', type: 'money', width: 85 },
    { key: 'lastPurchasePrice', header: 'Last Purch.', type: 'money', width: 90 },
    { key: 'lastPurchaseAt', header: 'Last Purchased', type: 'date', width: 105 },
    { key: 'retailPrice', header: 'Retail', type: 'money', width: 85 },
    { key: 'wholesalePrice', header: 'Wholesale', type: 'money', width: 85, hidden: true, sortable: false },
    { key: 'isActive', header: 'Active', type: 'boolean', width: 60, sortable: false },
  ];

  return (
    <DataTable<ProductRow>
      tableKey="products"
      url="/products"
      columns={columns.filter(c => (features.productImages || c.key !== 'photo') && (features.partNumbers || c.key !== 'oemNumber'))}
      exportName="Products"
      defaultSort={{ key: 'lastPurchaseAt', dir: 'desc' }}
      searchPlaceholder="Search code / manufacturer part / alternate / barcode / name / equipment / brand..."
      filters={{ brandId, categoryId, productGroupId, active, lowStock: lowStock ? 'true' : '' }}
      onRowDoubleClick={(r) => open('product-form', { id: r.id }, r.code)}
      rowActions={[
        { label: 'Open', onClick: (r) => open('product-form', { id: r.id }, r.code) },
        { label: 'Stock Ledger', onClick: (r) => open('stock-ledger', { productId: r.id, productLabel: `${r.code} - ${r.name}` }) },
      ]}
      toolbarExtras={
        <>
          {can('products', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open('product-form', {}, 'New Product')}>New Product</Button>
          )}
          <Select className="w-32" options={brands.options} placeholder="All brands" value={brandId} onChange={(e) => setBrandId(e.target.value)} />
          <Select className="w-36" options={cats.options} placeholder="All categories" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} />
          <Select className="w-32" options={groups.options} placeholder="All groups" value={productGroupId} onChange={(e) => setGroup(e.target.value)} />
          <Select className="w-24" value={active} onChange={(e) => setActive(e.target.value)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} placeholder="All" />
          <Checkbox label="Low stock" checked={lowStock} onChange={(e) => setLow(e.target.checked)} />
        </>
      }
    />
  );
}

/* ----------------------------------- FORM ----------------------------------- */
const th = 'grid-th px-1 text-left';
const td = 'grid-td p-0';
const cellInput = '!h-8 !border-transparent hover:!border-line focus:!border-brand';

function ProductForm({ params, tabId }: ScreenProps) {
  const features = useFeatures();
  const ws = useWorkspace();
  const open = useOpenScreen();
  const can = usePermission();
  const { config } = useProductConfig();
  const doc = useDocument<ProductDoc>('/products', params.id, { tabId, titleOf: (d) => d.code });
  const brands = useOptions('/brands');
  const catRows = useMasterRows('/categories');
  const groups = useOptions('/product-groups');
  const types = useOptions('/product-types');
  const units = useMasterRows('/units');
  const suppliers = useOptions('/suppliers');
  const warehouses = useOptions('/warehouses');
  const [confirmDel, setConfirmDel] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const savingProduct = useRef(false);
  const photoCache = useQueryClient();

  const values = useMemo(() => (doc.data ? toForm(doc.data) : undefined), [doc.data]);
  const form = useForm<PForm>({ values, defaultValues: EMPTY });
  const { register, control, handleSubmit, formState } = form;
  const pn = useFieldArray({ control, name: 'partNumbers' });
  const vh = useFieldArray({ control, name: 'vehicles' });
  const categoryId = useWatch({ control, name: 'categoryId' });
  const subCategoryId = useWatch({ control, name: 'subCategoryId' });
  const oemVal = useWatch({ control, name: 'oemNumber' });

  useEffect(() => ws.setDirty(tabId, formState.isDirty || !!pendingPhoto), [formState.isDirty, pendingPhoto, doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const catOptions = (catRows.data ?? []).filter((c) => !c.parentId).map((c) => ({ value: c.id, label: c.name ?? c.code ?? String(c.id) }));
  const subOptions = (catRows.data ?? []).filter((c) => c.parentId && String(c.parentId) === categoryId).map((c) => ({ value: c.id, label: c.name ?? c.code ?? String(c.id) }));
  const unitOptions = (units.data ?? []).map((u) => ({ value: u.code ?? '', label: `${u.code} - ${u.name}` }));

  const editable = doc.isNew ? can('products', 'create') : can('products', 'edit');
  const submit = handleSubmit(
    async (v) => {
      if (savingProduct.current) return;
      if (!v.name.trim()) return toast.warning('Product name is required');
      savingProduct.current = true;
      try {
        const payload = toPayload(v, doc.isNew);
        if (!features.partNumbers) { delete (payload as any).partNumbers; delete (payload as any).oemNumber; }
        if (!features.vehicleCompatibility) delete (payload as any).vehicles;
        const saved = await doc.save(payload);
        if (pendingPhoto) {
          setSavingPhoto(true);
          try {
            await uploadProductPhoto(saved.id, pendingPhoto);
            await photoCache.invalidateQueries({ queryKey: ['product-photo', saved.id] });
            setPendingPhoto(null);
          } catch (error) {
            toast.error('Product saved, but the photo upload failed. Use Retry photo upload. ' + apiError(error));
          }
        }
      } catch {
        /* toast shown by hook */
      } finally {
        savingProduct.current = false;
        setSavingPhoto(false);
      }
    },
  );

  const remove = async () => {
    try {
      const r = (await doc.remove()) as { deactivated?: boolean; message?: string };
      toast.info(r.message ?? 'Deleted');
      ws.close(tabId);
    } catch (e) {
      toast.error(apiError(e));
    }
    setConfirmDel(false);
  };

  const err = (k: keyof PForm) => (formState.errors[k]?.message as string | undefined);
  const ro = !editable;
  const d = doc.data;
  const hist = d?.history;

  const histRows = (lines: HistoryLine[] | undefined, party: 'supplier' | 'customer') =>
    (lines ?? []).map((l) => ({ ...l, partyName: (party === 'supplier' ? l.supplier?.name : l.customer?.name) ?? '' }));
  const purchaseHist = [
    ...histRows(hist?.purchaseInvoices, 'supplier'), ...histRows(hist?.goodsReceipts, 'supplier'), ...histRows(hist?.purchaseOrders, 'supplier'),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const salesHist = [
    ...histRows(hist?.salesInvoices, 'customer'), ...histRows(hist?.deliveries, 'customer'), ...histRows(hist?.quotations, 'customer'),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));

  const HistTable = ({ rows, party }: { rows: (HistoryLine & { partyName: string })[]; party: string }) => (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="bg-surface-2"><th className={th}>Document</th><th className={th}>Doc No</th><th className={th}>Date</th><th className={th}>Status</th><th className={th}>{party}</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Rate</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={7} className="p-3 text-center text-ink-faint">No history</td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="h-9 hover:bg-brand-soft">
            <td className="grid-td px-1">{fmt.status(r.type)}</td>
            <td className="grid-td px-1"><DocLink type={r.type} id={r.docId} no={r.docNo} /></td>
            <td className="grid-td px-1">{fmt.date(r.date)}</td>
            <td className="grid-td px-1">{fmt.status(r.status)}</td>
            <td className="grid-td px-1">{r.partyName}</td>
            <td className="grid-td px-1 text-right tabular-nums">{fmt.qty(r.qty)}</td>
            <td className="grid-td px-1 text-right tabular-nums">{r.rate !== undefined ? fmt.money(r.rate) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={config.productLabel}
        icon={Package}
        docNo={d?.code}
        status={d ? (d.isActive ? 'ACTIVE' : 'INACTIVE') : undefined}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving || savingPhoto} onClick={submit}>Save</DocAction>
            <DocAction icon={Copy} hidden={doc.isNew} onClick={() => ws.duplicate(tabId)}>Duplicate</DocAction>
            <DocAction icon={Trash2} variant="danger" hidden={doc.isNew || !can('products', 'delete')} onClick={() => setConfirmDel(true)}>Delete</DocAction>
            <DocActionSep />
            <DocAction hidden={doc.isNew} onClick={() => open('stock-ledger', { productId: d?.id, productLabel: `${d?.code} - ${d?.name}` })}>Stock Ledger</DocAction>
            <DocAction hidden={doc.isNew || !features.partNumbers} onClick={() => open('part-lookup', { number: d?.oemNumber ?? d?.code })}>Part Lookup</DocAction>
            {d && (
              <span className="ml-auto text-[13px] text-ink-muted">
                On hand <b className={d.lowStock ? 'text-danger' : ''}>{fmt.qty(d.onHand)}</b> · Reserved <b>{fmt.qty(d.reserved)}</b> · Available <b>{fmt.qty(d.available)}</b> · Value <b>{fmt.money(d.stockValue)}</b>
              </span>
            )}
          </>
        }
      >
        <div className="border border-line bg-surface rounded-lg">
          <Tabs
            tabs={[
              {
                key: 'general',
                label: 'General',
                content: (
                  <HeaderSection title="General" columns={4} className="border-0">
                    {features.productImages && <div className="col-span-full"><ProductPhoto productId={d?.id} name={d?.name} editable={!ro && can('products', 'edit')} selectedFile={pendingPhoto} onSelectFile={setPendingPhoto} disabled={doc.saving || savingPhoto} large /></div>}
                    <Field label="Code" hint={doc.isNew ? 'Leave blank to auto-generate' : undefined}><Input {...register('code')} readOnly={!doc.isNew} placeholder="(auto)" /></Field>
                    <Field label="Stock Number" hint="Second internal code, unique" error={err('stockNumber')}><Input {...register('stockNumber')} readOnly={ro} /></Field>
                    <Field label="Name" required className="col-span-2" error={err('name')}><Input {...register('name', { required: 'Name required' })} readOnly={ro} /></Field>
                    <Field label="Arabic Name"><Input dir="rtl" {...register('arabicName')} readOnly={ro} /></Field>
                    <Field label="Brand"><Select options={brands.options} placeholder="-" disabled={ro} {...register('brandId')} /></Field>
                    <Field label="Category"><Select options={catOptions} placeholder="-" disabled={ro} {...register('categoryId', { onChange: () => form.setValue('subCategoryId', '', { shouldDirty: true }) })} /></Field>
                    <Field label="Sub-category"><Select options={subOptions} placeholder="-" disabled={ro} {...register('subCategoryId')} value={subCategoryId} /></Field>
                    <Field label="Group"><Select options={groups.options} placeholder="-" disabled={ro} {...register('productGroupId')} /></Field>
                    <Field label="Type"><Select options={types.options} placeholder="-" disabled={ro} {...register('productTypeId')} /></Field>
                    <Field label="Purchase Unit"><Select options={unitOptions} disabled={ro} {...register('purchaseUnit')} /></Field>
                    <Field label="Sales Unit"><Select options={unitOptions} disabled={ro} {...register('salesUnit')} /></Field>
                    <Field label="Barcode"><Input {...register('barcode')} readOnly={ro} /></Field>
                    <Field label="Description" className="col-span-3"><Textarea rows={2} {...register('description')} readOnly={ro} /></Field>
                    <Field label=" "><Checkbox label="Active" disabled={ro} {...register('isActive')} /></Field>
                  </HeaderSection>
                ),
              },
              {
                key: 'parts',
                label: `Part Numbers (${pn.fields.length + (oemVal ? 1 : 0)})`,
                hidden: !features.partNumbers,
                content: (
                  <div className="p-3">
                    <div className="mb-2 grid grid-cols-4 gap-3">
                      <Field label="Manufacturer Part Number" hint="Searchable manufacturer part number"><Input {...register('oemNumber')} readOnly={ro} /></Field>
                    </div>
                    <table className="w-full max-w-[820px] border-collapse text-[13px]">
                      <thead><tr className="bg-surface-2"><th className={th}>Part Number (OEM / alternative / interchange)</th><th className={`${th} w-32`}>Kind</th><th className={`${th} w-40`}>Brand (alternative)</th><th className="grid-th w-8" /></tr></thead>
                      <tbody>
                        {pn.fields.map((f, i) => (
                          <tr key={f.id} className="h-9">
                            <td className={td}><Input className={cellInput} readOnly={ro} {...register(`partNumbers.${i}.number`)} /></td>
                            <td className={td}><Select className={cellInput} disabled={ro} options={[{ value: 'OEM', label: 'OEM' }, { value: 'ALTERNATE', label: 'Alternative' }]} {...register(`partNumbers.${i}.kind`)} /></td>
                            <td className={td}><Input className={cellInput} placeholder="Alternative brand" readOnly={ro} {...register(`partNumbers.${i}.brand`)} /></td>
                            <td className={`${td} text-center`}>{!ro && <IconButton icon={X} label="Remove" variant="danger" onClick={() => pn.remove(i)} />}</td>
                          </tr>
                        ))}
                        {pn.fields.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-ink-faint">No alternative numbers</td></tr>}
                      </tbody>
                    </table>
                    {!ro && <Button className="mt-2" icon={Plus} onClick={() => pn.append({ number: '', kind: 'ALTERNATE', brand: '' })}>Add Part Number</Button>}
                  </div>
                ),
              },
              {
                key: 'vehicles',
                label: `${config.compatibilityLabel} (${vh.fields.length})`,
                hidden: !features.vehicleCompatibility,
                content: (
                  <div className="overflow-auto p-3">
                    <table className="w-full min-w-[900px] border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-surface-2">
                          {['Brand *', 'Equipment Model *', 'Configuration', 'Year From', 'Year To', 'Power / Specification', 'Technology', 'Drive / Controller'].map((h) => <th key={h} className={th}>{h}</th>)}
                          <th className="grid-th w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {vh.fields.map((f, i) => (
                          <tr key={f.id} className="h-9">
                            {(['make', 'model', 'variant'] as const).map((k) => <td key={k} className={td}><Input className={cellInput} readOnly={ro} {...register(`vehicles.${i}.${k}`)} /></td>)}
                            {(['yearFrom', 'yearTo'] as const).map((k) => <td key={k} className={`${td} w-20`}><NumberInput className={cellInput} readOnly={ro} {...register(`vehicles.${i}.${k}`)} /></td>)}
                            {(['engine', 'fuel', 'transmission'] as const).map((k) => <td key={k} className={td}><Input className={cellInput} readOnly={ro} {...register(`vehicles.${i}.${k}`)} /></td>)}
                            <td className={`${td} text-center`}>{!ro && <IconButton icon={X} label="Remove" variant="danger" onClick={() => vh.remove(i)} />}</td>
                          </tr>
                        ))}
                        {vh.fields.length === 0 && <tr><td colSpan={9} className="p-3 text-center text-ink-faint">No equipment linked</td></tr>}
                      </tbody>
                    </table>
                    {!ro && <Button className="mt-2" icon={Plus} onClick={() => vh.append({ make: '', model: '', variant: '', yearFrom: '', yearTo: '', engine: '', fuel: '', transmission: '' })}>Add Equipment</Button>}
                  </div>
                ),
              },
              {
                key: 'pricing',
                label: 'Pricing & Stock',
                content: (
                  <HeaderSection title="Pricing & Stock Levels" columns={4} className="border-0">
                    <Field label="Cost Price"><NumberInput {...register('costPrice')} readOnly={ro} /></Field>
                    <Field label="Average Cost" hint="System maintained"><NumberInput {...register('averageCost')} readOnly /></Field>
                    <Field label="Last Purchase Price" hint="System maintained"><NumberInput {...register('lastPurchasePrice')} readOnly={!doc.isNew} /></Field>
                    <Field label="VAT Rate %"><NumberInput {...register('vatRate')} readOnly={ro} /></Field>
                    <Field label="Retail Price"><NumberInput {...register('retailPrice')} readOnly={ro} /></Field>
                    <Field label="Wholesale Price"><NumberInput {...register('wholesalePrice')} readOnly={ro} /></Field>
                    <div />
                    <div />
                    <Field label="Minimum Stock"><NumberInput {...register('minStock')} readOnly={ro} /></Field>
                    <Field label="Maximum Stock"><NumberInput {...register('maxStock')} readOnly={ro} /></Field>
                    <Field label="Reorder Level"><NumberInput {...register('reorderLevel')} readOnly={ro} /></Field>
                  </HeaderSection>
                ),
              },
              {
                key: 'dims',
                label: 'Dimensions',
                content: (
                  <HeaderSection title="Dimensions & Origin" columns={4} className="border-0">
                    <Field label="Weight (kg)"><NumberInput {...register('weight')} readOnly={ro} /></Field>
                    <Field label="Length (cm)"><NumberInput {...register('length')} readOnly={ro} /></Field>
                    <Field label="Width (cm)"><NumberInput {...register('width')} readOnly={ro} /></Field>
                    <Field label="Height (cm)"><NumberInput {...register('height')} readOnly={ro} /></Field>
                    <Field label="Country of Origin"><Input {...register('countryOfOrigin')} readOnly={ro} /></Field>
                    <Field label="Warranty"><Input {...register('warranty')} readOnly={ro} placeholder="e.g. 12 months" /></Field>
                  </HeaderSection>
                ),
              },
              {
                key: 'supplier',
                label: 'Supplier & Location',
                content: (
                  <HeaderSection title="Supplier & Location" columns={4} className="border-0">
                    <Field label="Primary Supplier" className="col-span-2"><Select options={suppliers.options} placeholder="-" disabled={ro} {...register('primarySupplierId')} /></Field>
                    <Field label="Default Warehouse" className="col-span-2"><Select options={warehouses.options} placeholder="-" disabled={ro} {...register('defaultWarehouseId')} /></Field>
                    <Field label="Rack"><Input {...register('rack')} readOnly={ro} /></Field>
                    <Field label="Shelf"><Input {...register('shelf')} readOnly={ro} /></Field>
                    <Field label="Bin"><Input {...register('bin')} readOnly={ro} /></Field>
                  </HeaderSection>
                ),
              },
              {
                key: 'stock',
                label: 'Stock by Warehouse',
                hidden: doc.isNew,
                content: (
                  <div className="p-3">
                    <table className="w-full max-w-[860px] border-collapse text-[13px]">
                      <thead><tr className="bg-surface-2"><th className={th}>Warehouse</th><th className={`${th} text-right`}>On Hand</th><th className={`${th} text-right`}>Reserved</th><th className={`${th} text-right`}>Available</th><th className={`${th} text-right`}>Avg Cost</th><th className={`${th} text-right`}>Value</th></tr></thead>
                      <tbody>
                        {(d?.balances ?? []).length === 0 && <tr><td colSpan={6} className="p-3 text-center text-ink-faint">No stock records</td></tr>}
                        {(d?.balances ?? []).map((b) => (
                          <tr key={b.warehouseId} className="h-9 cursor-pointer hover:bg-brand-soft" onDoubleClick={() => open('stock-ledger', { productId: d?.id, warehouseId: b.warehouseId, productLabel: `${d?.code} - ${d?.name}` })}>
                            <td className="grid-td px-1">{b.warehouse ? `${b.warehouse.code} - ${b.warehouse.name}` : b.warehouseId}</td>
                            <td className="grid-td px-1 text-right tabular-nums">{fmt.qty(b.onHand)}</td>
                            <td className="grid-td px-1 text-right tabular-nums">{fmt.qty(b.reserved)}</td>
                            <td className="grid-td px-1 text-right tabular-nums">{fmt.qty(b.available)}</td>
                            <td className="grid-td px-1 text-right tabular-nums">{fmt.money(b.avgCost)}</td>
                            <td className="grid-td px-1 text-right tabular-nums">{fmt.money(b.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {d && (
                        <tfoot><tr className="bg-surface-2 font-semibold"><td className="grid-td px-1">Total</td><td className="grid-td px-1 text-right">{fmt.qty(d.onHand)}</td><td className="grid-td px-1 text-right">{fmt.qty(d.reserved)}</td><td className="grid-td px-1 text-right">{fmt.qty(d.available)}</td><td className="grid-td" /><td className="grid-td px-1 text-right">{fmt.money(d.stockValue)}</td></tr></tfoot>
                      )}
                    </table>
                    <div className="mt-1 text-xs text-ink-faint">Double-click a row to open the stock ledger for that warehouse.</div>
                  </div>
                ),
              },
              {
                key: 'history',
                label: 'History',
                hidden: doc.isNew,
                content: (
                  <div className="space-y-3 p-3">
                    <div>
                      <div className="mb-1 text-xs font-bold uppercase text-brand">Last Purchases</div>
                      <HistTable rows={purchaseHist} party="Supplier" />
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold uppercase text-brand">Last Sales</div>
                      <HistTable rows={salesHist} party="Customer" />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      <RevisionHistory entity="Product" id={d?.id} />
      </DocumentLayout>
      <ConfirmDialog
        open={confirmDel}
        danger
        title="Delete product"
        message="Delete this product? If it has transactions it will be deactivated instead."
        confirmLabel="Delete"
        loading={doc.removing}
        onConfirm={remove}
        onCancel={() => setConfirmDel(false)}
      />
    </FormProvider>
  );
}

export default [
  { id: 'products', title: 'Products', icon: Package, component: ProductsScreen, permission: 'products' },
  { id: 'product-form', title: 'Product', icon: Package, component: ProductForm, multiInstance: true, permission: 'products' },
] satisfies ScreenDef[];
