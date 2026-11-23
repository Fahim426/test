import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import type { ModuleDef } from '../app';

/* =====================================================================
 * E-INVOICE (UAE Peppol PINT-AE via an Accredited Service Provider, ASP)
 *  - Settings: one row (single company). Secret is never returned to the browser.
 *  - Queue:    one row per sales invoice (PENDING -> CLEARED | FAILED).
 *  - SANDBOX:  built-in mock clearance (no real submission, no legal effect).
 *  - PRODUCTION: blocked until a live adapter for the chosen ASP is built (logged as an error).
 *  - UBL 2.1 XML is generated from the invoice for preview / pre-validation.
 * ===================================================================== */

const router = Router();
const num = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => num(v).toFixed(2);
const ELIGIBLE = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

/* ── settings helpers ── */
type Settings = {
  id: number; mode: string; peppolId: string | null; aspName: string | null;
  baseUrl: string | null; clientId: string | null; clientSecret: string | null; updatedAt: Date | null;
};
async function getSettings(): Promise<Settings> {
  const r = await prisma.eInvoiceSettings.findUnique({ where: { id: 1 } });
  return r ?? { id: 1, mode: 'SANDBOX', peppolId: null, aspName: null, baseUrl: null, clientId: null, clientSecret: null, updatedAt: null };
}
const publicSettings = (r: Settings) => ({
  mode: r.mode,
  peppolId: r.peppolId ?? '',
  aspName: r.aspName ?? '',
  baseUrl: r.baseUrl ?? '',
  clientId: r.clientId ?? '',
  hasClientSecret: !!r.clientSecret,
  updatedAt: r.updatedAt,
});
function missingConfig(r: Pick<Settings, 'peppolId' | 'baseUrl' | 'clientId' | 'clientSecret'>): string[] {
  const m: string[] = [];
  if (!r.peppolId) m.push('Peppol ID');
  if (!r.baseUrl) m.push('API base URL');
  if (!r.clientId) m.push('Client ID');
  if (!r.clientSecret) m.push('Client secret');
  return m;
}
const isPrivateHost = (host: string) =>
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/i.test(host);

async function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, invoiceId?: number) {
  await prisma.eInvoiceLog.create({ data: { level, message: message.slice(0, 1900), invoiceId } });
}

/* ── invoice loading + UBL XML ── */
async function loadInvoice(id: number) {
  const inv = await prisma.salesInvoice.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!inv) throw notFound('Sales invoice not found');
  const [customer, company] = await Promise.all([
    prisma.customer.findUnique({ where: { id: inv.customerId } }),
    prisma.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }),
  ]);
  return { inv, customer, company };
}
type Loaded = Awaited<ReturnType<typeof loadInvoice>>;

export function validateInvoice(l: Loaded, cfg: Settings): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = cfg.mode === 'PRODUCTION';
  const soft = (m: string) => (prod ? errors : warnings).push(m);
  if (!ELIGIBLE.includes(l.inv.status)) errors.push(`Invoice ${l.inv.docNo} is ${l.inv.status}; only posted invoices can be e-invoiced`);
  if (!l.customer) errors.push('Customer not found');
  if (!l.inv.items.length) errors.push('Invoice has no line items');
  if (!l.company?.name) errors.push('Company name is not set (Admin > Company)');
  const sellerTrn = (l.company?.trn ?? '').replace(/\s/g, '');
  if (!/^\d{15}$/.test(sellerTrn)) soft('Seller TRN must be 15 digits (set it in Admin > Company)');
  if (!cfg.peppolId) soft('Peppol ID is not configured (E-Invoice > Settings)');
  const buyerTrn = (l.customer?.trn ?? l.inv.trn ?? '').replace(/\s/g, '');
  if (!buyerTrn) warnings.push('Customer has no TRN (required for B2B tax invoices)');
  else if (!/^\d{15}$/.test(buyerTrn)) soft('Customer TRN must be 15 digits');
  return { errors, warnings };
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const q = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

export function buildUbl(l: Loaded, cfg: Settings): string {
  const { inv, customer, company } = l;
  const cur = inv.currencyCode || 'AED';
  const peppol = cfg.peppolId ?? '';
  const [scheme, ident] = peppol.includes(':') ? [peppol.split(':')[0], peppol.split(':').slice(1).join(':')] : ['0235', peppol];
  const sellerTrn = (company?.trn ?? '').replace(/\s/g, '');
  const buyerTrn = (customer?.trn ?? inv.trn ?? '').replace(/\s/g, '');

  // VAT breakdown per rate
  const groups = new Map<number, { taxable: number; tax: number }>();
  let lineSum = 0;
  for (const it of inv.items) {
    const net = num(it.qty) * num(it.rate) - num(it.discount);
    const rate = num(it.vatRate);
    const g = groups.get(rate) ?? { taxable: 0, tax: 0 };
    g.taxable += net;
    g.tax += num(it.vatAmount);
    groups.set(rate, g);
    lineSum += net;
  }
  const taxTotal = num(inv.vatAmount);
  const exclusive = lineSum;
  const inclusive = exclusive + taxTotal;
  const rounding = num(inv.roundOff);
  const payable = inclusive + rounding;
  // S standard, Z zero-rated, E exempt (invoice ticked Exempt VAT)
  const catId = (rate: number) => (rate > 0 ? 'S' : inv.vatExempt ? 'E' : 'Z');

  const party = (name: string, trn: string, addr: string, country: string, email?: string | null, endpoint?: { scheme: string; id: string }) => `
    <cac:Party>${endpoint?.id ? `
      <cbc:EndpointID schemeID="${esc(endpoint.scheme)}">${esc(endpoint.id)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${esc(name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(addr)}</cbc:StreetName>
        <cac:Country><cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>${trn ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(trn)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(name)}</cbc:RegistrationName></cac:PartyLegalEntity>${email ? `
      <cac:Contact><cbc:ElectronicMail>${esc(email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>`;

  const lines = inv.items.map((it, idx) => {
    const net = num(it.qty) * num(it.rate) - num(it.discount);
    const rate = num(it.vatRate);
    return `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${num(it.qty)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${q(net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(it.description ?? it.oemNumber ?? `Item ${it.productId}`)}</cbc:Name>${it.oemNumber ? `
      <cac:SellersItemIdentification><cbc:ID>${esc(it.oemNumber)}</cbc:ID></cac:SellersItemIdentification>` : ''}
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${catId(rate)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${num(it.rate).toFixed(4)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join('');

  const subtotals = [...groups.entries()].map(([rate, g]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${q(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${q(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${catId(rate)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${catId(rate) === 'E' ? `
        <cbc:TaxExemptionReason>Exempt supply</cbc:TaxExemptionReason>` : ''}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>
  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>
  <cbc:ID>${esc(inv.docNo)}</cbc:ID>
  <cbc:IssueDate>${day(inv.docDate)}</cbc:IssueDate>${inv.dueDate ? `
  <cbc:DueDate>${day(inv.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${inv.remarks ? `
  <cbc:Note>${esc(inv.remarks)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>${party(company?.name ?? '', sellerTrn, company?.address ?? '', 'AE', company?.email, { scheme, id: ident })}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(customer?.name ?? '', buyerTrn, inv.address ?? customer?.address ?? '', 'AE', customer?.email)}
  </cac:AccountingCustomerParty>${inv.paymentTerms ? `
  <cac:PaymentTerms><cbc:Note>${esc(inv.paymentTerms)}</cbc:Note></cac:PaymentTerms>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${q(taxTotal)}</cbc:TaxAmount>${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${q(lineSum)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${q(exclusive)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${q(inclusive)}</cbc:TaxInclusiveAmount>${rounding ? `
    <cbc:PayableRoundingAmount currencyID="${cur}">${q(rounding)}</cbc:PayableRoundingAmount>` : ''}
    <cbc:PayableAmount currencyID="${cur}">${q(payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>
`;
}

/* ── submit one queue item ── */
type SubmitResult = { ok: true; uuid: string } | { ok: false; error: string };
async function submitItem(queueId: number): Promise<SubmitResult> {
  const item = await prisma.eInvoiceQueue.findUnique({ where: { id: queueId } });
  if (!item) throw notFound('Queue item not found');
  if (item.status === 'CLEARED') return { ok: true, uuid: item.aspUuid ?? '' };
  const cfg = await getSettings();

  const fail = async (msg: string): Promise<SubmitResult> => {
    await prisma.$transaction([
      prisma.eInvoiceQueue.update({ where: { id: queueId }, data: { status: 'FAILED', attempts: { increment: 1 }, lastAttempt: new Date(), lastError: msg.slice(0, 1900) } }),
      prisma.salesInvoice.update({ where: { id: item.invoiceId }, data: { einvStatus: 'FAILED' } }),
      prisma.eInvoiceLog.create({ data: { level: 'ERROR', invoiceId: item.invoiceId, message: msg.slice(0, 1900) } }),
    ]);
    return { ok: false, error: msg };
  };

  const loaded = await loadInvoice(item.invoiceId);
  const { errors, warnings } = validateInvoice(loaded, cfg);
  if (errors.length) return fail('Validation failed — ' + errors.join('; '));

  if (cfg.mode === 'PRODUCTION') {
    const miss = missingConfig(cfg);
    return fail(
      miss.length
        ? 'Production submission blocked — missing: ' + miss.join(', ')
        : `Production submission to ${cfg.aspName || cfg.baseUrl} is not available yet: the live ASP adapter has not been built for this provider`,
    );
  }

  // SANDBOX: mock clearance
  buildUbl(loaded, cfg); // make sure the XML can be generated
  const uuid = randomUUID();
  await prisma.$transaction([
    prisma.eInvoiceQueue.update({ where: { id: queueId }, data: { status: 'CLEARED', aspUuid: uuid, attempts: { increment: 1 }, lastAttempt: new Date(), lastError: null } }),
    prisma.salesInvoice.update({ where: { id: item.invoiceId }, data: { einvStatus: 'CLEARED', einvUuid: uuid } }),
    ...warnings.map((w) => prisma.eInvoiceLog.create({ data: { level: 'WARN', invoiceId: item.invoiceId, message: w } })),
    prisma.eInvoiceLog.create({
      data: { level: 'INFO', invoiceId: item.invoiceId, message: `CLEARED — UUID ${uuid} (sandbox mock)${cfg.peppolId ? ' · Peppol ID ' + cfg.peppolId : ''}` },
    }),
  ]);
  return { ok: true, uuid };
}

/* ── ROUTES ── */

// Settings
router.get('/settings', can('einvoice', 'view'), ah(async (_req, res) => {
  res.json(publicSettings(await getSettings()));
}));

const settingsSchema = z.object({
  mode: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  peppolId: z.string().trim().max(100).nullish(),
  aspName: z.string().trim().max(120).nullish(),
  baseUrl: z.string().trim().max(255).nullish(),
  clientId: z.string().trim().max(255).nullish(),
  clientSecret: z.string().max(255).nullish(), // blank = keep the saved secret
});
router.put('/settings', can('einvoice', 'edit'), ah(async (req, res) => {
  const b = parse(settingsSchema, req.body);
  const cur = await getSettings();
  const next = {
    mode: b.mode,
    peppolId: (b.peppolId ?? cur.peppolId ?? '').trim() || null,
    aspName: (b.aspName ?? cur.aspName ?? '').trim() || null,
    baseUrl: (b.baseUrl ?? cur.baseUrl ?? '').trim() || null,
    clientId: (b.clientId ?? cur.clientId ?? '').trim() || null,
    clientSecret: b.clientSecret && b.clientSecret.trim() ? b.clientSecret.trim() : cur.clientSecret,
  };
  if (next.baseUrl) {
    if (!/^https:\/\//i.test(next.baseUrl)) throw badRequest('API base URL must start with https://');
    let host = '';
    try { host = new URL(next.baseUrl).hostname; } catch { throw badRequest('API base URL is not a valid URL'); }
    if (isPrivateHost(host)) throw badRequest('API base URL must be a public host');
  }
  if (next.peppolId && !/^[A-Za-z0-9:._-]{3,100}$/.test(next.peppolId)) throw badRequest('Peppol ID may only contain letters, digits and : . _ -');
  if (next.mode === 'PRODUCTION') {
    const miss = missingConfig(next);
    if (miss.length) throw badRequest('Production mode needs: ' + miss.join(', '));
  }
  await prisma.eInvoiceSettings.upsert({ where: { id: 1 }, update: next, create: { id: 1, ...next } });
  await audit(prisma, req.user, 'UPDATE', 'eInvoiceSettings', 1, { mode: next.mode, peppolId: next.peppolId, aspName: next.aspName });
  res.json(publicSettings(await getSettings()));
}));

// Connection test (sandbox always OK; production only checks that the ASP host answers — no credentials are sent)
router.post('/test', can('einvoice', 'edit'), ah(async (_req, res) => {
  const cfg = await getSettings();
  if (cfg.mode !== 'PRODUCTION') return res.json({ ok: true, mode: 'SANDBOX', message: 'Sandbox mode — built-in mock ASP is reachable' });
  const miss = missingConfig(cfg);
  if (miss.length) throw badRequest('Missing: ' + miss.join(', '));
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(cfg.baseUrl as string, { method: 'GET', signal: ctl.signal, redirect: 'manual' });
    clearTimeout(t);
    res.json({ ok: true, mode: 'PRODUCTION', message: `ASP host reachable (HTTP ${r.status}). Credentials are not verified by this check.` });
  } catch (e) {
    const err = e as Error;
    res.status(502).json({ ok: false, error: `Cannot reach ${cfg.baseUrl} — ${err.name === 'AbortError' ? 'timed out' : err.message}` });
  }
}));

// Summary tiles
router.get('/summary', can('einvoice', 'view'), ah(async (_req, res) => {
  const [pending, cleared, failed, notSubmitted, cfg] = await Promise.all([
    prisma.eInvoiceQueue.count({ where: { status: 'PENDING' } }),
    prisma.eInvoiceQueue.count({ where: { status: 'CLEARED' } }),
    prisma.eInvoiceQueue.count({ where: { status: 'FAILED' } }),
    prisma.salesInvoice.count({ where: { status: { in: ELIGIBLE }, einvStatus: 'NONE' } }),
    getSettings(),
  ]);
  const total = pending + cleared + failed;
  res.json({
    pending, cleared, failed, notSubmitted, total,
    clearanceRate: total ? Math.round((cleared / total) * 1000) / 10 : 0,
    mode: cfg.mode,
    configured: missingConfig(cfg).length === 0,
  });
}));

// Posted sales invoices with their e-invoice status
router.get('/invoices', can('einvoice', 'view'), ah(async (req, res) => {
  const lq = listQuery(req);
  const where: Record<string, unknown> = { status: { in: ELIGIBLE } };
  if (req.query.einvStatus) where.einvStatus = String(req.query.einvStatus);
  if (lq.search) where.docNo = { contains: lq.search };
  const [rows, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where, orderBy: { id: 'desc' }, skip: (lq.page - 1) * lq.pageSize, take: lq.pageSize,
      select: { id: true, docNo: true, docDate: true, customerId: true, total: true, currencyCode: true, status: true, einvStatus: true, einvUuid: true },
    }),
    prisma.salesInvoice.count({ where }),
  ]);
  const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } });
  const nm = new Map(custs.map((c) => [c.id, c.name]));
  res.json(paged(rows.map((r) => ({ ...r, customerName: nm.get(r.customerId) ?? '' })), total, lq));
}));

// Queue
router.get('/queue', can('einvoice', 'view'), ah(async (req, res) => {
  const where: Record<string, unknown> = {};
  if (req.query.status) where.status = String(req.query.status);
  const items = await prisma.eInvoiceQueue.findMany({ where, orderBy: { id: 'desc' }, take: 500 });
  const invs = await prisma.salesInvoice.findMany({ where: { id: { in: items.map((i) => i.invoiceId) } }, select: { id: true, docNo: true, total: true, currencyCode: true, customerId: true } });
  const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(invs.map((i) => i.customerId))] } }, select: { id: true, name: true } });
  const im = new Map(invs.map((i) => [i.id, i]));
  const cm = new Map(custs.map((c) => [c.id, c.name]));
  res.json(items.map((it) => {
    const inv = im.get(it.invoiceId);
    return { ...it, docNo: inv?.docNo ?? '', total: inv?.total ?? 0, currencyCode: inv?.currencyCode ?? 'AED', customerName: inv ? cm.get(inv.customerId) ?? '' : '' };
  }));
}));

router.post('/queue', can('einvoice', 'create'), ah(async (req, res) => {
  const { invoiceIds } = parse(z.object({ invoiceIds: z.array(z.coerce.number().int().positive()).min(1).max(500) }), req.body);
  const invs = await prisma.salesInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, docNo: true, status: true } });
  const existing = await prisma.eInvoiceQueue.findMany({ where: { invoiceId: { in: invoiceIds } } });
  const ex = new Map(existing.map((e) => [e.invoiceId, e]));
  const queued: number[] = [];
  const skipped: Array<{ id: number; docNo?: string; reason: string }> = [];
  for (const id of invoiceIds) {
    const inv = invs.find((i) => i.id === id);
    if (!inv) { skipped.push({ id, reason: 'Invoice not found' }); continue; }
    if (!ELIGIBLE.includes(inv.status)) { skipped.push({ id, docNo: inv.docNo, reason: `Invoice is ${inv.status} — only posted invoices can be e-invoiced` }); continue; }
    const e = ex.get(id);
    if (e && e.status !== 'FAILED') { skipped.push({ id, docNo: inv.docNo, reason: `Already ${e.status.toLowerCase()}` }); continue; }
    await prisma.$transaction([
      e
        ? prisma.eInvoiceQueue.update({ where: { id: e.id }, data: { status: 'PENDING', lastError: null } })
        : prisma.eInvoiceQueue.create({ data: { invoiceId: id, createdBy: req.user?.id } }),
      prisma.salesInvoice.update({ where: { id }, data: { einvStatus: 'PENDING' } }),
      prisma.eInvoiceLog.create({ data: { level: 'INFO', invoiceId: id, message: `${inv.docNo} added to the e-invoice queue` } }),
    ]);
    queued.push(id);
  }
  res.status(201).json({ queued: queued.length, skipped });
}));

router.delete('/queue/:id', can('einvoice', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  const item = await prisma.eInvoiceQueue.findUnique({ where: { id } });
  if (!item) throw notFound('Queue item not found');
  if (item.status === 'CLEARED') throw conflict('A cleared e-invoice cannot be removed from the queue');
  await prisma.$transaction([
    prisma.eInvoiceQueue.delete({ where: { id } }),
    prisma.salesInvoice.update({ where: { id: item.invoiceId }, data: { einvStatus: 'NONE', einvUuid: null } }),
    prisma.eInvoiceLog.create({ data: { level: 'INFO', invoiceId: item.invoiceId, message: 'Removed from the e-invoice queue' } }),
  ]);
  await audit(prisma, req.user, 'DELETE', 'eInvoiceQueue', id, { invoiceId: item.invoiceId });
  res.json({ ok: true });
}));

router.post('/submit/:id', can('einvoice', 'post'), ah(async (req, res) => {
  const r = await submitItem(intParam(req));
  if (!r.ok) throw conflict(r.error);
  res.json({ status: 'CLEARED', uuid: r.uuid });
}));

router.post('/submit-all', can('einvoice', 'post'), ah(async (_req, res) => {
  const pending = await prisma.eInvoiceQueue.findMany({ where: { status: 'PENDING' }, orderBy: { id: 'asc' }, take: 200 });
  let cleared = 0;
  let failed = 0;
  for (const p of pending) {
    const r = await submitItem(p.id);
    if (r.ok) cleared++; else failed++;
  }
  res.json({ processed: pending.length, cleared, failed });
}));

// Logs
router.get('/logs', can('einvoice', 'view'), ah(async (req, res) => {
  const where: Record<string, unknown> = {};
  if (req.query.level) where.level = String(req.query.level);
  if (req.query.invoiceId) where.invoiceId = Number(req.query.invoiceId);
  const rows = await prisma.eInvoiceLog.findMany({ where, orderBy: { id: 'desc' }, take: 200 });
  res.json(rows);
}));

// UBL XML preview + validation for one invoice (does NOT submit anything)
router.get('/invoice/:id/xml', can('einvoice', 'view'), ah(async (req, res) => {
  const loaded = await loadInvoice(intParam(req));
  const cfg = await getSettings();
  const { errors, warnings } = validateInvoice(loaded, cfg);
  res.json({
    docNo: loaded.inv.docNo,
    mode: cfg.mode,
    valid: errors.length === 0,
    errors,
    warnings,
    xml: buildUbl(loaded, cfg),
  });
}));

export default [{ path: '/einvoice', router }] satisfies ModuleDef[];
