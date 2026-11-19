import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas text-ink-muted">
      <div className="bg-gradient-to-br from-indigo-500 to-violet-500 bg-clip-text text-7xl font-bold tracking-tight text-transparent">404</div>
      <div className="text-sm">The page you requested does not exist.</div>
      <Link to="/" className="mt-2 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13px] font-medium text-white shadow-card transition hover:bg-brand-dark dark:text-[#0c0d14]">
        Back to workspace
      </Link>
    </div>
  );
}
