import { Construction } from 'lucide-react';
import type { ScreenProps } from './types';
import { locateScreen } from '@/ribbon/ribbonConfig';

/** Rendered for any screen id that has no registered *.screen.tsx yet. */
export default function PlaceholderScreen({ screenId, params }: ScreenProps & { screenId: string }) {
  const loc = locateScreen(screenId);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-3 text-ink-faint">
        <Construction size={26} strokeWidth={1.5} />
      </span>
      <div className="text-base font-semibold text-ink">Screen not available yet</div>
      <div className="text-[13px] text-ink-muted">{loc ? `${loc.module} › ${loc.group} › ${loc.label}` : 'This screen'} is not implemented in this build.</div>
      <code className="mt-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted">
        {screenId}
        {params?.id !== undefined ? ` #${String(params.id)}` : ''}
      </code>
    </div>
  );
}
