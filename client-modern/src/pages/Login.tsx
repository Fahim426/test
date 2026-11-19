import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, BarChart3, Eye, EyeOff, Layers, Loader2, Lock, ShieldCheck, User, Workflow } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { Field } from '@/components/ui';
import { ThemeMenu, CLASSIC_URL } from '@/components/shell/Topbar';
import { cn } from '@/lib/cn';

const schema = z.object({ username: z.string().min(1, 'Username is required'), password: z.string().min(1, 'Password is required') });
type Form = z.infer<typeof schema>;

const features = [
  { icon: Layers, title: 'Multi-document workspace', text: 'Work on orders, invoices and vouchers side by side in tabs.' },
  { icon: Workflow, title: 'End-to-end document flow', text: 'Enquiry to quotation, delivery, invoice and receipt - fully traceable.' },
  { icon: BarChart3, title: 'Live insight', text: 'Stock, receivables and sales dashboards that update as you work.' },
  { icon: ShieldCheck, title: 'Controlled by role', text: 'Granular permissions and approval workflows built in.' },
];

export default function Login() {
  const token = useAuth((s) => s.accessToken);
  const login = useAuth((s) => s.login);
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: import.meta.env.DEV ? { username: 'admin', password: 'admin123' } : { username: '', password: '' } });
  if (token) return <Navigate to="/" replace />;

  const submit = handleSubmit(async (v) => {
    setErr('');
    try {
      await login(v.username.trim(), v.password);
      nav('/', { replace: true });
    } catch (e) {
      setErr(apiError(e));
    }
  });

  return (
    <div className="flex min-h-full bg-surface">
      {/* brand panel */}
      <div className="relative hidden w-[46%] max-w-[720px] shrink-0 overflow-hidden bg-[#1e1b4b] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-indigo-500/60 blur-[90px]" />
          <div className="absolute -bottom-32 right-[-60px] h-[460px] w-[460px] rounded-full bg-violet-500/50 blur-[100px]" />
          <div className="absolute left-1/3 top-1/2 h-[260px] w-[260px] rounded-full bg-sky-400/25 blur-[90px]" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
                <path d="M 36 0 L 0 0 0 36" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          <div className="absolute right-12 top-24 h-24 w-24 rotate-12 rounded-3xl border border-white/20 bg-white/5 backdrop-blur-sm" />
          <div className="absolute right-32 top-52 h-12 w-12 -rotate-12 rounded-2xl border border-white/20 bg-white/10" />
        </div>
        <div className="relative flex items-center gap-3">
          <img src="/brand/fortune7-logo.jpeg" alt="Fortune 7" className="h-16 w-44 shrink-0 rounded-xl bg-white object-contain" />
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Fortune 7 ERP</div>
            <div className="text-xs text-indigo-200">Printing &amp; industrial equipment trading</div>
          </div>
        </div>
        <div className="relative">
          <h2 className="max-w-md text-[40px] font-semibold leading-[1.1] tracking-tight">
            Run your equipment business <span className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text text-transparent">at full speed.</span>
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-indigo-100/80">
            Sales, purchasing, inventory and finance in one connected workspace - built for equipment sales and service.
          </p>
          <ul className="mt-9 grid max-w-lg grid-cols-1 gap-5 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <f.icon size={17} />
                </span>
                <span className="text-[13px] leading-snug">
                  <span className="block font-medium">{f.title}</span>
                  <span className="text-indigo-200/80">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-indigo-300/80">© {new Date().getFullYear()} Fortune 7. All rights reserved.</div>
      </div>

      {/* sign-in */}
      <div className="relative flex flex-1 flex-col">
        <div className="absolute right-5 top-4 flex items-center gap-2">
          <ThemeMenu />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <img src="/brand/fortune7-logo.jpeg" alt="Fortune 7" className="h-12 w-32 shrink-0 rounded-lg bg-white object-contain" />
              <span className="text-lg font-semibold text-ink">Fortune 7 ERP</span>
            </div>

            <div className="mb-6 flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">Interface</span>
              <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1 text-[13px] font-medium" role="group" aria-label="Interface">
                <a
                  href={CLASSIC_URL}
                  className="rounded-lg px-4 py-1.5 text-ink-muted transition hover:bg-surface-3 hover:text-ink"
                  title="Open the classic desktop-style interface"
                >
                  Classic
                </a>
                <span aria-current="true" className="rounded-lg bg-surface px-4 py-1.5 text-brand shadow-card ring-1 ring-line">
                  Modern
                </span>
              </div>
            </div>

            <h1 className="text-[28px] font-semibold leading-9 tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1.5 text-sm text-ink-muted">Sign in to your account to continue.</p>

            <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
              <Field label="Username" error={formState.errors.username?.message}>
                <div className="relative">
                  <User size={16} className="pointer-events-none absolute left-3 top-[11px] text-ink-faint" />
                  <input autoFocus className={cn('ctl !h-11 pl-10', formState.errors.username && 'border-danger')} autoComplete="username" placeholder="admin" {...register('username')} />
                </div>
              </Field>
              <Field label="Password" error={formState.errors.password?.message}>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3 top-[11px] text-ink-faint" />
                  <input
                    type={show ? 'text' : 'password'}
                    className={cn('ctl !h-11 pl-10 pr-11', formState.errors.password && 'border-danger')}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-3 hover:text-ink"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              {err && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] text-danger">
                  <AlertCircle size={17} className="mt-px shrink-0" />
                  <span>{err}</span>
                </div>
              )}
              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(99_102_241/0.6)] transition hover:brightness-110 active:scale-[.99] disabled:opacity-70"
              >
                {formState.isSubmitting ? (
                  <>
                    <Loader2 size={17} className="animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
