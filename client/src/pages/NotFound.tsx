import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
      <div className="text-5xl font-light text-brand">404</div>
      <div className="text-[13px]">The page you requested does not exist.</div>
      <Link to="/" className="rounded border border-brand bg-brand px-3 py-1 text-[12px] text-white hover:bg-brand-dark">
        Back to workspace
      </Link>
    </div>
  );
}
