import { ChangeEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Warehouse } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { MasterConfig, masterScreen } from '@/components/MasterDataScreen';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, SectionHeader } from '@/components/ui';
import { api, apiError } from '@/lib/api';
import { usePermission } from '@/store/auth';
import { toast } from '@/store/toast';

interface Loc {
  id: number;
  zone: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  code: string;
  isActive: boolean;
}
interface LocForm {
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  code: string;
  isActive: boolean;
}
const blank: LocForm = { zone: '', rack: '', shelf: '', bin: '', code: '', isActive: true };

function LocationsGrid({ warehouseId }: { warehouseId: number }) {
  const can = usePermission();
  const qc = useQueryClient();
  const key = ['warehouse-locations', warehouseId];
  const list = useQuery({ queryKey: key, queryFn: async () => (await api.get<Loc[]>(`/warehouses/${warehouseId}/locations`)).data });
  const [editing, setEditing] = useState<Loc | 'new' | null>(null);
  const [form, setForm] = useState<LocForm>(blank);
  const [deleting, setDeleting] = useState<Loc | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['table', 'warehouses'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = { zone: form.zone, rack: form.rack, shelf: form.shelf, bin: form.bin, code: form.code.trim() || undefined, isActive: form.isActive };
      if (editing && editing !== 'new') return (await api.put(`/warehouse-locations/${editing.id}`, body)).data;
      return (await api.post(`/warehouses/${warehouseId}/locations`, body)).data;
    },
    onSuccess: () => {
      toast.success('Location saved');
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: async (l: Loc) => (await api.delete(`/warehouse-locations/${l.id}`)).data,
    onSuccess: () => {
      toast.success('Location deleted');
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });

  const openEdit = (l: Loc | 'new') => {
    setForm(l === 'new' ? blank : { zone: l.zone ?? '', rack: l.rack ?? '', shelf: l.shelf ?? '', bin: l.bin ?? '', code: l.code, isActive: l.isActive });
    setEditing(l);
  };
  const set = (k: keyof LocForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'isActive' ? e.target.checked : e.target.value }));

  return (
    <div className="border border-line">
      <SectionHeader
        title="Locations (Zone / Rack / Shelf / Bin)"
        right={can('dimensions', 'create') ? <Button size="sm" icon={Plus} onClick={() => openEdit('new')}>Add</Button> : undefined}
      />
      {list.isLoading ? (
        <LoadingBlock />
      ) : !list.data?.length ? (
        <EmptyState title="No locations" />
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              {['Code', 'Zone', 'Rack', 'Shelf', 'Bin', 'Active', ''].map((h, i) => (
                <th key={i} className="grid-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data.map((l) => (
              <tr key={l.id} className="h-9 hover:bg-brand-soft">
                <td className="grid-td font-medium">{l.code}</td>
                <td className="grid-td">{l.zone}</td>
                <td className="grid-td">{l.rack}</td>
                <td className="grid-td">{l.shelf}</td>
                <td className="grid-td">{l.bin}</td>
                <td className="grid-td">{l.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="grid-td w-16 text-right">
                  {can('dimensions', 'edit') && <IconButton icon={Pencil} label="Edit" onClick={() => openEdit(l)} />}
                  {can('dimensions', 'delete') && <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => setDeleting(l)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New Location' : 'Edit Location'}
        width="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field label="Zone"><Input value={form.zone} onChange={set('zone')} /></Field>
          <Field label="Rack"><Input value={form.rack} onChange={set('rack')} /></Field>
          <Field label="Shelf"><Input value={form.shelf} onChange={set('shelf')} /></Field>
          <Field label="Bin"><Input value={form.bin} onChange={set('bin')} /></Field>
          <Field label="Code" hint="Blank = Zone-Rack-Shelf-Bin" className="col-span-2"><Input value={form.code} onChange={set('code')} /></Field>
          <Checkbox label="Active" checked={form.isActive} onChange={set('isActive')} />
        </div>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete Location"
        message={`Delete location "${deleting?.code ?? ''}"?`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

const cfg: MasterConfig = {
  tableKey: 'warehouses',
  title: 'Warehouse',
  url: '/warehouses',
  permission: 'dimensions',
  modalWidth: 'lg',
  fields: [
    { key: 'code', label: 'Code', required: true, maxLength: 40, readOnlyOnEdit: true, listWidth: 110 },
    { key: 'name', label: 'Name', required: true, maxLength: 200 },
    { key: 'branchId', label: 'Branch', type: 'select', optionsUrl: '/branches', listKey: 'branch.name' },
    { key: 'address', label: 'Address' },
    { key: 'isActive', label: 'Active', type: 'checkbox', listWidth: 80 },
  ],
  extraColumns: [
    { key: 'locationCount', header: 'Locations', type: 'number', sortable: false },
    { key: 'stockQty', header: 'Stock Qty', type: 'qty', sortable: false },
    { key: 'stockValue', header: 'Stock Value', type: 'money', sortable: false },
  ],
  renderExtra: (row) => <LocationsGrid warehouseId={row.id} />,
};

export default [{ id: 'warehouses', title: 'Warehouses', icon: Warehouse, component: masterScreen(cfg), permission: 'dimensions' }] satisfies ScreenDef[];
