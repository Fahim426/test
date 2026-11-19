import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'default' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-white border-transparent shadow-[0_1px_2px_rgb(var(--brand)/0.4),inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-brand-dark dark:text-[#0c0d14] dark:hover:text-[#0c0d14]',
  default: 'bg-surface text-ink border-line-strong shadow-card hover:bg-surface-2 hover:border-ink-faint/50',
  danger: 'bg-danger text-white border-transparent shadow-sm hover:brightness-95 dark:text-[#0c0d14]',
  ghost: 'bg-transparent text-ink-muted border-transparent hover:bg-surface-3 hover:text-ink',
};
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-9 px-3.5 text-[13px] rounded-lg',
  lg: 'h-10 px-5 text-sm rounded-lg',
};

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
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} /> : null}
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
  { icon: Icon, label, size = 15, variant = 'default', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40',
        variant === 'danger' ? 'text-danger hover:bg-danger-soft' : variant === 'primary' ? 'text-brand hover:bg-brand-soft' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon size={size} />
    </button>
  );
});
