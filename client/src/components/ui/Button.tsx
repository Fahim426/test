import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'default' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white border-brand hover:bg-brand-dark',
  default: 'bg-white text-slate-700 border-app-border hover:bg-slate-100',
  danger: 'bg-red-600 text-white border-red-600 hover:bg-red-700',
  ghost: 'bg-transparent text-slate-700 border-transparent hover:bg-slate-200',
};
const sizes: Record<Size, string> = { sm: 'h-6 px-2 text-[11px]', md: 'h-7 px-3 text-[12px]', lg: 'h-8 px-4 text-[13px]' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border font-medium disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {children as ReactNode}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: number;
  variant?: 'default' | 'danger' | 'primary';
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 14, variant = 'default', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded border border-transparent disabled:opacity-40',
        variant === 'danger' ? 'text-red-600 hover:bg-red-50' : variant === 'primary' ? 'text-brand hover:bg-brand-light' : 'text-slate-600 hover:bg-slate-200',
        className,
      )}
      {...rest}
    >
      <Icon size={size} />
    </button>
  );
});
