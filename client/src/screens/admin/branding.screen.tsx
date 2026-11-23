import { useProductConfig } from '@/hooks/useProductConfig';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Building2, RotateCcw, Save } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { useCompany } from '@/hooks/useCompany';
import { Button, ErrorState, Field, Input, LoadingBlock, Toolbar } from '@/components/ui';
import { ImagePicker, blobToDataUrl, resizeImage } from '@/components/ui/ImagePicker';

interface Brand { name: string; arabicName: string; tagline: string; logo: string | null }
const DEFAULT_TAGLINE = 'ERP workspace';

/** The app-header preview, so users see the result before saving. */
function HeaderPreview({ b, dark }: { b: Brand; dark?: boolean }) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex w-[300px] items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-ink">
        {b.logo ? (
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-xl">
            <img src={b.logo} alt="" className="h-full w-full object-contain" />
          </span>
        ) : (
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-brand-600 to-violet-600 text-white">
            <Boxes size={19} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="line-clamp-2 break-words text-[14px] font-semibold leading-snug text-ink">{b.name || 'Company name'}</div>
          <div className="truncate text-[11px] text-ink-faint">{b.tagline || DEFAULT_TAGLINE}</div>
        </div>
      </div>
    </div>
  );
}

function BrandingScreen({ tabId }: ScreenProps) {
  const can = usePermission();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const company = useCompany();
  const config = useProductConfig().config;
  const canEdit = can('dimensions', 'edit');
  const [orig, setOrig] = useState<Brand | null>(null);
  const [b, setB] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = company.data;
    if (!c) return;
    const v: Brand = {
      name: c.name ?? '',
      arabicName: (c.arabicName as string) ?? '',
      tagline: (c.tagline as string) ?? '',
      logo: (c.logo as string) ?? config.logoDataUri,
    };
    setOrig(v);
    setB(v);
  }, [company.data, config.logoDataUri]);

  const dirty = !!b && !!orig && JSON.stringify(b) !== JSON.stringify(orig);
  useEffect(() => {
    ws.setDirty(tabId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, tabId]);

  const save = useMutation({
    mutationFn: async () =>
      (await api.put(`/company/${company.data!.id}`, {
        name: b!.name.trim(),
        arabicName: b!.arabicName.trim(),
        tagline: b!.tagline.trim(),
        logo: b!.logo ?? '',
      })).data,
    onSuccess: async () => {
      toast.success('Branding saved');
      await Promise.all([qc.invalidateQueries({ queryKey: ['company'] }), qc.invalidateQueries({ queryKey: ['product-config'] })]);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const pickLogo = async (file: File) => {
    try {
      setBusy(true);
      // PNG keeps transparency; 256px is plenty for a header logo and keeps the record small
      const blob = await resizeImage(file, 256, 'image/png');
      const url = await blobToDataUrl(blob);
      if (url.length > 550_000) return toast.error('That logo is too detailed. Try a simpler or smaller image.');
      setB((p) => (p ? { ...p, logo: url } : p));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (company.isLoading) return <LoadingBlock />;
  if (company.isError || !company.data) return <ErrorState message="No company record found. Add one under Masters, then Company." onRetry={() => company.refetch()} />;
  if (!b) return <LoadingBlock />;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        {canEdit && (
          <>
            <Button variant="primary" icon={Save} disabled={!dirty || !b.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button icon={RotateCcw} disabled={!dirty} onClick={() => orig && setB(orig)}>Revert</Button>
          </>
        )}
        <span className="text-xs text-ink-muted">The name and logo appear in the app header and the tree menu for every user.</span>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid max-w-[980px] gap-5 lg:grid-cols-[1fr_340px]">
          <section className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
              <Building2 size={15} /> Company identity
            </div>
            <div className="flex flex-col gap-5 sm:flex-row">
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-ink">Logo</div>
                <ImagePicker
                  src={b.logo}
                  onPick={pickLogo}
                  onRemove={() => setB({ ...b, logo: null })}
                  disabled={!canEdit}
                  busy={busy}
                  size={140}
                  allowSvg
                  maxMb={5}
                  emptyText="Upload logo"
                />
                <p className="mt-2 w-[140px] text-[11px] leading-snug text-ink-faint">Square image works best. PNG with a transparent background, JPG, WEBP or SVG.</p>
              </div>
              <div className="grid min-w-0 flex-1 content-start gap-4">
                <Field label="Company name" required hint="Shown in full, wrapping to two lines if needed.">
                  <Input value={b.name} maxLength={120} readOnly={!canEdit} onChange={(e) => setB({ ...b, name: e.target.value })} />
                </Field>
                <Field label="Arabic name">
                  <Input dir="rtl" value={b.arabicName} maxLength={120} readOnly={!canEdit} onChange={(e) => setB({ ...b, arabicName: e.target.value })} />
                </Field>
                <Field label="Subtitle" hint={`Small line under the name. Leave blank for "${DEFAULT_TAGLINE}".`}>
                  <Input value={b.tagline} maxLength={60} placeholder={DEFAULT_TAGLINE} readOnly={!canEdit} onChange={(e) => setB({ ...b, tagline: e.target.value })} />
                </Field>
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-ink-muted">Preview</div>
            <div className="space-y-3">
              <div className="text-[11px] text-ink-faint">Light theme</div>
              <HeaderPreview b={b} />
              <div className="pt-1 text-[11px] text-ink-faint">Dark theme</div>
              <HeaderPreview b={b} dark />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default [{ id: 'company-branding', title: 'Company Branding', icon: Building2, component: BrandingScreen, permission: 'dimensions' }] satisfies ScreenDef[];
