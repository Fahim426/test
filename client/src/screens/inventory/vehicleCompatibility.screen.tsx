import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench, Plus, Search } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { ProductPicker, ProductLookup } from '@/components/doc';
import { Button, Field, Input, NumberInput, Panel } from '@/components/ui';
import { api, apiError, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { useOpenScreen } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { numOrNull, strOrNull } from '@/components/inventory/common';

interface Veh {
  make: string; model: string; variant?: string | null; yearFrom?: number | null; yearTo?: number | null; engine?: string | null; fuel?: string | null; transmission?: string | null;
}
interface Row {
  id: number; code: string; name: string; oemNumber?: string | null; brand?: { name: string } | null; category?: { name: string } | null;
  onHand: number; reserved: number; available: number; matchedVehicles?: Veh[];
}

const yrs = (v: Veh) => (v.yearFrom || v.yearTo ? `${v.yearFrom ?? ''}-${v.yearTo ?? ''}` : '');
const vehLabel = (v: Veh) => [v.make, v.model, v.variant, yrs(v), v.engine, v.fuel, v.transmission].filter(Boolean).join(' ');

function VehicleCompatibilityScreen() {
  const open = useOpenScreen();
  const can = usePermission();
  const qc = useQueryClient();
  const [f, setF] = useState({ make: '', model: '', variant: '', year: '', engine: '', fuel: '' });
  const [applied, setApplied] = useState(f);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const hasCriteria = !!(applied.make.trim() || applied.model.trim() || applied.year.trim());

  const makes = useQuery({ queryKey: ['veh-makes'], staleTime: 60_000, queryFn: async () => (await api.get<string[]>('/products/vehicle-makes')).data });
  const models = useQuery({
    queryKey: ['veh-models', f.make],
    staleTime: 60_000,
    queryFn: async () => (await api.get<string[]>('/products/vehicle-models', { params: { make: f.make || undefined } })).data,
  });

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', width: 110, sortable: false },
    { key: 'oemNumber', header: 'Mfr Part No', width: 130, sortable: false },
    { key: 'name', header: 'Description', sortable: false },
    { key: 'brand.name', header: 'Brand', width: 110, sortable: false },
    { key: 'category.name', header: 'Category', width: 110, sortable: false },
    {
      key: 'matchedVehicles', header: 'Compatible Equipment', sortable: false, width: 320,
      cell: (r) => <span title={(r.matchedVehicles ?? []).map(vehLabel).join('\n')}>{(r.matchedVehicles ?? []).map(vehLabel).join('; ')}</span>,
      exportValue: (r) => (r.matchedVehicles ?? []).map(vehLabel).join('; '),
    },
    { key: 'onHand', header: 'On Hand', type: 'qty', width: 80, sortable: false },
    { key: 'available', header: 'Available', type: 'qty', width: 80, sortable: false, cell: (r) => <span className={r.available <= 0 ? 'text-red-600' : ''}>{fmt.qty(r.available)}</span> },
  ];

  // ---- maintenance: link a vehicle to a product
  const [prod, setProd] = useState<ProductLookup | null>(null);
  const [nv, setNv] = useState({ make: '', model: '', variant: '', yearFrom: '', yearTo: '', engine: '', fuel: '', transmission: '' });
  const [saving, setSaving] = useState(false);
  const setN = (k: keyof typeof nv) => (e: React.ChangeEvent<HTMLInputElement>) => setNv((s) => ({ ...s, [k]: e.target.value }));
  const addVehicle = async () => {
    if (!prod) return toast.warning('Pick a product first');
    if (!nv.make.trim() || !nv.model.trim()) return toast.warning('Brand and equipment model are required');
    setSaving(true);
    try {
      const cur = (await api.get<{ vehicles?: (Veh & { id?: number; productId?: number })[] }>(`/products/${prod.id}`)).data;
      const keep = (cur.vehicles ?? []).map((v) => ({ make: v.make, model: v.model, variant: v.variant ?? null, yearFrom: v.yearFrom ?? null, yearTo: v.yearTo ?? null, engine: v.engine ?? null, fuel: v.fuel ?? null, transmission: v.transmission ?? null }));
      keep.push({ make: nv.make.trim(), model: nv.model.trim(), variant: strOrNull(nv.variant), yearFrom: numOrNull(nv.yearFrom), yearTo: numOrNull(nv.yearTo), engine: strOrNull(nv.engine), fuel: strOrNull(nv.fuel), transmission: strOrNull(nv.transmission) });
      await api.put(`/products/${prod.id}`, { vehicles: keep });
      toast.success(`Equipment linked to ${prod.code}`);
      setNv({ make: '', model: '', variant: '', yearFrom: '', yearTo: '', engine: '', fuel: '', transmission: '' });
      qc.invalidateQueries({ queryKey: ['table'] });
      qc.invalidateQueries({ queryKey: ['doc', '/products'] });
      qc.invalidateQueries({ queryKey: ['veh-makes'] });
      qc.invalidateQueries({ queryKey: ['veh-models'] });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-app-border bg-white p-2">
        <Panel title="Find products by equipment" bodyClassName="flex flex-wrap items-end gap-2">
          <datalist id="veh-makes">{(makes.data ?? []).map((m) => <option key={m} value={m} />)}</datalist>
          <datalist id="veh-models">{(models.data ?? []).map((m) => <option key={m} value={m} />)}</datalist>
          <Field label="Brand"><Input list="veh-makes" className="w-32" value={f.make} onChange={set('make')} /></Field>
          <Field label="Equipment Model"><Input list="veh-models" className="w-32" value={f.model} onChange={set('model')} /></Field>
          <Field label="Configuration"><Input className="w-28" value={f.variant} onChange={set('variant')} /></Field>
          <Field label="Year"><NumberInput className="w-20" value={f.year} onChange={set('year')} /></Field>
          <Field label="Power / Specification"><Input className="w-24" value={f.engine} onChange={set('engine')} /></Field>
          <Field label="Technology"><Input className="w-24" value={f.fuel} onChange={set('fuel')} /></Field>
          <Button variant="primary" icon={Search} onClick={() => setApplied({ ...f })}>Search</Button>
          <Button onClick={() => { const e = { make: '', model: '', variant: '', year: '', engine: '', fuel: '' }; setF(e); setApplied(e); }}>Clear</Button>
        </Panel>
        {can('products', 'edit') && (
          <Panel title="Link equipment to a product" bodyClassName="flex flex-wrap items-end gap-2">
            <Field label="Product"><div className="w-64 border border-app-border"><ProductPicker text={prod ? `${prod.code} - ${prod.name}` : ''} onPick={setProd} onClear={() => setProd(null)} /></div></Field>
            <Field label="Brand *"><Input list="veh-makes" className="w-28" value={nv.make} onChange={setN('make')} /></Field>
            <Field label="Equipment Model *"><Input className="w-28" value={nv.model} onChange={setN('model')} /></Field>
            <Field label="Configuration"><Input className="w-24" value={nv.variant} onChange={setN('variant')} /></Field>
            <Field label="From"><NumberInput className="w-20" value={nv.yearFrom} onChange={setN('yearFrom')} /></Field>
            <Field label="To"><NumberInput className="w-20" value={nv.yearTo} onChange={setN('yearTo')} /></Field>
            <Field label="Power / Specification"><Input className="w-24" value={nv.engine} onChange={setN('engine')} /></Field>
            <Field label="Technology"><Input className="w-20" value={nv.fuel} onChange={setN('fuel')} /></Field>
            <Field label="Drive / Controller"><Input className="w-24" value={nv.transmission} onChange={setN('transmission')} /></Field>
            <Button icon={Plus} loading={saving} onClick={addVehicle}>Add</Button>
          </Panel>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <DataTable<Row>
          tableKey="vehicle-compat"
          queryKey="vehicle-compat"
          columns={columns}
          exportName="Equipment Compatibility"
          searchPlaceholder="Filter results by code / manufacturer part / name..."
          filters={{ ...applied }}
          fetcher={async (p): Promise<Paged<Row>> => {
            if (!hasCriteria) return { rows: [], total: 0, page: 1, pageSize: Number(p.pageSize) || 50 };
            const params: Record<string, unknown> = { page: p.page, pageSize: p.pageSize, search: p.search || undefined };
            for (const k of ['make', 'model', 'variant', 'year', 'engine', 'fuel'] as const) if (String(p[k] ?? '').trim()) params[k] = String(p[k]).trim();
            return (await api.get<Paged<Row>>('/products/by-vehicle', { params })).data;
          }}
          onRowDoubleClick={(r) => open('product-form', { id: r.id }, r.code)}
          rowActions={[{ label: 'Open Product', onClick: (r) => open('product-form', { id: r.id }, r.code) }]}
        />
      </div>
    </div>
  );
}

export default [{ id: 'vehicle-compatibility', title: 'Equipment Compatibility', icon: Wrench, component: VehicleCompatibilityScreen, permission: 'products' }] satisfies ScreenDef[];
