import { useMemo, useState } from 'react';
import { FileBarChart, Search } from 'lucide-react';
import { apiError } from '@/lib/api';
import { useOpenScreen } from '@/store/workspace';
import { ErrorState, Input, LoadingBlock, SectionHeader, Toolbar } from '@/components/ui';
import { useCatalog } from '@/components/reports/ReportViewer';
import { screenOfKey } from '@/components/reports/reportRoutes';
import type { ScreenDef } from '@/screens/types';

/** Finance entries are served by the FINANCE screens; their ribbon ids equal the catalog keys. */
function ReportListScreen() {
  const cat = useCatalog();
  const open = useOpenScreen();
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (cat.data?.groups ?? [])
      .map((g) => ({ ...g, reports: g.reports.filter((r) => !s || `${r.title} ${r.description} ${r.key}`.toLowerCase().includes(s)) }))
      .filter((g) => g.reports.length);
  }, [cat.data, search]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <Toolbar>
        <FileBarChart size={14} className="text-brand" />
        <span className="text-[13px] font-semibold text-ink">Report List</span>
        <div className="relative ml-2 w-64">
          <Search size={12} className="absolute left-2 top-2 text-ink-faint" />
          <Input className="pl-6" placeholder="Search reports..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {cat.isLoading && <LoadingBlock />}
        {cat.error && <ErrorState message={apiError(cat.error)} onRetry={() => cat.refetch()} />}
        {cat.data && groups.length === 0 && <div className="p-6 text-center text-[13px] text-ink-muted">No reports match "{search}".</div>}
        {groups.map((g) => (
          <section key={g.group}>
            <SectionHeader title={`${g.group} (${g.reports.length})`} />
            <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
              {g.reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="flex flex-col items-start bg-surface px-3 py-2 text-left hover:bg-brand-soft"
                  onClick={() => open(screenOfKey(r.key), {}, r.title)}
                >
                  <span className="text-[13px] font-semibold text-brand">{r.title}</span>
                  <span className="text-xs text-ink-muted">{r.description}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default [{ id: 'report-list', title: 'Report List', icon: FileBarChart, component: ReportListScreen, permission: 'reports' }] satisfies ScreenDef[];
