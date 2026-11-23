import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Power, Trash2, Users as UsersIcon } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError, apiFieldErrors, Paged } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { Badge, Button, Checkbox, ConfirmDialog, Field, Input, Modal, Select } from '@/components/ui';
import { Column, DataTable, RowAction } from '@/components/DataTable';

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  fullName: string;
  roleId: number;
  branchId: number | null;
  businessUnitId: number | null;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { id: number; name: string };
}
interface Named {
  id: number;
  name: string;
  code?: string;
}

const useRoleOptions = () =>
  useQuery({
    queryKey: ['admin', 'role-options'],
    queryFn: async () => (await api.get<Paged<Named>>('/roles')).data.rows,
    staleTime: 30_000,
  });
const useBranchOptions = () =>
  useQuery({
    queryKey: ['admin', 'branch-options'],
    queryFn: async () => (await api.get<Paged<Named>>('/branches', { params: { pageSize: 500 } })).data.rows,
    staleTime: 60_000,
  });

const useBuOptions = () =>
  useQuery({
    queryKey: ['admin', 'bu-options'],
    queryFn: async () => (await api.get<Paged<Named>>('/business-units', { params: { pageSize: 100 } })).data.rows,
    staleTime: 60_000,
  });

const baseShape = {
  username: z.string().trim().min(3, 'Min 3 characters').max(50).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  fullName: z.string().trim().min(1, 'Required').max(200),
  email: z.union([z.string().trim().email('Invalid email'), z.literal('')]),
  roleId: z.string().min(1, 'Role is required'),
  branchId: z.string(),
  businessUnitId: z.string(),
  isActive: z.boolean(),
};
const createSchema = z.object({ ...baseShape, password: z.string().min(6, 'At least 6 characters').max(100) });
const editSchema = z.object({ ...baseShape, password: z.union([z.string().min(6, 'At least 6 characters').max(100), z.literal('')]) });
type UserForm = z.infer<typeof createSchema>;

function UserModal({ row, onClose }: { row: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useRoleOptions();
  const branches = useBranchOptions();
  const bus = useBuOptions();
  const { register, handleSubmit, setError, formState } = useForm<UserForm>({
    resolver: zodResolver(row ? editSchema : createSchema),
    defaultValues: {
      username: row?.username ?? '',
      fullName: row?.fullName ?? '',
      email: row?.email ?? '',
      roleId: row ? String(row.roleId) : '',
      branchId: row?.branchId ? String(row.branchId) : '',
      businessUnitId: row?.businessUnitId ? String(row.businessUnitId) : '',
      isActive: row?.isActive ?? true,
      password: '',
    },
  });
  const save = useMutation({
    mutationFn: async (v: UserForm) => {
      const body: Record<string, unknown> = {
        username: v.username,
        fullName: v.fullName,
        email: v.email === '' ? null : v.email,
        roleId: Number(v.roleId),
        branchId: v.branchId ? Number(v.branchId) : null,
        businessUnitId: v.businessUnitId ? Number(v.businessUnitId) : null,
        isActive: v.isActive,
      };
      if (v.password) body.password = v.password;
      return row ? (await api.put(`/users/${row.id}`, body)).data : (await api.post('/users', body)).data;
    },
    onSuccess: () => {
      toast.success(row ? 'User saved' : 'User created');
      qc.invalidateQueries({ queryKey: ['table', 'admin-users'] });
      onClose();
    },
    onError: (e) => {
      Object.entries(apiFieldErrors(e)).forEach(([k, m]) => setError(k as keyof UserForm, { message: m }));
      toast.error(apiError(e));
    },
  });
  const err = (k: keyof UserForm) => formState.errors[k]?.message;
  return (
    <Modal
      open
      onClose={onClose}
      title={row ? `Edit User - ${row.username}` : 'New User'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Username" required error={err('username')}>
          <Input invalid={!!err('username')} autoFocus {...register('username')} />
        </Field>
        <Field label="Full name" required error={err('fullName')}>
          <Input invalid={!!err('fullName')} {...register('fullName')} />
        </Field>
        <Field label="Email" error={err('email')}>
          <Input invalid={!!err('email')} {...register('email')} />
        </Field>
        <Field label={row ? 'New password' : 'Password'} required={!row} error={err('password')} hint={row ? 'Leave blank to keep the current password' : undefined}>
          <Input type="password" autoComplete="new-password" invalid={!!err('password')} {...register('password')} />
        </Field>
        <Field label="Role" required error={err('roleId')}>
          <Select placeholder="Select role..." invalid={!!err('roleId')} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} {...register('roleId')} />
        </Field>
        <Field label="Branch" error={err('branchId')}>
          <Select placeholder="(none)" options={(branches.data ?? []).map((b) => ({ value: b.id, label: [b.code, b.name].filter(Boolean).join(' - ') }))} {...register('branchId')} />
        </Field>
        <Field label="Business Unit" hint="The one BU this user works in: documents they create belong to it and they see only its records. Leave empty for Admin (sees all)." error={err('businessUnitId')}>
          <Select placeholder="(none)" options={(bus.data ?? []).map((b) => ({ value: b.id, label: [b.code, b.name].filter(Boolean).join(' - ') }))} {...register('businessUnitId')} />
        </Field>
        <div className="col-span-2">
          <Checkbox label="Active" {...register('isActive')} />
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ row, onClose }: { row: UserRow; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [temp, setTemp] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean; temporaryPassword?: string }>(`/users/${row.id}/reset-password`, pw ? { password: pw } : {})).data,
    onSuccess: (r) => {
      if (r.temporaryPassword) setTemp(r.temporaryPassword);
      else {
        toast.success('Password reset');
        onClose();
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal
      open
      width="sm"
      onClose={onClose}
      title={`Reset password - ${row.username}`}
      footer={
        temp ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={m.isPending} disabled={pw.length > 0 && pw.length < 6} onClick={() => m.mutate()}>
              Reset
            </Button>
          </>
        )
      }
    >
      {temp ? (
        <div className="space-y-2 text-[13px]">
          <div>Temporary password (shown once):</div>
          <div className="select-all rounded-lg border border-line bg-surface-2 p-2 font-mono text-[13px]">{temp}</div>
        </div>
      ) : (
        <Field label="New password" hint="Leave blank to generate a temporary password. The user is signed out everywhere.">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

function UsersScreen() {
  const can = usePermission();
  const qc = useQueryClient();
  const roles = useRoleOptions();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [roleId, setRoleId] = useState('');
  const [active, setActive] = useState('');

  const toggle = useMutation({
    mutationFn: (r: UserRow) => api.post(`/users/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['table', 'admin-users'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (r: UserRow) => api.delete(`/users/${r.id}`),
    onSuccess: () => {
      toast.success('User deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['table', 'admin-users'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });

  const columns: Column<UserRow>[] = [
    { key: 'username', header: 'Username', width: 130 },
    { key: 'fullName', header: 'Full Name' },
    { key: 'email', header: 'Email' },
    { key: 'role.name', header: 'Role', sortable: false, width: 120 },
    { key: 'isActive', header: 'Status', sortable: false, width: 80, cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
    { key: 'lastLoginAt', header: 'Last Login', type: 'datetime', width: 140 },
  ];
  const actions: RowAction<UserRow>[] = [
    ...(can('users', 'edit')
      ? [
          { label: 'Edit', icon: Pencil, onClick: (r: UserRow) => setEditing(r) },
          { label: 'Reset password', icon: KeyRound, onClick: (r: UserRow) => setResetting(r) },
          { label: 'Activate / deactivate', icon: Power, onClick: (r: UserRow) => toggle.mutate(r) },
        ]
      : []),
    ...(can('users', 'delete') ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: (r: UserRow) => setDeleting(r) }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <DataTable<UserRow>
        tableKey="admin-users"
        queryKey="admin-users"
        url="/users"
        columns={columns}
        filters={{ roleId: roleId || undefined, isActive: active || undefined }}
        exportName="Users"
        rowActions={actions}
        onRowDoubleClick={(r) => can('users', 'edit') && setEditing(r)}
        searchPlaceholder="Search username, name, email..."
        toolbarExtras={
          <>
            {can('users', 'create') && (
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                New
              </Button>
            )}
            <Select className="w-36" placeholder="All roles" value={roleId} onChange={(e) => setRoleId(e.target.value)} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
            <Select
              className="w-28"
              placeholder="All status"
              value={active}
              onChange={(e) => setActive(e.target.value)}
              options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
            />
          </>
        }
      />
      {editing && <UserModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal row={resetting} onClose={() => setResetting(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete User"
        message={`Delete user "${deleting?.username ?? ''}"? This cannot be undone. Consider deactivating instead.`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

export default [{ id: 'users', title: 'Users', icon: UsersIcon, component: UsersScreen, permission: 'users' }] satisfies ScreenDef[];
