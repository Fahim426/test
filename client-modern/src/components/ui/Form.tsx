import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const bad = 'border-danger focus:border-danger focus:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cn('ctl', invalid && bad, className)} {...rest} />;
});

/** Right-aligned numeric input. With react-hook-form: `register('qty', { valueAsNumber: true })`. */
export const NumberInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function NumberInput(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} type="number" step="any" className={cn('ctl text-right tabular-nums', invalid && bad, className)} {...rest} />;
});

export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function DateInput(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} type="date" className={cn('ctl', invalid && bad, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn('ctl h-auto py-2', invalid && bad, className)} {...rest} />;
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
    <select ref={ref} className={cn('ctl', invalid && bad, className)} {...rest}>
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
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-ink', className)}>
      <input ref={ref} type="checkbox" className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[rgb(var(--brand))]" {...rest} />
      {label}
    </label>
  );
});

/** Label + control + error. */
export function Field({
  label, error, required, hint, children, className,
}: { label?: ReactNode; error?: string; required?: boolean; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {label !== undefined && (
        <label className="truncate text-xs font-medium text-ink-muted">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
    </div>
  );
}
