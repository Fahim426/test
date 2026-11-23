/**
 * Payment term due dates.
 *  INVOICE_DATE (default): due = invoice date + days        (15-Nov, 30 days -> 15-Dec)
 *  NEXT_MONTH:             due = 1st of next month + days   (15-Nov, 30 days -> 31-Dec; 0 days -> 01-Dec)
 * Local calendar, time of day kept (same convention as addDays).
 */
export const TERM_BASES = ['INVOICE_DATE', 'NEXT_MONTH'] as const;
export type TermBasis = (typeof TERM_BASES)[number];

export function dueDateFor(docDate: Date, term: { days?: number | null; basis?: string | null } | null | undefined): Date {
  const d = new Date(docDate);
  const days = term?.days ?? 0;
  if (term?.basis === 'NEXT_MONTH') {
    return new Date(d.getFullYear(), d.getMonth() + 1, 1 + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}
