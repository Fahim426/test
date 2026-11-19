import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Settings, Save } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { useProductConfig, featureOptions, ProductConfig } from '@/hooks/useProductConfig';
import type { ScreenDef, ScreenProps } from '@/screens/types';
const control = 'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:opacity-60';
function CompanyConfiguration({ tabId }: ScreenProps) {
  const q = useProductConfig(),
    qc = useQueryClient(),
    can = usePermission(),
    ws = useWorkspace();
  const editable = can('settings', 'edit');
  const [form, setForm] = useState<ProductConfig>(),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(q.data);
  useEffect(() => ws.setDirty(tabId, dirty), [dirty, tabId]);
  const refresh = (c: ProductConfig) => {
    qc.setQueryData(['product-config'], c);
    qc.invalidateQueries({ queryKey: ['company'] });
    qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    setForm(c);
  };
  const save = async () => {
    if (!form?.company) return;
    setSaving(true);
    try {
      const c = form.company;
      const b = {
        company: {
          name: c.name,
          address: c.address || '',
          phone: c.phone || '',
          email: c.email || '',
          trn: c.trn || '',
          country: c.country || '',
        },
        appName: form.appName,
        productLabel: form.productLabel,
        compatibilityLabel: form.compatibilityLabel,
        industry: form.industry,
        features: form.features,
      };
      refresh((await api.put<ProductConfig>('/product-config', b)).data);
      toast.success('Company and modules saved');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };
  const upload = async (chosen?: File) => {
    if (!chosen) return;
    if (chosen.size > 5 * 1024 * 1024) {
      toast.error('Choose a logo up to 5 MB');
      return;
    }
    if (dirty) {
      toast.warning('Save your company changes before changing the logo.');
      return;
    }
    setUploading(true);
    try {
      const b = new FormData();
      b.append('file', chosen);
      refresh((await api.post<ProductConfig>('/product-config/logo', b)).data);
      toast.success('Company logo updated');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };
  if (q.isLoading) return <div className="p-4">Loading company configuration...</div>;
  if (q.isError || !form)
    return (
      <div className="p-4">
        Could not load configuration. <button onClick={() => void q.refetch()}>Retry</button>
      </div>
    );
  const company = (key: string, value: string) => setForm({ ...form, company: { ...form.company!, [key]: value } });
  const preset = (kind: ProductConfig['industry']) => {
    const equipment = kind === 'equipment',
      parts = kind === 'spare-parts';
    setForm({
      ...form,
      industry: kind,
      productLabel: equipment ? 'Machine' : parts ? 'Part' : 'Product',
      compatibilityLabel: parts ? 'Vehicle Compatibility' : 'Equipment Compatibility',
      features: {
        ...form.features,
        partNumbers: parts,
        vehicleCompatibility: parts,
        amc: equipment,
        serialTracking: equipment,
        productImages: true,
      },
    });
  };
  return (
    <div className="h-full overflow-auto bg-white p-4 text-gray-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Company &amp; Modules</h1>
          {editable && (
            <button
              onClick={() => void save()}
              disabled={!dirty || saving || uploading}
              className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save configuration'}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Settings apply to this customer deployment. Switching a module off keeps its records and blocks its screens
          and direct module APIs. Existing issued invoice PDFs stay unchanged.
        </p>
        <fieldset disabled={!editable || saving || uploading} className="space-y-5">
          <section>
            <h2 className="mb-3 font-semibold">Company branding</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['name', 'Company name'],
                ['address', 'Address'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['trn', 'TRN (optional)'],
                ['country', 'Country'],
              ].map(([key, label]) => (
                <label key={key} className="text-xs">
                  {label}
                  <input
                    aria-label={label}
                    className={control}
                    value={String((form.company as any)?.[key] || '')}
                    onChange={(e) => company(key, e.target.value)}
                  />
                </label>
              ))}
              <label className="text-xs">
                Application name
                <input
                  aria-label="Application name"
                  className={control}
                  value={form.appName}
                  onChange={(e) => setForm({ ...form, appName: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Base currency
                <input className={control} value={form.company?.baseCurrency || 'AED'} readOnly />
                <span className="text-gray-500">
                  Accounting currency is managed separately; changing branding does not convert balances.
                </span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {form.logoDataUri && (
                <img
                  src={form.logoDataUri}
                  alt="Current company logo"
                  className="h-20 w-44 rounded border object-contain"
                />
              )}
              <input
                ref={file}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                aria-label="Company logo file"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
              <button
                type="button"
                className={control + ' !w-auto'}
                disabled={dirty || uploading}
                onClick={() => file.current?.click()}
              >
                {uploading ? 'Uploading...' : 'Upload company logo'}
              </button>
              {form.logoDataUri && (
                <button
                  className="text-xs underline"
                  disabled={dirty || uploading}
                  onClick={async () => {
                    setUploading(true);
                    try {
                      refresh((await api.delete<ProductConfig>('/product-config/logo')).data);
                    } catch (e) {
                      toast.error(apiError(e));
                    } finally {
                      setUploading(false);
                    }
                  }}
                >
                  Remove logo
                </button>
              )}
              <span className="text-xs text-gray-500">Save changes first. Logo uploads are saved immediately.</span>
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Industry and terminology</h2>
            <p className="mb-2 text-xs text-gray-500">
              A preset changes the draft switches below. Review and Save configuration to apply.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                ['equipment', 'Equipment trading'],
                ['spare-parts', 'Spare parts'],
                ['general', 'General trading'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  onClick={() => preset(key as ProductConfig['industry'])}
                >
                  Use {label} preset
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                Product label
                <input
                  aria-label="Product label"
                  className={control}
                  value={form.productLabel}
                  onChange={(e) => setForm({ ...form, productLabel: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Compatibility label
                <input
                  aria-label="Compatibility label"
                  className={control}
                  value={form.compatibilityLabel}
                  onChange={(e) => setForm({ ...form, compatibilityLabel: e.target.value })}
                />
              </label>
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Optional modules and features</h2>
            <div className="divide-y rounded border">
              {featureOptions.map((o) => (
                <label key={o.key} className="flex items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    aria-label={o.label}
                    checked={form.features[o.key]}
                    onChange={(e) => setForm({ ...form, features: { ...form.features, [o.key]: e.target.checked } })}
                  />
                  <span>
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="text-xs text-gray-500">{o.hint}</span>
                  </span>
                  <span className="ml-auto text-xs">{form.features[o.key] ? 'ON' : 'OFF'}</span>
                </label>
              ))}
            </div>
          </section>
        </fieldset>
        <p className="text-xs text-gray-500">
          Sales, purchasing, inventory and accounting remain core modules. Role permissions still apply. For a new
          customer, deploy the same code with a separate database and storage; do not reuse this demo database.
        </p>
      </div>
    </div>
  );
}
export default [
  {
    id: 'company-configuration',
    title: 'Company & Modules',
    icon: Settings,
    component: CompanyConfiguration,
    permission: 'settings',
  },
] satisfies ScreenDef[];
