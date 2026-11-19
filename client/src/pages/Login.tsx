import { CompanyLogo } from '@/components/CompanyLogo';
import { useProductConfig } from '@/hooks/useProductConfig';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, User } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

const schema = z.object({ username: z.string().min(1, 'Username is required'), password: z.string().min(1, 'Password is required') });
type Form = z.infer<typeof schema>;

export default function Login() {
  const { config } = useProductConfig();
  const token = useAuth((s) => s.accessToken);
  const login = useAuth((s) => s.login);
  const nav = useNavigate();
  const [err, setErr] = useState('');
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
    <div className="flex h-full items-center justify-center bg-app-bg">
      <div className="w-[380px] border border-app-border bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-brand-dark bg-brand px-4 py-3 text-white">
          <CompanyLogo className="h-16 w-40" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">{config.company?.name || config.appName}</div>
            <div className="text-[11px] opacity-80">Business management workspace</div>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <div className="text-[12px] font-semibold text-slate-700">Sign in to your account</div>
          <Field label="Username" error={formState.errors.username?.message}>
            <div className="relative">
              <User size={13} className="absolute left-2 top-2 text-slate-400" />
              <Input autoFocus className="pl-7" autoComplete="username" {...register('username')} />
            </div>
          </Field>
          <Field label="Password" error={formState.errors.password?.message}>
            <div className="relative">
              <Lock size={13} className="absolute left-2 top-2 text-slate-400" />
              <Input type="password" className="pl-7" autoComplete="current-password" {...register('password')} />
            </div>
          </Field>
          {err && <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[12px] text-red-700">{err}</div>}
          <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
            Sign in
          </Button>
        </form>
        <div className="flex items-center justify-between border-t border-app-border bg-app-head px-4 py-2 text-[11px] text-slate-600">
          <span>Interface</span>
          <span className="flex overflow-hidden rounded border border-app-border">
            <span className="bg-brand px-2 py-0.5 font-semibold text-white">Classic</span>
            <a className="bg-white px-2 py-0.5 hover:bg-slate-100" href={import.meta.env.VITE_MODERN_URL || 'http://localhost:5174'}>
              Modern
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
