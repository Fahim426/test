import { Router } from 'express';
import { prisma, Prisma } from '../lib/prisma';
import { ah } from '../lib/http';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { DOCS, findDocs, hasView, permOf } from '../services/admin-docs';
import { productHistory, productStock } from '../services/admin-history';
import { num, r2, r3 } from '../lib/calc';
import type { ModuleDef } from '../app';

const r = Router();

/** GET /api/search?q= global search grouped by type. */
r.get(
  '/',
  ah(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 1) return res.json({ q, total: 0, groups: [], results: [] });
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 8));
    const u = req.user;
    const results: { type: string; typeLabel: string; id: number; no: string; label: string; route: string; extra?: Record<string, unknown> }[] = [];

    if (hasView(u, 'products')) {
      const products = await prisma.product.findMany({
        where: {
          OR: [
            { code: { contains: q } },
            { name: { contains: q } },
            { arabicName: { contains: q } },
            { description: { contains: q } },
            { oemNumber: { contains: q } },
            { barcode: { contains: q } },
            { partNumbers: { some: { number: { contains: q } } } },
          ],
        },
        include: { partNumbers: { where: { number: { contains: q } }, take: 1 }, brand: { select: { name: true } } },
        orderBy: { code: 'asc' },
        take: limit,
      });
      for (const p of products)
        results.push({
          type: 'PRODUCT',
          typeLabel: 'Product',
          id: p.id,
          no: p.code,
          label: `${p.code} - ${p.name}${p.oemNumber ? ` (OEM ${p.oemNumber})` : ''}`,
          route: `/inventory/products/${p.id}`,
          extra: { oemNumber: p.oemNumber, brand: p.brand?.name ?? null, matchedPartNumber: p.partNumbers[0]?.number ?? null, partRoute: `/search/part/${encodeURIComponent(p.oemNumber ?? p.code)}` },
        });
    }
    if (hasView(u, 'customers')) {
      const rows = await prisma.customer.findMany({
        where: { OR: [{ code: { contains: q } }, { name: { contains: q } }, { arabicName: { contains: q } }, { trn: { contains: q } }, { phone: { contains: q } }, { mobile: { contains: q } }] },
        orderBy: { code: 'asc' },
        take: limit,
      });
      for (const c of rows) results.push({ type: 'CUSTOMER', typeLabel: 'Customer', id: c.id, no: c.code, label: `${c.code} - ${c.name}`, route: `/masters/customers/${c.id}` });
    }
    if (hasView(u, 'suppliers')) {
      const rows = await prisma.supplier.findMany({
        where: { OR: [{ code: { contains: q } }, { name: { contains: q } }, { trn: { contains: q } }, { phone: { contains: q } }] },
        orderBy: { code: 'asc' },
        take: limit,
      });
      for (const s of rows) results.push({ type: 'SUPPLIER', typeLabel: 'Supplier', id: s.id, no: s.code, label: `${s.code} - ${s.name}`, route: `/masters/suppliers/${s.id}` });
    }
    const docDefs = DOCS.filter((d) => hasView(u, permOf(d.type)));
    const docs = await Promise.all(docDefs.map((d) => findDocs(d, { search: q, take: Math.min(limit, 5) })));
    for (const list of docs)
      for (const d of list)
        results.push({
          type: d.type,
          typeLabel: d.typeLabel,
          id: d.id,
          no: d.no,
          label: `${d.no}${d.party ? ` - ${d.party}` : ''}${d.amount != null ? ` - ${d.amount.toFixed(2)}` : ''}${d.status ? ` [${d.status}]` : ''}`,
          route: d.route,
          extra: { date: d.date, status: d.status, amount: d.amount, party: d.party },
        });

    const groups: { type: string; typeLabel: string; items: typeof results }[] = [];
    for (const it of results) {
      let g = groups.find((x) => x.type === it.type);
      if (!g) groups.push((g = { type: it.type, typeLabel: it.typeLabel, items: [] }));
      g.items.push(it);
    }
    res.json({ q, total: results.length, groups, results });
  }),
);

/** Exact part number drill-down. */
async function partDrillDown(number: string) {
  const n = number.trim();
  if (!n) throw badRequest('Part number is required');
  const where: Prisma.ProductWhereInput = { OR: [{ code: n }, { oemNumber: n }, { barcode: n }, { partNumbers: { some: { number: n } } }] };
  let matches = await prisma.product.findMany({ where, select: { id: true, code: true, name: true, oemNumber: true }, orderBy: { code: 'asc' }, take: 20 });
  if (!matches.length) {
    // fall back to partial match so users still land somewhere useful
    matches = await prisma.product.findMany({
      where: { OR: [{ code: { contains: n } }, { oemNumber: { contains: n } }, { barcode: { contains: n } }, { partNumbers: { some: { number: { contains: n } } } }] },
      select: { id: true, code: true, name: true, oemNumber: true },
      orderBy: { code: 'asc' },
      take: 20,
    });
  }
  if (!matches.length) throw notFound(`No product found for part number "${n}"`);
  const id = matches[0].id;
  const product = await prisma.product.findUniqueOrThrow({
    where: { id },
    include: { brand: true, category: true, partNumbers: { orderBy: [{ kind: 'desc' }, { id: 'asc' }] }, vehicles: true },
  });
  const [stock, h, primary] = await Promise.all([
    productStock(id),
    productHistory(id, 20),
    product.primarySupplierId ? prisma.supplier.findUnique({ where: { id: product.primarySupplierId }, select: { id: true, code: true, name: true, phone: true, email: true } }) : null,
  ]);
  // customers that bought this part
  const cust = new Map<number, { customer: { id: number; code: string; name: string } | null; qty: number; amount: number; invoices: number; lastDate: Date; lastRate: number }>();
  for (const i of h.salesInvoices) {
    if (i.status === 'DRAFT' || i.status === 'CANCELLED' || !i.customer) continue;
    const e = cust.get(i.customer.id) ?? { customer: i.customer, qty: 0, amount: 0, invoices: 0, lastDate: i.date, lastRate: i.rate };
    e.qty += i.qty;
    e.amount += i.amount;
    e.invoices += 1;
    if (i.date > e.lastDate) {
      e.lastDate = i.date;
      e.lastRate = i.rate;
    }
    cust.set(i.customer.id, e);
  }
  // supplier history: derived "primary" fallback = latest supplier on purchase docs
  const latestSup = [...h.purchaseInvoices, ...h.goodsReceipts, ...h.purchaseOrders].sort((a, b) => +b.date - +a.date).find((x) => x.supplier)?.supplier ?? null;
  return {
    query: n,
    matches,
    product,
    stock: { onHand: r3(stock.total.onHand), reserved: r3(stock.total.reserved), available: r3(stock.total.available), value: stock.total.value, warehouses: stock.warehouses },
    purchaseHistory: { purchaseOrders: h.purchaseOrders, goodsReceipts: h.goodsReceipts, purchaseInvoices: h.purchaseInvoices, last: h.summary.lastPurchase },
    salesHistory: { salesInvoices: h.salesInvoices, deliveries: h.deliveries, quotations: h.quotations, last: h.summary.lastSale },
    primarySupplier: primary ?? latestSup,
    customerTransactions: [...cust.values()].map((c) => ({ ...c, qty: r3(c.qty), amount: r2(c.amount) })).sort((a, b) => +b.lastDate - +a.lastDate),
    totals: {
      purchasedQty: r3(h.purchaseInvoices.filter((x) => x.status !== 'DRAFT' && x.status !== 'CANCELLED').reduce((s, x) => s + num(x.qty), 0)),
      soldQty: r3(h.salesInvoices.filter((x) => x.status !== 'DRAFT' && x.status !== 'CANCELLED').reduce((s, x) => s + num(x.qty), 0)),
    },
  };
}

r.get(
  '/part',
  ah(async (req, res) => {
    if (!hasView(req.user, 'products')) throw forbidden('Missing permission products:view');
    res.json(await partDrillDown(String(req.query.part ?? req.query.q ?? '')));
  }),
);
r.get(
  '/part/:number',
  ah(async (req, res) => {
    if (!hasView(req.user, 'products')) throw forbidden('Missing permission products:view');
    res.json(await partDrillDown(String(req.params.number)));
  }),
);

export default [{ path: '/search', router: r }] satisfies ModuleDef[];
