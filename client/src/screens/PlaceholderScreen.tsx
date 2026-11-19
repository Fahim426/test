import { Construction } from 'lucide-react';
import type { ScreenProps } from './types';
import { locateScreen } from '@/ribbon/ribbonConfig';

/** Rendered for any screen id that has no registered *.screen.tsx yet. */
export default function PlaceholderScreen({ screenId, params }: ScreenProps & { screenId: string }) {
  const loc = locateScreen(screenId);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center text-slate-500">
      <Construction size={34} strokeWidth={1.2} className="text-slate-400" />
      <div className="text-[14px] font-semibold text-slate-700">Screen not available yet</div>
      <div className="text-[12px]">
        {loc ? `${loc.module} › ${loc.group} › ${loc.label}` : 'This screen'} is not implemented in this build.
      </div>
      <code className="mt-1 rounded border border-app-border bg-white px-2 py-0.5 text-[11px] text-slate-600">
        {screenId}
        {params?.id !== undefined ? ` #${String(params.id)}` : ''}
      </code>
    </div>
  );
}
