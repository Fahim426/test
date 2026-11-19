// Client mirror of server/src/lib/calc.ts (server recomputes authoritatively on save).
import { r2 } from './format';

export const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface LineIn {
  qty?: unknown;
  rate?: unknown;
  /** absolute discount amount on the line */
  discount?: unknown;
  vatRate?: unknown;
}

/** net = qty*rate - discount ; vat = net*vatRate% ; amount = net + vat */
export function calcLine(l: LineIn) {
  const gross = num(l.qty) * num(l.rate);
  const net = r2(gross - num(l.discount));
  const vatAmount = r2((net * num(l.vatRate)) / 100);
  return { gross: r2(gross), net, vatAmount, amount: r2(net + vatAmount) };
}

export interface Totals {
  subtotal: number;
  discount: number;
  vatAmount: number;
  roundOff: number;
  total: number;
}

export function calcTotals(lines: LineIn[], roundOff = 0): Totals {
  let subtotal = 0;
  let discount = 0;
  let vat = 0;
  for (const l of lines) {
    subtotal += num(l.qty) * num(l.rate);
    discount += num(l.discount);
    vat += calcLine(l).vatAmount;
  }
  subtotal = r2(subtotal);
  discount = r2(discount);
  vat = r2(vat);
  const ro = r2(num(roundOff));
  return { subtotal, discount, vatAmount: vat, roundOff: ro, total: r2(subtotal - discount + vat + ro) };
}
