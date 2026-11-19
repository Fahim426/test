import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError, apiFieldErrors } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useOpenScreen } from '@/store/workspace';
import { Badge, Button, ConfirmDialog, Field, Input, Modal, Textarea } from '@/components/ui';
import { Column, DataTable, RowAction } from '@/components/DataTable';

interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
}
const schema = z.object({ name: z.string().trim().min(2, 'Min 2 characters').max(60), description: z.string().trim().max(500) });
type RoleForm = z.infer<typeof schema>;

function RoleModal({ row, onClose }: { row: RoleRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, setError, formState } = useForm<RoleForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: row?.name ?? '', description: row?.description ?? '' },
  });
  const save = useMutation({
    mutationFn: async (v: RoleForm) => {
      const body = row?.isSystem ? { description: v.description } : v;
      return row ? (await api.put(`/roles/${row.id}`, body)).data : (await api.post('/roles', body)).data;
    },
    onSuccess: () => {
      toast.success('Role saved');
      qc.invalidateQueries({ queryKey: ['table', 'admin-roles'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e) => {
      Object.entries(apiFieldErrors(e)).forEach(([k, m]) => setError(k as keyof RoleForm, { message: m }));
      toast.error(apiError(e));
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={row ? `Edit Role - ${row.name}` : 'New Role'}
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Save</Button>
        </>
      }
    >
      <div className="space-y-2">
        <Field label="Name" required error={formState.errors.name?.message} hint={row?.isSystem ? 'System roles cannot be renamed' : undefined}>
          <Input autoFocus readOnly={row?.isSystem} invalid={!!formState.errors.name} {...register('name')} />
        </Field>
        <Field label="Description" error={formState.errors.description?.message}>
          <Textarea {...register('description')} />
        </Field>
      </div>
    </Modal>
  );
}

function RolesScreen() {
  const can = usePermission();
  const qc = useQueryClient();
  const open = useOpenScreen();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const del = useMutation({
    mutationFn: (r: RoleRow) => api.delete(`/roles/${r.id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['table', 'admin-roles'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });
  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      header: 'Role',
      width: 180,
      sortable: false,
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          {r.isSystem && <Lock size={11} className="text-ink-faint" />}
          {r.name}
        </span>
      ),
    },
    { key: 'description', header: 'Description', sortable: false },
    { key: 'isSystem', header: 'Type', sortable: false, width: 80, cell: (r) => (r.isSystem ? <Badge tone="blue">System</Badge> : <Badge>Custom</Badge>) },
    { key: 'userCount', header: 'Users', type: 'number', sortable: false, width: 70 },
    { key: 'permissionCount', header: 'Permissions', type: 'number', sortable: false, width: 90 },
  ];
  const actions: RowAction<RoleRow>[] = [
    ...(can('roles', 'edit')
      ? [
          { label: 'Edit', icon: Pencil, onClick: (r: RoleRow) => setEditing(r) },
          { label: 'Edit permissions', icon: ShieldCheck, onClick: (r: RoleRow) => open('permissions', { roleId: r.id }, 'Roles & Permissions') },
        ]
      : []),
    ...(can('roles', 'delete') ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: (r: RoleRow) => setDeleting(r), hidden: (r: RoleRow) => r.isSystem }] : []),
  ];
  return (
    <div className="flex h-full flex-col">
      <DataTable<RoleRow>
        tableKey="admin-roles"
        queryKey="admin-roles"
        url="/roles"
        columns={columns}
        rowActions={actions}
        exportName="Roles"
        noSearch
        onRowDoubleClick={(r) => can('roles', 'edit') && setEditing(r)}
        toolbarExtras={
          can('roles', 'create') ? (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>New</Button>
          ) : undefined
        }
      />
      {editing && <RoleModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete Role"
        message={`Delete role "${deleting?.name ?? ''}"?`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

export default [{ id: 'roles', title: 'Roles', icon: ShieldCheck, component: RolesScreen, permission: 'roles' }] satisfies ScreenDef[];
