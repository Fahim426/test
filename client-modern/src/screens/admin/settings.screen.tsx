import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, Plus, RotateCcw, Save, Settings, Trash2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { Badge, Button, ConfirmDialog, ErrorState, IconButton, Input, LoadingBlock, Toolbar } from '@/components/ui';
import { ServiceSettingsForm } from './ServiceSettingsForm';

type Values = Record<string, string>;
const KEY_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const SECRET = /(password|secret|apikey|api_key|token)$/i;
const MASK = '********';
const groupOf = (k: string) => {
  const i = k.indexOf('.');
  return i > 0 ? k.slice(0, i) : 'general';
};
const HINTS: Record<string, string> = {
  'company.baseCurrency': 'e.g. AED',
  'vat.defaultRate': 'Default VAT percentage',
  'decimals.amount': 'Decimals for amounts',
};

function SystemSettingsScreen({ tabId }: ScreenProps) {
  const can = usePermission();
  const qc = useQueryClient();
  const ws = useWorkspace();
  const canEdit = can('settings', 'edit');
  const [vals, setVals] = useState<Values>({});
  const [orig, setOrig] = useState<Values>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['admin', 'settings', 'all'], queryFn: async () => (await api.get<Values>('/settings')).data });
  useEffect(() => {
    if (q.data) {
      setVals({ ...q.data });
      setOrig({ ...q.data });
    }
  }, [q.data]);

  // email.* / sms.* have their own screens
  const keys = useMemo(() => Object.keys(vals).filter((k) => !k.startsWith('email.') && !k.startsWith('sms.')).sort(), [vals]);
  const groups = useMemo(() => {
    const g: Record<string, string[]> = {};
    keys.forEach((k) => (g[groupOf(k)] ??= []).push(k));
    return Object.entries(g).sort(([a], [b]) => (a === 'general' ? -1 : b === 'general' ? 1 : a.localeCompare(b)));
  }, [keys]);

  const changed = keys.filter((k) => vals[k] !== orig[k]);
  const dirty = changed.length > 0;
  useEffect(() => {
    ws.setDirty(tabId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, tabId]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Values = {};
      changed.forEach((k) => (body[k] = vals[k]));
      return (await api.put<Values>('/settings', { settings: body })).data;
    },
    onSuccess: (d) => {
      toast.success('Settings saved');
      setVals({ ...d });
      setOrig({ ...d });
      qc.setQueryData(['admin', 'settings', 'all'], d);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: async (k: string) => (await api.delete(`/settings/${encodeURIComponent(k)}`)).data,
    onSuccess: () => {
      toast.success('Setting deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });

  const addKey = () => {
    const k = newKey.trim();
    if (!KEY_RE.test(k)) return toast.error('Key may contain letters, digits and . _ - only (max 100)');
    if (k.startsWith('email.') || k.startsWith('sms.')) return toast.error('Use the Email / SMS settings screens for those keys');
    if (k in vals) return toast.error('Key already exists');
    setVals((p) => ({ ...p, [k]: newVal }));
    setNewKey('');
    setNewVal('');
  };

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        {canEdit && (
          <>
            <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button icon={RotateCcw} disabled={!dirty} onClick={() => setVals({ ...orig })}>Revert</Button>
          </>
        )}
        {dirty && <Badge tone="amber">{changed.length} unsaved</Badge>}
        <span className="text-xs text-ink-muted">Secrets are masked; leave them unchanged to keep the stored value.</span>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="max-w-[860px] space-y-3">
          {groups.length === 0 && <div className="text-[13px] text-ink-muted">No settings stored yet. Add one below.</div>}
          {groups.map(([g, ks]) => (
            <section key={g} className="border border-line bg-surface rounded-lg">
              <div className="border-b border-line bg-brand-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-brand">{g}</div>
              <table className="w-full text-[13px]">
                <tbody>
                  {ks.map((k) => (
                    <tr key={k} className={vals[k] !== orig[k] ? 'h-9 bg-warning-soft' : 'h-9'}>
                      <td className="grid-td w-[260px] font-mono text-xs text-ink-muted" title={HINTS[k]}>{k}</td>
                      <td className="grid-td">
                        <Input
                          type={SECRET.test(k) ? 'password' : 'text'}
                          autoComplete="off"
                          disabled={!canEdit}
                          value={vals[k] ?? ''}
                          placeholder={SECRET.test(k) ? MASK : HINTS[k]}
                          onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))}
                        />
                      </td>
                      <td className="grid-td w-8">
                        {canEdit && k in orig && <IconButton icon={Trash2} variant="danger" label="Delete setting" onClick={() => setDeleting(k)} />}
                        {canEdit && !(k in orig) && <IconButton icon={Trash2} variant="danger" label="Discard" onClick={() => setVals((p) => { const n = { ...p }; delete n[k]; return n; })} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          {canEdit && (
            <section className="border border-line bg-surface p-3 rounded-card shadow-card">
              <div className="mb-1 text-xs font-medium text-ink-muted">Add setting (use a dotted key to group, e.g. company.baseCurrency)</div>
              <div className="flex gap-2">
                <Input className="w-64 font-mono" placeholder="group.key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                <Input className="flex-1" placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKey()} />
                <Button icon={Plus} onClick={addKey}>Add</Button>
              </div>
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete setting"
        message={`Delete setting "${deleting ?? ''}"? Unsaved edits on this screen are kept.`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

function EmailSettingsScreen({ tabId }: ScreenProps) {
  return (
    <ServiceSettingsForm
      tabId={tabId}
      service="email"
      title="SMTP / Email Settings"
      testLabel="Validate configuration"
      testToLabel="Test recipient (optional)"
      testToPlaceholder="name@example.com"
      fields={[
        { key: 'email.host', label: 'SMTP host', placeholder: 'smtp.example.com' },
        { key: 'email.port', label: 'Port', kind: 'number' },
        { key: 'email.username', label: 'Username' },
        { key: 'email.password', label: 'Password', kind: 'password' },
        { key: 'email.fromName', label: 'From name' },
        { key: 'email.fromAddress', label: 'From address', placeholder: 'no-reply@example.com' },
        { key: 'email.secure', label: 'Use SSL/TLS (secure)', kind: 'boolean' },
      ]}
    />
  );
}
function SmsSettingsScreen({ tabId }: ScreenProps) {
  return (
    <ServiceSettingsForm
      tabId={tabId}
      service="sms"
      title="SMS Gateway Settings"
      testLabel="Validate configuration"
      testToLabel="Test phone number (optional)"
      testToPlaceholder="+971500000000"
      fields={[
        { key: 'sms.provider', label: 'Provider' },
        { key: 'sms.apiUrl', label: 'API URL', placeholder: 'https://...' },
        { key: 'sms.apiKey', label: 'API key', kind: 'password' },
        { key: 'sms.senderId', label: 'Sender ID' },
      ]}
    />
  );
}

export default [
  { id: 'system-settings', title: 'System Settings', icon: Settings, component: SystemSettingsScreen, permission: 'settings' },
  { id: 'email-settings', title: 'Email Settings', icon: Mail, component: EmailSettingsScreen, permission: 'settings' },
  { id: 'sms-settings', title: 'SMS Settings', icon: MessageSquare, component: SmsSettingsScreen, permission: 'settings' },
] satisfies ScreenDef[];
