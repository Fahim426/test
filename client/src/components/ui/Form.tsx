import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cn('ctl', invalid && 'border-red-500', className)} {...rest} />;
});

/** Right-aligned numeric input. With react-hook-form: `register('qty', { valueAsNumber: true })`. */
export const NumberInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function NumberInput(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} type="number" step="any" className={cn('ctl text-right tabular-nums', invalid && 'border-red-500', className)} {...rest} />;
});

export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function DateInput(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} type="date" className={cn('ctl', invalid && 'border-red-500', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn('ctl h-auto py-1', invalid && 'border-red-500', className)} {...rest} />;
});

export interface SelectOption {
  value: string | number;
  label: string;
}
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options?: SelectOption[]; placeholder?: string; invalid?: boolean }
>(function Select({ className, options, placeholder, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn('ctl pr-1', invalid && 'border-red-500', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }>(function Checkbox(
  { className, label, ...rest },
  ref,
) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-1.5 text-[12px]', className)}>
      <input ref={ref} type="checkbox" className="h-3.5 w-3.5 accent-[#1f5fae]" {...rest} />
      {label}
    </label>
  );
});

/** Label + control + error. */
export function Field({
  label, error, required, hint, children, className,
}: { label?: ReactNode; error?: string; required?: boolean; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      {label !== undefined && (
        <label className="truncate text-[11px] font-medium text-slate-600">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
      {error ? <span className="text-[11px] text-red-600">{error}</span> : hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
    </div>
  );
}
