import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ChevronRight, Edit3, Lock, Plus, Power, Trash2, FolderTree, Truck, Users } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { fmt, today } from '@/lib/format';
import { usePermission } from '@/store/auth';
import { useOpenScreen } from '@/store/workspace';
import { toast } from '@/store/toast';
import { Badge, Button, Checkbox, ConfirmDialog, DateInput, Field, IconButton, Input, LoadingBlock, Modal, Select, ErrorState, Toolbar } from '@/components/ui';
import { AccountLite, ExportMenu, Money, RCol, printReport, useAccounts, ExportCfg } from '@/components/finance/common';
import { cn } from '@/lib/cn';
import { Printer } from 'lucide-react';

interface Node {
  id: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  isGroup: boolean;
  isBank: boolean;
  isActive: boolean;
  systemKey: string | null;
  level: number;
  balance?: number;
  signedBalance?: number;
  children: Node[];
}

type Side = 'CUSTOMER' | 'SUPPLIER';
interface PartyHead {
  partyType: Side;
  partyId: number | null;
  code: string;
  name: string;
  isActive: boolean;
  closing: number;
}
interface PartyHeads {
  rows: PartyHead[];
  unallocated: PartyHead | null;
}

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'];
const TYPE_LABEL: Record<string, string> = { ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity', REVENUE: 'Revenue', COGS: 'Cost of Goods Sold', EXPENSE: 'Expenses' };

interface FormState {
  id?: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  isGroup: boolean;
  isBank: boolean;
  isActive: boolean;
  systemKey?: string | null;
  hasLines?: boolean;
}

function flatten(nodes: Node[], open: Set<number>, q: string, showInactive: boolean, out: Node[] = []): Node[] {
  const matches = (n: Node): boolean => {
    if (!showInactive && !n.isActive) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return n.code.toLowerCase().includes(s) || n.name.toLowerCase().includes(s) || n.children.some(matches);
  };
  for (const n of nodes) {
    if (!matches(n)) continue;
    out.push(n);
    if (n.children.length && (q ? true : open.has(n.id))) flatten(n.children, open, q, showInactive, out);
  }
  return out;
}

function ChartOfAccountsScreen() {
  const qc = useQueryClient();
  const can = usePermission();
  const openScreen = useOpenScreen();
  const [asOf, setAsOf] = useState(today());
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [del, setDel] = useState<Node | null>(null);
  const accounts = useAccounts();

  const tree = useQuery({
    queryKey: ['fin-coa-tree', asOf],
    queryFn: async () => (await api.get<Node[]>('/accounts', { params: { tree: 1, balances: 1, asOf } })).data,
  });
  const roots = tree.data ?? [];
  const allIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (ns: Node[]) => ns.forEach((n) => { if (n.children.length) ids.push(n.id); walk(n.children); });
    walk(roots);
    return ids;
  }, [roots]);
  // initial expansion: first two levels
  const [inited, setInited] = useState(false);
  if (!inited && roots.length) {
    setInited(true);
    const s = new Set<number>();
    const walk = (ns: Node[], d: number) => ns.forEach((n) => { if (d < 2 && n.children.length) s.add(n.id); walk(n.children, d + 1); });
    walk(roots, 0);
    setOpen(s);
  }
  const rows = useMemo(() => flatten(roots, open, q, showInactive), [roots, open, q, showInactive]);

  // customer / supplier heads under Trade Debtors (AR) / Trade Creditors (AP), loaded when expanded (search filters them)
  const [partyOpen, setPartyOpen] = useState<Set<Side>>(new Set());
  const custHeads = useQuery({
    queryKey: ['fin-party-heads', 'CUSTOMER', asOf],
    enabled: partyOpen.has('CUSTOMER'),
    queryFn: async () => (await api.get<PartyHeads>('/ledger/party-heads', { params: { side: 'CUSTOMER', to: asOf } })).data,
  });
  const suppHeads = useQuery({
    queryKey: ['fin-party-heads', 'SUPPLIER', asOf],
    enabled: partyOpen.has('SUPPLIER'),
    queryFn: async () => (await api.get<PartyHeads>('/ledger/party-heads', { params: { side: 'SUPPLIER', to: asOf } })).data,
  });
  const sideOf = (n: Node): Side | null => (n.systemKey === 'AR' ? 'CUSTOMER' : n.systemKey === 'AP' ? 'SUPPLIER' : null);
  const headsFor = (side: Side) => {
    const d = side === 'CUSTOMER' ? custHeads.data : suppHeads.data;
    const all = [...(d?.rows ?? []), ...(d?.unallocated ? [d.unallocated] : [])];
    if (!q) return all;
    const s = q.toLowerCase();
    return all.filter((h) => h.code.toLowerCase().includes(s) || h.name.toLowerCase().includes(s));
  };
  const toggleParty = (side: Side) => setPartyOpen((x) => { const y = new Set(x); if (y.has(side)) y.delete(side); else y.add(side); return y; });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['fin-coa-tree'] });
    qc.invalidateQueries({ queryKey: ['fin-accounts-all'] });
    qc.invalidateQueries({ queryKey: ['table'] });
  };
  const toggleActive = useMutation({
    mutationFn: async (n: Node) => (await api.put(`/accounts/${n.id}`, { isActive: !n.isActive })).data,
    onSuccess: () => { toast.success('Account updated'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: async (n: Node) => (await api.delete(`/accounts/${n.id}`)).data,
    onSuccess: () => { toast.success('Account deleted'); setDel(null); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const newAccount = (parent?: Node) =>
    setForm({ code: '', name: '', type: parent?.type ?? 'ASSET', parentId: parent?.id ?? null, isGroup: false, isBank: false, isActive: true });
  const editAccount = async (n: Node) => {
    let hasLines = false;
    try {
      hasLines = ((await api.get<{ lineCount: number }>(`/accounts/${n.id}`)).data.lineCount ?? 0) > 0;
    } catch { /* ignore */ }
    setForm({ id: n.id, code: n.code, name: n.name, type: n.type, parentId: n.parentId, isGroup: n.isGroup, isBank: n.isBank, isActive: n.isActive, systemKey: n.systemKey, hasLines });
  };

  const cfg: ExportCfg<Node> = {
    title: 'Chart of Accounts',
    subtitle: `Balances as of ${fmt.date(asOf)}`,
    columns: [
      { key: 'code', header: 'Code', render: (r) => `${'   '.repeat(r.level)}${r.code}`, value: (r) => `${'  '.repeat(r.level)}${r.code}` },
      { key: 'name', header: 'Account Name' },
      { key: 'type', header: 'Type', value: (r) => fmt.status(r.type) },
      { key: 'kind', header: 'Kind', value: (r) => (r.isGroup ? 'Group' : r.isBank ? 'Bank' : 'Posting') },
      { key: 'balance', header: 'Balance', type: 'money', value: (r) => r.balance ?? 0 },
    ] as RCol<Node>[],
    rows,
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <Toolbar>
        {can('chart_of_accounts', 'create') && <Button variant="primary" icon={Plus} onClick={() => newAccount()}>New Account</Button>}
        <Button icon={FolderTree} onClick={() => setOpen(new Set(allIds))}>Expand all</Button>
        <Button onClick={() => setOpen(new Set())}>Collapse all</Button>
        <input className="ctl w-56" placeholder="Search code / name..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        <div className="flex-1" />
        <span className="text-xs text-ink-muted">Balances as of</span>
        <DateInput className="!w-32" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <ExportMenu cfg={cfg} />
        <Button icon={Printer} onClick={() => printReport(cfg)}>Print</Button>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        {tree.isLoading ? (
          <LoadingBlock />
        ) : tree.error ? (
          <ErrorState message={apiError(tree.error)} onRetry={() => tree.refetch()} />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="h-8">
                <th className="grid-th w-[360px]">Account</th>
                <th className="grid-th w-24">Type</th>
                <th className="grid-th w-24">Kind</th>
                <th className="grid-th w-36 text-right">Balance</th>
                <th className="grid-th w-20">Status</th>
                <th className="grid-th w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const isOpen = open.has(n.id) || !!q;
                const side = sideOf(n);
                const partiesOpen = !!side && partyOpen.has(side);
                const heads = side && partiesOpen ? headsFor(side) : [];
                const headsLoading = side === 'CUSTOMER' ? custHeads.isLoading : side === 'SUPPLIER' ? suppHeads.isLoading : false;
                return (
                  <Fragment key={n.id}>
                  <tr className={cn('h-8 hover:bg-brand-soft', n.level === 0 && 'bg-surface-2 font-semibold', !n.isActive && 'text-ink-faint')}>
                    <td className="grid-td">
                      <div className="flex items-center gap-1" style={{ paddingLeft: n.level * 16 }}>
                        {n.children.length ? (
                          <button className="text-ink-muted" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}>
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                        ) : side ? (
                          <button className="text-ink-muted" title={side === 'CUSTOMER' ? 'Show customers' : 'Show suppliers'} onClick={() => toggleParty(side)}>
                            {partiesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                        ) : (
                          <span className="inline-block w-[13px]" />
                        )}
                        <span className={cn('tabular-nums', n.isGroup ? 'font-semibold' : '')}>{n.code}</span>
                        <span className={cn(n.isGroup && 'font-semibold')}>{n.name}</span>
                        {n.systemKey && <Lock size={11} className="text-warning" aria-label="System account" />}
                      </div>
                    </td>
                    <td className="grid-td">{fmt.status(n.type)}</td>
                    <td className="grid-td">
                      {n.isGroup ? <Badge tone="blue">Group</Badge> : n.isBank ? <Badge tone="teal">Bank</Badge> : <Badge>Posting</Badge>}
                    </td>
                    <td className="grid-td text-right">
                      <Money v={n.balance} bold={n.isGroup} />
                    </td>
                    <td className="grid-td">{n.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                    <td className="grid-td">
                      <div className="flex items-center gap-0.5">
                        {!n.isGroup && <IconButton icon={BookOpen} label="Open ledger" onClick={() => openScreen('general-ledger', { accountId: n.id }, `GL ${n.code}`)} />}
                        {n.isGroup && can('chart_of_accounts', 'create') && <IconButton icon={Plus} label="Add child account" onClick={() => newAccount(n)} />}
                        {can('chart_of_accounts', 'edit') && <IconButton icon={Edit3} label="Edit" onClick={() => editAccount(n)} />}
                        {can('chart_of_accounts', 'edit') && !n.systemKey && <IconButton icon={Power} label={n.isActive ? 'Deactivate' : 'Activate'} onClick={() => toggleActive.mutate(n)} />}
                        {can('chart_of_accounts', 'delete') && !n.systemKey && <IconButton icon={Trash2} variant="danger" label="Delete" onClick={() => setDel(n)} />}
                      </div>
                    </td>
                  </tr>
                  {side && partiesOpen && headsLoading && (
                    <tr className="h-8"><td colSpan={6} className="grid-td text-xs text-ink-faint" style={{ paddingLeft: (n.level + 1) * 16 + 24 }}>Loading {side === 'CUSTOMER' ? 'customers' : 'suppliers'}...</td></tr>
                  )}
                  {side && partiesOpen && !headsLoading && heads.length === 0 && !q && (
                    <tr className="h-8"><td colSpan={6} className="grid-td text-xs text-ink-faint" style={{ paddingLeft: (n.level + 1) * 16 + 24 }}>No {side === 'CUSTOMER' ? 'customers' : 'suppliers'} with a balance.</td></tr>
                  )}
                  {heads.map((h) => (
                    <tr key={`${side}-${h.partyId ?? 'x'}`} className={cn('h-8 hover:bg-brand-soft', !h.partyId && 'italic text-warning', !h.isActive && 'text-ink-faint')}>
                      <td className="grid-td">
                        <div className="flex items-center gap-1" style={{ paddingLeft: (n.level + 1) * 16 + 14 }}>
                          <span className="tabular-nums text-ink-muted">{h.code}</span>
                          <span>{h.name}</span>
                        </div>
                      </td>
                      <td className="grid-td">{fmt.status(n.type)}</td>
                      <td className="grid-td">{h.partyId ? <Badge tone="purple">{side === 'CUSTOMER' ? 'Customer' : 'Supplier'}</Badge> : <Badge tone="amber">Difference</Badge>}</td>
                      <td className="grid-td text-right"><Money v={h.closing} /></td>
                      <td className="grid-td">{h.partyId ? (h.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>) : null}</td>
                      <td className="grid-td">
                        {h.partyId && (
                          <div className="flex items-center gap-0.5">
                            <IconButton icon={BookOpen} label="Open ledger" onClick={() => openScreen('general-ledger', { accountId: n.id, partyType: side ?? undefined, partyId: h.partyId ?? undefined }, `Ledger · ${h.name}`)} />
                            <IconButton icon={side === 'CUSTOMER' ? Users : Truck} label={side === 'CUSTOMER' ? 'Open customer' : 'Open supplier'} onClick={() => openScreen(side === 'CUSTOMER' ? 'customer-form' : 'supplier-form', { id: h.partyId ?? undefined }, h.name)} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-ink-faint">No accounts</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {form && <AccountModal form={form} accounts={accounts.data ?? []} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
      <ConfirmDialog
        open={!!del}
        danger
        title="Delete account"
        confirmLabel="Delete"
        loading={remove.isPending}
        message={<>Delete account <b>{del?.code} {del?.name}</b>? Accounts with postings cannot be deleted - deactivate them instead.</>}
        onConfirm={() => del && remove.mutate(del)}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}

function AccountModal({ form, accounts, onClose, onSaved }: { form: FormState; accounts: AccountLite[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<FormState>(form);
  const [saving, setSaving] = useState(false);
  const isSystem = !!f.systemKey;
  const parents = accounts.filter((a) => a.isGroup && a.type === f.type && a.id !== f.id);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) return toast.warning('Code and name are required');
    setSaving(true);
    try {
      const body = { code: f.code.trim(), name: f.name.trim(), type: f.type, parentId: f.parentId, isGroup: f.isGroup, isBank: f.isGroup ? false : f.isBank, isActive: f.isActive };
      if (f.id) await api.put(`/accounts/${f.id}`, body);
      else await api.post('/accounts', body);
      toast.success(f.id ? 'Account updated' : 'Account created');
      onSaved();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={f.id ? `Edit account ${form.code}` : 'New account'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save</Button></>}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {isSystem && <div className="col-span-2 rounded-lg border border-warning bg-warning-soft px-2 py-1 text-xs text-warning"><Lock size={11} className="mr-1 inline" />System account ({f.systemKey}): type, group status and activation are locked.</div>}
        <Field label="Code" required><Input value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type" required>
          <Select value={f.type} disabled={isSystem || !!f.hasLines} onChange={(e) => { set('type', e.target.value); set('parentId', null); }} options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Parent group" hint="Parent must be a group of the same type">
          <Select value={f.parentId ?? ''} onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : null)} placeholder="(top level)" options={parents.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
        </Field>
        <div className="col-span-2 flex flex-wrap gap-4">
          <Checkbox label="Group (heading) account" checked={f.isGroup} disabled={isSystem || (!!f.hasLines && !f.isGroup)} onChange={(e) => set('isGroup', e.target.checked)} />
          <Checkbox label="Bank account" checked={f.isBank && !f.isGroup} disabled={f.isGroup} onChange={(e) => set('isBank', e.target.checked)} />
          <Checkbox label="Active" checked={f.isActive} disabled={isSystem} onChange={(e) => set('isActive', e.target.checked)} />
        </div>
        {f.hasLines && <div className="col-span-2 text-xs text-ink-muted">This account has journal lines: its type cannot change and it cannot become a group.</div>}
      </div>
    </Modal>
  );
}

export default [{ id: 'chart-of-accounts', title: 'Chart of Accounts', icon: BookOpen, component: ChartOfAccountsScreen, permission: 'chart_of_accounts' }] satisfies ScreenDef[];
