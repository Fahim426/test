import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Send } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { Badge, Button, Checkbox, ErrorState, Field, Input, LoadingBlock, NumberInput, Panel, Select } from '@/components/ui';

export interface ServiceField {
  key: string; // full key, e.g. email.host
  label: string;
  kind?: 'text' | 'number' | 'password' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
}

type Values = Record<string, string>;
interface TestResult {
  ok: boolean;
  sent: boolean;
  message: string;
  errors: string[];
}

/** Form for the /settings/email and /settings/sms endpoints (flat `prefix.key` string maps; secrets come back masked). */
export function ServiceSettingsForm({
  service, title, fields, testLabel, testToLabel, testToPlaceholder, tabId,
}: {
  service: 'email' | 'sms';
  title: string;
  fields: ServiceField[];
  testLabel: string;
  testToLabel: string;
  testToPlaceholder: string;
  tabId: string;
}) {
  const can = usePermission();
  const qc = useQueryClient();
  const ws = useWorkspace();
  const canEdit = can('settings', 'edit');
  const [vals, setVals] = useState<Values>({});
  const [orig, setOrig] = useState<Values>({});
  const [to, setTo] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);

  const q = useQuery({ queryKey: ['admin', 'settings', service], queryFn: async () => (await api.get<Values>(`/settings/${service}`)).data });
  useEffect(() => {
    if (q.data) {
      setVals({ ...q.data });
      setOrig({ ...q.data });
    }
  }, [q.data]);

  const dirty = fields.some((f) => (vals[f.key] ?? '') !== (orig[f.key] ?? ''));
  useEffect(() => {
    ws.setDirty(tabId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, tabId]);

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body: Values = {};
      for (const f of fields) body[f.key] = vals[f.key] ?? '';
      return (await api.put<Values>(`/settings/${service}`, body)).data;
    },
    onSuccess: (d) => {
      toast.success(`${title} saved`);
      setVals({ ...d });
      setOrig({ ...d });
      qc.setQueryData(['admin', 'settings', service], d);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const test = useMutation({
    mutationFn: async () => (await api.post<TestResult>(`/settings/${service}/test`, to.trim() ? { to: to.trim() } : {})).data,
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error(apiError(e)),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="max-w-[760px] space-y-3">
        <Panel
          title={title}
          right={dirty ? <Badge tone="amber">Unsaved changes</Badge> : undefined}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div className="col-span-2">
              <Checkbox
                label={`Enable ${service === 'email' ? 'email' : 'SMS'} notifications`}
                disabled={!canEdit}
                checked={vals[`${service}.enabled`] === 'true'}
                onChange={(e) => set(`${service}.enabled`, e.target.checked ? 'true' : 'false')}
              />
            </div>
            {fields.map((f) => {
              const v = vals[f.key] ?? '';
              let ctl;
              if (f.kind === 'boolean') ctl = <Checkbox label={f.label} disabled={!canEdit} checked={v === 'true'} onChange={(e) => set(f.key, e.target.checked ? 'true' : 'false')} />;
              else if (f.kind === 'select') ctl = <Select disabled={!canEdit} value={v} options={f.options} placeholder="" onChange={(e) => set(f.key, e.target.value)} />;
              else if (f.kind === 'number') ctl = <NumberInput disabled={!canEdit} value={v} onChange={(e) => set(f.key, e.target.value)} />;
              else ctl = <Input type={f.kind === 'password' ? 'password' : 'text'} autoComplete="off" disabled={!canEdit} placeholder={f.placeholder} value={v} onChange={(e) => set(f.key, e.target.value)} />;
              return f.kind === 'boolean' ? (
                <div key={f.key} className="flex items-end pb-1">{ctl}</div>
              ) : (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {ctl}
                </Field>
              );
            })}
          </div>
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
              <Button disabled={!dirty} onClick={() => setVals({ ...orig })}>Revert</Button>
            </div>
          )}
        </Panel>
        {canEdit && (
          <Panel title="Test configuration">
            <div className="flex items-end gap-2">
              <Field label={testToLabel} className="w-64">
                <Input value={to} placeholder={testToPlaceholder} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button icon={Send} loading={test.isPending} disabled={dirty} onClick={() => test.mutate()}>{testLabel}</Button>
              {dirty && <span className="text-[11px] text-slate-500">Save first to test the stored configuration.</span>}
            </div>
            {result && (
              <div className={`mt-2 rounded border px-2 py-1 text-[12px] ${result.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {result.message}
                {result.errors.length > 0 && <ul className="ml-4 list-disc">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
