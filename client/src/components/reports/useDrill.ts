import { useCallback } from 'react';
import { api, apiError } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';
import { toast } from '@/store/toast';
import type { DrillSpec } from './ResultGrid';
import type { ReportCol, Row } from './reportTypes';

interface SearchItem { type: string; id: number; no: string; label: string }

/** Opens the document / master behind a report cell. Uses the row id when present, else resolves the number through /search. */
export function useDrill() {
  const open = useOpenScreen();
  return useCallback(
    async (spec: DrillSpec, row: Row, col: ReportCol) => {
      const text = String(row[col.key] ?? '').trim();
      try {
        let id = spec.idKey ? Number(row[spec.idKey]) : NaN;
        if (!Number.isFinite(id) || id <= 0) {
          const r = await api.get<{ results: SearchItem[] }>('/search', { params: { q: text, limit: 25 } });
          const searchType = spec.type === 'IMPORT_PURCHASE_ORDER' ? 'PURCHASE_ORDER' : spec.type; // search indexes import POs as purchase orders
          const same = r.data.results.filter((x) => x.type === searchType);
          const hit = same.find((x) => x.no === text) ?? same.find((x) => x.label.toLowerCase().includes(text.toLowerCase())) ?? same[0];
          if (!hit) {
            toast.warning(`Could not find ${text}`);
            return;
          }
          id = hit.id;
        }
        open(formScreenOf(spec.type), { id }, text);
      } catch (e) {
        toast.error(apiError(e));
      }
    },
    [open],
  );
}
