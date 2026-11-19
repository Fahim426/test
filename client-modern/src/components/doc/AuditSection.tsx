import { fmt } from '@/lib/format';
import { DocSection } from './DocumentLayout';

type Who = string | { username?: string; fullName?: string } | null | undefined;
const who = (w: Who) => (typeof w === 'string' ? w : (w?.fullName ?? w?.username ?? ''));

/** Created / updated info. Pass the loaded document (reads createdAt/updatedAt/createdBy/updatedBy when present). */
export function AuditSection({ doc }: { doc?: Record<string, unknown> | null }) {
  if (!doc) return null;
  const created = doc.createdAt as string | undefined;
  const updated = doc.updatedAt as string | undefined;
  const cb = who((doc.createdByUser ?? doc.createdByName ?? doc.createdBy) as Who);
  const ub = who((doc.updatedByUser ?? doc.updatedByName ?? doc.updatedBy) as Who);
  const Item = ({ l, v }: { l: string; v: string }) => (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{l}</span>
      <span className="text-[13px] text-ink">{v || '-'}</span>
    </div>
  );
  return (
    <DocSection title="Audit Information" bodyClassName="flex flex-wrap gap-x-12 gap-y-3 p-5 pt-3">
      <Item l="Created by" v={cb && !/^\d+$/.test(cb) ? cb : ''} />
      <Item l="Created at" v={fmt.dateTime(created)} />
      <Item l="Last updated by" v={ub && !/^\d+$/.test(ub) ? ub : ''} />
      <Item l="Last updated at" v={fmt.dateTime(updated)} />
    </DocSection>
  );
}
