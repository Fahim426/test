import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, ShieldCheck } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { api, apiError, Paged } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { Badge, Button, ErrorState, LoadingBlock, Toolbar } from '@/components/ui';
import { cn } from '@/lib/cn';

interface RoleLite {
  id: number;
  name: string;
  isSystem: boolean;
  permissionCount: number;
}
interface Catalog {
  modules: string[];
  actions: string[];
}
interface RolePerms {
  roleId: number;
  roleName: string;
  permissions: string[];
}

const GROUPS: { label: string; modules: string[] }[] = [
  { label: 'General', modules: ['dashboard'] },
  { label: 'Masters', modules: ['dimensions', 'customers', 'suppliers', 'products'] },
  {
    label: 'Purchase',
    modules: ['material_request', 'purchase_requisition', 'purchase_enquiry', 'supplier_quotation', 'comparative_statement', 'purchase_order', 'import_purchase', 'goods_receipt', 'landed_cost', 'purchase_invoice', 'purchase_return'],
  },
  { label: 'Sales', modules: ['sales_enquiry', 'sales_quotation', 'proforma_invoice', 'sales_order', 'picking', 'packing', 'delivery_note', 'sales_invoice', 'sales_return', 'sales_incentive'] },
  { label: 'Inventory', modules: ['stock', 'stock_transfer', 'stock_adjustment'] },
  { label: 'Finance', modules: ['chart_of_accounts', 'receipts', 'payments', 'journal', 'notes', 'ledger', 'vat'] },
  { label: 'Reports', modules: ['reports', 'report_builder'] },
  { label: 'Admin', modules: ['users', 'roles', 'settings', 'numbering', 'approvals', 'audit', 'import_export', 'backup'] },
];
const LABELS: Record<string, string> = {
  dimensions: 'Masters',
  chart_of_accounts: 'Chart of Accounts',
  receipts: 'Receipt Vouchers',
  payments: 'Payment Vouchers',
  journal: 'Journal Vouchers',
  notes: 'Debit / Credit Notes',
  ledger: 'Ledgers & Registers',
  vat: 'VAT',
  import_purchase: 'Import Purchase',
  picking: 'Picking',
  packing: 'Packing',
  audit: 'Audit Logs',
  import_export: 'Data Import / Export',
  numbering: 'Document Numbering',
  approvals: 'Approval Workflows',
  settings: 'System Settings',
  sales_incentive: 'Sales Targets & Incentive',
};
const label = (m: string) => LABELS[m] ?? m.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const aLabel = (a: string) => a.charAt(0).toUpperCase() + a.slice(1);

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function PermissionsScreen({ params, tabId }: ScreenProps) {
  const can = usePermission();
  const qc = useQueryClient();
  const ws = useWorkspace();
  const canEdit = can('roles', 'edit');
  const [roleId, setRoleId] = useState<number | null>(typeof params.roleId === 'number' ? params.roleId : params.roleId ? Number(params.roleId) : null);
  const [orig, setOrig] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<Set<string>>(new Set());

  const roles = useQuery({ queryKey: ['admin', 'roles-full'], queryFn: async () => (await api.get<Paged<RoleLite>>('/roles')).data.rows });
  const catalog = useQuery({ queryKey: ['admin', 'perm-catalog'], queryFn: async () => (await api.get<Catalog>('/permissions/catalog')).data, staleTime: 300_000 });
  const rp = useQuery({
    queryKey: ['admin', 'role-perms', roleId],
    enabled: roleId !== null,
    queryFn: async () => (await api.get<RolePerms>(`/roles/${roleId}/permissions`)).data,
  });

  useEffect(() => {
    if (roleId === null && roles.data?.length) setRoleId(roles.data[0].id);
  }, [roleId, roles.data]);
  useEffect(() => {
    if (rp.data) {
      const s = new Set(rp.data.permissions);
      setOrig(s);
      setCur(new Set(s));
    }
  }, [rp.data]);

  const dirty = !sameSet(orig, cur);
  useEffect(() => {
    ws.setDirty(tabId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, tabId]);

  const actions = catalog.data?.actions ?? [];
  const grouped = useMemo(() => {
    const all = new Set(catalog.data?.modules ?? []);
    const used = new Set<string>();
    const g = GROUPS.map((x) => ({ label: x.label, modules: x.modules.filter((m) => all.has(m)) }));
    g.forEach((x) => x.modules.forEach((m) => used.add(m)));
    const rest = [...all].filter((m) => !used.has(m));
    if (rest.length) g.push({ label: 'Other', modules: rest });
    return g.filter((x) => x.modules.length);
  }, [catalog.data]);
  const allModules = grouped.flatMap((g) => g.modules);

  const key = (m: string, a: string) => `${m}:${a}`;
  const set = (keys: string[], on: boolean) =>
    setCur((p) => {
      const n = new Set(p);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  const rowKeys = (m: string) => actions.map((a) => key(m, a));
  const colKeys = (a: string, mods = allModules) => mods.map((m) => key(m, a));
  const allOn = (keys: string[]) => keys.length > 0 && keys.every((k) => cur.has(k));
  const someOn = (keys: string[]) => keys.some((k) => cur.has(k));

  const save = useMutation({
    mutationFn: async () => (await api.put<{ ok: boolean; count: number }>(`/roles/${roleId}/permissions`, { permissions: [...cur] })).data,
    onSuccess: (r) => {
      toast.success(`Permissions saved (${r.count})`);
      setOrig(new Set(cur));
      qc.invalidateQueries({ queryKey: ['admin', 'role-perms', roleId] });
      qc.invalidateQueries({ queryKey: ['admin', 'roles-full'] });
      qc.invalidateQueries({ queryKey: ['table', 'admin-roles'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const switchRole = (id: number) => {
    if (id === roleId) return;
    if (dirty && !window.confirm('Discard unsaved permission changes?')) return;
    setRoleId(id);
  };

  const tri = (keys: string[]) => (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 accent-brand"
      disabled={!canEdit}
      checked={allOn(keys)}
      ref={(el) => {
        if (el) el.indeterminate = !allOn(keys) && someOn(keys);
      }}
      onChange={(e) => set(keys, e.target.checked)}
    />
  );

  const role = roles.data?.find((r) => r.id === roleId);
  const isAdmin = role?.name === 'Admin';

  if (roles.isError) return <ErrorState message={apiError(roles.error)} onRetry={() => roles.refetch()} />;
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <span className="text-[13px] font-semibold text-ink">Role:</span>
        <select className="ctl w-48" value={roleId ?? ''} onChange={(e) => switchRole(Number(e.target.value))}>
          {(roles.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {canEdit && (
          <>
            <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
            <Button icon={RotateCcw} disabled={!dirty} onClick={() => setCur(new Set(orig))}>
              Revert
            </Button>
            <Button onClick={() => set(allModules.flatMap(rowKeys), true)}>Select all</Button>
            <Button onClick={() => set(allModules.flatMap(rowKeys), false)}>Clear all</Button>
          </>
        )}
        {dirty && <Badge tone="amber">Unsaved changes</Badge>}
        <span className="ml-auto text-xs text-ink-muted">{cur.size} permissions granted</span>
      </Toolbar>
      {isAdmin && <div className="border-b border-warning bg-warning-soft px-3 py-1 text-xs text-warning">The Admin role always has full access regardless of this matrix.</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {catalog.isLoading || rp.isLoading ? (
          <LoadingBlock />
        ) : catalog.isError || rp.isError ? (
          <ErrorState message={apiError(catalog.error ?? rp.error)} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="grid-th text-left" style={{ minWidth: 220 }}>Module</th>
                <th className="grid-th w-12 text-center">All</th>
                {actions.map((a) => (
                  <th key={a} className="grid-th w-16 text-center">
                    <div>{aLabel(a)}</div>
                    {tri(colKeys(a))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <GroupRows key={g.label} group={g} actions={actions} cur={cur} canEdit={canEdit} tri={tri} rowKeys={rowKeys} colKeys={colKeys} set={set} keyOf={key} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function GroupRows({
  group, actions, cur, canEdit, tri, rowKeys, colKeys, set, keyOf,
}: {
  group: { label: string; modules: string[] };
  actions: string[];
  cur: Set<string>;
  canEdit: boolean;
  tri: (keys: string[]) => JSX.Element;
  rowKeys: (m: string) => string[];
  colKeys: (a: string, mods?: string[]) => string[];
  set: (keys: string[], on: boolean) => void;
  keyOf: (m: string, a: string) => string;
}) {
  const groupKeys = group.modules.flatMap(rowKeys);
  return (
    <>
      <tr className="bg-brand-soft">
        <td className="border-b border-line px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand">{group.label}</td>
        <td className="border-b border-line text-center">
          {tri(groupKeys)}
        </td>
        {actions.map((a) => (
          <td key={a} className="border-b border-line text-center">
            {tri(colKeys(a, group.modules))}
          </td>
        ))}
      </tr>
      {group.modules.map((m) => (
        <tr key={m} className="h-9 hover:bg-surface-2">
          <td className="grid-td pl-5">{label(m)}</td>
          <td className="grid-td text-center">
            {tri(rowKeys(m))}
          </td>
          {actions.map((a) => (
            <td key={a} className="grid-td text-center">
              <input
                type="checkbox"
                className={cn('h-3.5 w-3.5 accent-brand')}
                disabled={!canEdit}
                checked={cur.has(keyOf(m, a))}
                onChange={(e) => set([keyOf(m, a)], e.target.checked)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default [{ id: 'permissions', title: 'Roles & Permissions', icon: ShieldCheck, component: PermissionsScreen, permission: 'roles' }] satisfies ScreenDef[];
