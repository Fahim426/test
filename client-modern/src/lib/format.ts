const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

type Nil = null | undefined;
const isNil = (v: unknown): v is Nil => v === null || v === undefined || v === '';
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const toDate = (v: string | number | Date | Nil): Date | null => {
  if (isNil(v)) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fmt = {
  /** 1,234.50 (2dp, thousands). Use `money(v, 'AED')` for a currency prefix. */
  money: (v: unknown, currency?: string): string => (isNil(v) ? '' : (currency ? currency + ' ' : '') + moneyFmt.format(toNum(v))),
  /** Quantity: up to 3dp, no trailing zeros. */
  qty: (v: unknown): string => (isNil(v) ? '' : qtyFmt.format(toNum(v))),
  num: (v: unknown, dp = 2): string => (isNil(v) ? '' : toNum(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
  percent: (v: unknown): string => (isNil(v) ? '' : `${qtyFmt.format(toNum(v))}%`),
  /** dd-MMM-yyyy */
  date: (v: string | number | Date | Nil): string => {
    const d = toDate(v);
    return d ? `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}` : '';
  },
  /** dd-MMM-yyyy HH:mm */
  dateTime: (v: string | number | Date | Nil): string => {
    const d = toDate(v);
    return d ? `${fmt.date(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  },
  /** For <input type="date"> value (yyyy-MM-dd) */
  isoDate: (v: string | number | Date | Nil): string => {
    const d = toDate(v);
    return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
  },
  /** "PARTIALLY_RECEIVED" -> "Partially Received" */
  status: (v: string | Nil): string => (v ? v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''),
};

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const today = () => fmt.isoDate(new Date());
