// Shared document arithmetic. Money rounded to 2dp. VAT rates always come from the line (never hard-coded).
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

export interface LineIn {
  qty: unknown;
  rate: unknown;
  discount?: unknown; // absolute discount amount on the line
  vatRate?: unknown;
}
export interface LineOut {
  vatAmount: number;
  amount: number; // line total incl. VAT
  net: number; // qty*rate - discount (excl VAT)
}
export function calcLine(l: LineIn): LineOut {
  const gross = num(l.qty) * num(l.rate);
  const net = r2(gross - num(l.discount));
  const vatAmount = r2((net * num(l.vatRate)) / 100);
  return { net, vatAmount, amount: r2(net + vatAmount) };
}
export interface Totals {
  subtotal: number; // sum of qty*rate
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
    const c = calcLine(l);
    subtotal += num(l.qty) * num(l.rate);
    discount += num(l.discount);
    vat += c.vatAmount;
  }
  subtotal = r2(subtotal);
  discount = r2(discount);
  vat = r2(vat);
  const ro = r2(num(roundOff));
  return { subtotal, discount, vatAmount: vat, roundOff: ro, total: r2(subtotal - discount + vat + ro) };
}
