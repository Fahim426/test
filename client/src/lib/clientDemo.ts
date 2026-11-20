import type { DriveStep, Driver } from 'driver.js';
import { api } from '@/lib/api';
import { useAuth, hasPermission } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { screenEnabled, type ProductConfig } from '@/hooks/useProductConfig';
import { makeTour, stopTour } from './tour';
import './clientDemo.css';

type Row = { id: number; [key: string]: any };
type Scene = {
  chapter: string;
  title: string;
  body: string;
  screen?: string;
  params?: Record<string, unknown>;
  focus?: string;
  tab?: string;
};
const CHAPTERS = [
  'Business overview',
  'Products & purchasing',
  'Customer sale',
  'Machine & AMC',
  'Management control',
  'Staff & setup',
];
const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (v: unknown) => '<b>AED ' + money(v) + '</b>';
const shown = (e: Element | null | undefined): e is HTMLElement => !!e && e.getClientRects().length > 0;
const target = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(shown);
let endCurrent: (() => void) | undefined;

/** Presentation only. Owns temporary tabs and blocks application mutations until Exit. */
export async function startClientDemo() {
  endCurrent?.();
  stopTour();
  const user = useAuth.getState().user;
  if (!user) return;
  const baseline = useWorkspaceStore.getState(),
    originalActive = baseline.activeId,
    owned = new Set<string>();
  const controller = new AbortController();
  let ended = false,
    replacing = false,
    tour: Driver | undefined,
    ticket = 0,
    busy = false;
  const reportKeys = ['rpt.params.branch-performance', 'rpt.params.gross-profit'];
  const reportState = new Map<string, string | null>();
  for (const key of reportKeys)
    try {
      reportState.set(key, localStorage.getItem(key));
    } catch {}
  let unsubscribe = () => {};
  const guard = api.interceptors.request.use((cfg) => {
    if (!['get', 'head', 'options'].includes((cfg.method || 'get').toLowerCase()))
      return Promise.reject(new Error('Client Demo is read-only. Exit the demo before saving or changing records.'));
    return cfg;
  });
  const cleanup = () => {
    if (ended) return;
    ended = true;
    ticket++;
    controller.abort();
    unsubscribe();
    api.interceptors.request.eject(guard);
    useWorkspaceStore.setState((s) => {
      const tabs = s.tabs.filter((t) => !owned.has(t.id));
      return {
        tabs,
        activeId: tabs.some((t) => t.id === originalActive)
          ? originalActive
          : (tabs.find((t) => t.id === s.activeId)?.id ?? tabs[0]?.id ?? null),
        closed: s.closed.filter((t) => !t.instanceKey.startsWith('client-demo:')),
      };
    });
    for (const [key, value] of reportState)
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {}
    if (endCurrent === exit) endCurrent = undefined;
  };
  const exit = () => {
    tour?.destroy();
    cleanup();
  };
  endCurrent = exit;
  const identity = (u: typeof user | null) =>
    u ? [u.id, u.role, u.branchId ?? '', ...u.permissions.slice().sort()].join('|') : '';
  const initialIdentity = identity(user);
  unsubscribe = useAuth.subscribe((s) => {
    if (identity(s.user) !== initialIdentity) exit();
  });
  const destroy = () => {
    if (!replacing) cleanup();
  };
  tour = makeTour(
    [
      {
        popover: {
          title: 'Preparing Client Demo',
          description:
            'Loading existing demonstration records. This presentation is read-only. Close it at any time to return to your workspace.',
        },
      },
    ],
    'Client Demo',
    { popoverClass: 'ss-tour ss-client-demo', disableButtons: ['next'], onDestroyed: destroy },
  );
  const get = async (path: string, params?: Record<string, unknown>) =>
    (await api.get(path, { params, signal: controller.signal, timeout: 15000 })).data;
  try {
    const [config, status] = await Promise.all([get('/product-config') as Promise<ProductConfig>, get('/demo-status')]);
    if (ended) return;
    const allowed = (id: string) => {
      const d = getScreen(id);
      return (
        !!d &&
        screenEnabled(id, config.features) &&
        (!d.permission ||
          hasPermission(
            user.permissions,
            ...(d.permission.includes(':')
              ? (d.permission.split(':') as [string, string])
              : ([d.permission, 'view'] as [string, string])),
          ))
      );
    };
    // Fixed sample identifiers are resolved through authorised APIs, never trusted database IDs.
    // Scoped/non-admin presenters use their permitted list screens without borrowing global demo records.
    const examples = status.active && user.role === 'Admin' && user.branchId == null;
    const sample = async (screen: string, url: string, field: string, code: string): Promise<Row | null> => {
      if (!examples || !allowed(screen)) return null;
      try {
        const list = await get(url, { search: code, pageSize: 20 });
        const row = (Array.isArray(list) ? list : (list.rows ?? [])).find((r: Row) => r[field] === code);
        if (!row) return null;
        return await get(url + '/' + row.id);
      } catch {
        return null;
      }
    };
    const [product, purchase, invoice, receipt, amc, renewal, unit] = await Promise.all([
      sample('product-form', '/products', 'code', 'GX-15300'),
      sample('purchase-invoice-form', '/purchase-invoices', 'docNo', 'PI-2026-00005'),
      sample('sales-invoice-form', '/sales-invoices', 'docNo', 'SI-2026-00001'),
      sample('bank-receipt-form', '/receipts', 'voucherNo', 'RV-2026-00001'),
      sample('amc-form', '/amc', 'contractNo', 'AMC-2026-00012'),
      sample('amc-form', '/amc', 'contractNo', 'AMC-2025-00001'),
      (async () => {
        if (!examples || !allowed('equipment-register')) return null;
        try {
          const list = await get('/equipment-units');
          return ((list.rows ?? []).find((r: Row) => r.serialNo === 'DEMO-F7-SERIAL-1') as Row) ?? null;
        } catch {
          return null;
        }
      })(),
    ]);
    const detail = async (screen: string, url: string, id: unknown): Promise<Row | null> => {
      if (!id || !allowed(screen)) return null;
      try {
        return await get(url + '/' + id);
      } catch {
        return null;
      }
    };
    const [order, delivery, po, grn] = await Promise.all([
      detail('sales-order-form', '/sales-orders', invoice?.salesOrderId),
      detail('delivery-note-form', '/delivery-notes', invoice?.deliveryId),
      detail('purchase-order-form', '/purchase-orders', purchase?.orderId),
      detail('goods-receipt-form', '/goods-receipts', purchase?.receiptId),
    ]);
    const quotation = await detail('sales-quotation-form', '/sales-quotations', order?.quotationId);
    if (ended) return;
    const scenes: Scene[] = [
      {
        chapter: 'Welcome',
        title: 'Client Demo: the business story',
        body:
          'A guided, 20-25 minute presentation for ' +
          esc(config.company?.name || config.appName) +
          '. Choose a chapter to jump straight to a question. <b>Only existing screens and saved records are opened; no business data is created, posted, paid or changed.</b><br><br>' +
          (status.active
            ? 'Figures and customer names belong to the fictional demonstration dataset.'
            : 'No seeded demo dataset is installed here. Examples are omitted; only permitted screens will be shown.') +
          ' Exit closes the demo-owned tabs and returns to your original workspace.',
      },
    ];
    const add = (
      chapter: number,
      title: string,
      body: string,
      screen?: string,
      params?: Record<string, unknown>,
      focus?: string,
      tab?: string,
    ) => {
      if (screen && !allowed(screen)) return;
      if (!screen && focus && !target(focus)) return;
      scenes.push({ chapter: CHAPTERS[chapter], title, body, screen, params, focus, tab });
    };
    const record = (
      chapter: number,
      title: string,
      body: string,
      form: string,
      list: string,
      row: Row | null,
      focus?: string,
      tab?: string,
    ) => {
      const screen = row ? form : list;
      add(
        chapter,
        title,
        body +
          (row
            ? '<br><br><small>Saved example: ' +
              esc(row.docNo || row.contractNo || row.voucherNo || row.code) +
              '</small>'
            : '<br><br><small>A matching demo record is not available in this role. This is the permitted list screen; no example amounts are assumed.</small>'),
        screen,
        row ? { id: row.id } : undefined,
        row ? focus : undefined,
        row ? tab : undefined,
      );
    };
    const preset = { preset: { from: '2026-10-20', to: '2026-11-19' } };
    add(
      0,
      'ERP: one connected workspace',
      'ERP means Enterprise Resource Planning. Sales, purchasing, stock, accounts and service teams work from linked records. The dashboard is a starting point for management questions. <b>Sales, cash, stock and profit are different measures.</b>',
      'dashboard',
    );
    add(
      0,
      'What should the owner check?',
      'Review sales and purchases, customer receivables, supplier payables, stock value and pending work. Check the selected period and VAT basis before comparing two amounts. Due-date reminders and today-based cards can change as the calendar moves.',
      'dashboard',
    );
    record(
      1,
      'Identify the machine',
      'A product code identifies the model, while a serial number identifies one physical machine. ' +
        (product
          ? 'Our saved example is <b>' + esc(product.code) + ' - ' + esc(product.name) + '</b>.'
          : 'Start with the product catalogue.'),
      'product-form',
      'products',
      product,
    );
    if (config.features.productImages && product)
      record(
        1,
        'Help the team recognise the product',
        'A product photo helps staff and customers recognise the equipment. Stored product images can appear on newly generated invoices. The tour does not upload or replace the image.',
        'product-form',
        'products',
        product,
        'demo-product-photo',
        'general',
      );
    record(
      1,
      'Cost and selling price',
      'Compare recorded catalogue cost and selling price. ' +
        (product
          ? 'For ' +
            esc(product.code) +
            ': cost ' +
            amount(product.costPrice) +
            ', retail ' +
            amount(product.retailPrice) +
            '. '
          : '') +
        'Actual transaction gross profit uses the cost captured by the posting workflow; catalogue cost alone is not final company profit.',
      'product-form',
      'products',
      product,
      'demo-section-pricing-stock-levels',
      'pricing',
    );
    record(
      1,
      'Available stock and warehouse location',
      'Review which warehouse holds the machine, what is reserved and what is available to fulfil new orders. A reservation is a commitment, not a physical dispatch.',
      'product-form',
      'products',
      product,
      undefined,
      'stock',
    );
    record(
      1,
      'Order from the supplier',
      'The purchase order records the supplier, quantities, agreed cost and delivery terms. ' +
        (po ? 'This example is ' + esc(po.docNo) + '. ' : '') +
        'This replenishment example is separate from the earlier customer sale shown in the next chapter.',
      'purchase-order-form',
      'purchase-orders',
      po,
    );
    record(
      1,
      'Confirm what arrived',
      'The goods receipt confirms the quantities actually received into the warehouse. Posting this document records the stock movement; entering a purchase order alone does not mean stock arrived.',
      'goods-receipt-form',
      'goods-receipts',
      grn,
    );
    record(
      1,
      'Understand the supplier bill',
      purchase
        ? 'Purchase invoice <b>' +
            esc(purchase.docNo) +
            '</b>: before VAT ' +
            amount(Number(purchase.subtotal) - Number(purchase.discount)) +
            ', VAT ' +
            amount(purchase.vatAmount) +
            ', total ' +
            amount(purchase.total) +
            '. Paid ' +
            amount(purchase.paidAmount) +
            ', remaining ' +
            amount(Number(purchase.baseTotal) - Number(purchase.paidAmount)) +
            '. An allocated supplier payment reduces the remaining balance.'
        : 'Review the supplier invoice, VAT, paid amount and remaining balance. A bill does not itself prove payment.',
      'purchase-invoice-form',
      'purchase-invoices',
      purchase,
      'demo-document-totals',
    );
    record(
      2,
      'Begin with the customer offer',
      'The quotation records the proposed equipment, price, quantities and terms. ' +
        (quotation ? 'Saved quotation: ' + esc(quotation.docNo) + '. ' : '') +
        'When accepted, authorised staff use the conversion actions to create the next document. We are only viewing the existing example.',
      'sales-quotation-form',
      'sales-quotations',
      quotation,
    );
    record(
      2,
      'Confirm the sales order',
      'The sales order connects the accepted offer to warehouse fulfilment. ' +
        (order ? 'Saved order: ' + esc(order.docNo) + '. ' : '') +
        'Approval and stock reservation follow the configured process. Follow the document links to see the quotation and fulfilment records.',
      'sales-order-form',
      'sales-orders',
      order,
    );
    add(
      2,
      'Pick and pack the machines',
      'Picking identifies the stock to collect for the order. Packing records the prepared quantities and dispatch details. These list screens show saved work; the tour never creates picking or packing documents.',
      'pickings',
    );
    add(
      2,
      'Prepare the dispatch',
      'Check the packing record and its related order, quantities and boxes before delivery. Staff use the document actions to continue the workflow outside this read-only presentation.',
      'packing-lists',
    );
    record(
      2,
      'Record the delivery',
      'The posted delivery note confirms what left the warehouse. ' +
        (delivery ? 'The linked saved example is ' + esc(delivery.docNo) + '. ' : '') +
        'The delivery is linked to the sales order and invoice.',
      'delivery-note-form',
      'delivery-notes',
      delivery,
    );
    record(
      2,
      'Read the customer invoice',
      invoice
        ? 'Invoice <b>' +
            esc(invoice.docNo) +
            '</b> bills ' +
            amount(invoice.total) +
            ' including recorded VAT. The customer and document links explain where the invoice came from.'
        : 'The invoice records the customer bill and related accounting; it is separate from receiving payment.',
      'sales-invoice-form',
      'sales-invoices',
      invoice,
    );
    record(
      2,
      'Separate revenue, VAT and cash',
      invoice
        ? 'Sales before VAT: ' +
            amount(Number(invoice.subtotal) - Number(invoice.discount)) +
            '. VAT: ' +
            amount(invoice.vatAmount) +
            '. Total: ' +
            amount(invoice.total) +
            '. Received / credited: ' +
            amount(invoice.receivedAmount) +
            '. Outstanding: ' +
            amount(Number(invoice.baseTotal) - Number(invoice.receivedAmount)) +
            '.<br><br>Recorded cost of goods sold: ' +
            amount(invoice.cogs) +
            '. Gross profit before overheads: ' +
            amount(Number(invoice.subtotal) - Number(invoice.discount) - Number(invoice.cogs)) +
            '. Gross profit is not final profit after rent, salaries and other expenses.'
        : 'Compare sales before VAT, VAT, total, received amount and remaining balance. Gross profit is before overheads.',
      'sales-invoice-form',
      'sales-invoices',
      invoice,
      'demo-document-totals',
    );
    record(
      2,
      'Link the customer payment',
      receipt
        ? 'Saved receipt <b>' +
            esc(receipt.voucherNo) +
            '</b> records ' +
            amount(receipt.amount) +
            '. Check its allocations to see which invoice it settles. A receipt is money received; the invoice is the bill.'
        : 'Record and allocate a customer receipt when payment arrives. Allocations reduce invoice dues.',
      'bank-receipt-form',
      'bank-receipts',
      receipt,
    );
    add(
      3,
      'Find the exact machine',
      unit
        ? 'Trace <b>' +
            esc(unit.serialNo) +
            '</b> through its recorded customer, warehouse/delivery, installation, warranty and AMC links. Registration adds identity to existing posted transactions; it does not post another stock movement.'
        : 'The serial register identifies individual physical machines and their recorded customer/history links. Serial enrollment is currently optional.',
      'equipment-register',
      undefined,
      unit ? 'demo-machine-' + unit.id : undefined,
    );
    record(
      3,
      'Show the maintenance commitment',
      amc
        ? 'Contract <b>' +
            esc(amc.contractNo) +
            '</b> is linked to serial ' +
            esc(amc.serialNo) +
            '. Its recorded fee before VAT is ' +
            amount(amc.amount) +
            '. Review the dates and completed/scheduled visits. Contract fees are not actual service-job profit.'
        : 'AMC records hold the contract, dates, fee and planned service visits. Actual service profitability needs complete linked labour, travel and parts costs.',
      'amc-form',
      'amc-contracts',
      amc,
    );
    record(
      3,
      'Follow up before renewal',
      'This example illustrates an approaching expiry. Review the recorded end date and next visit, then assign renewal follow-up. The live reminder changes as dates move; do not assume a fixed number of days remains.',
      'amc-form',
      'amc-contracts',
      renewal,
    );
    add(
      3,
      'Keep follow-up visible',
      'The Reminder Centre helps staff review dated payments, AMC renewals and service visits from modules they may view. Acknowledging a reminder is not the same as paying an invoice or completing a visit. Messages are in-app; external email/WhatsApp delivery is separate scope.',
      'reminder-centre',
    );
    add(
      4,
      'Compare the branches',
      'Compare sales before VAT, recorded cost, gross profit and margin for the prepared period 20 Oct-19 Nov 2026. A higher sales total does not automatically mean a higher margin. Stock valuation is a current snapshot, independent of the sales date range.',
      'branch-performance',
      preset,
    );
    add(
      4,
      'Understand the profit measure',
      'Gross profit is revenue less recorded cost of goods sold. It is before overheads. Review the date range, source documents and return treatment when reconciling reports.',
      'gross-profit',
      preset,
    );
    record(
      4,
      'Who changed this record?',
      'On supported records, Edit History shows the recorded employee, time and previous/new values. It supports accountability. Older values cannot be reconstructed if they were never logged, and coverage varies by module.',
      'product-form',
      'products',
      product,
      'demo-edit-history',
      'general',
    );
    add(
      4,
      'Who is waiting for approval?',
      "Approval rules determine which documents require review and who can approve them. The presenter can show pending work; the tour never approves or rejects anything. Configure the customer's policy before go-live.",
      'pending-approvals',
    );
    add(
      5,
      'Give staff the right tools',
      'The HR overview provides access to employee records and the configured attendance, leave and payroll functions. Review user permissions and HR/payroll scope with management before implementation.',
      'hr-dashboard',
    );
    add(
      5,
      'Review the employee directory',
      'Staff information is available to authorised roles. This demonstration opens the directory only; no employee, attendance, leave or payroll data is changed.',
      'hr-employees',
    );
    add(
      5,
      'Configure the workspace',
      'Company & Modules controls branding and optional features such as part numbers, compatibility, AMC, HR, serial tracking, assistant and product images. Switching features off preserves records. This tour only highlights the settings; it never changes them.',
      'company-configuration',
      undefined,
      'demo-company-modules',
    );
    if (config.features.assistant)
      add(
        5,
        'Ask a business question',
        'The ERP assistant answers supported questions in plain English, such as "Who owes us money?" or "Sales in Dubai this month?" It is rule-based and read-only, with role/branch checks. This presentation highlights it without sending a question or feedback.',
        undefined,
        undefined,
        'assistant',
      );
    scenes.push({
      chapter: 'Finish',
      title: 'Agree the next step with management',
      body: 'Confirm branches/users, approval rules, serial and service requirements, migration scope and who signs off the balances. Tally migration and full accounting/access validation remain go-live work. Actual service-job costing, mandatory serial scanning and external messaging are separate extensions.<br><br><b>Finish or Exit restores your original tabs. No business records have been created or changed by this walkthrough.</b>',
    });
    const steps: DriveStep[] = scenes.map((scene) => ({
      element: scene.screen || scene.focus ? () => targetFor(scene) ?? (undefined as unknown as Element) : undefined,
      popover: { title: esc(scene.title), description: scene.body, side: 'left', align: 'center' },
    }));
    const screenTarget = (scene: Scene) => (scene.screen ? target('screen-' + scene.screen) : undefined);
    function targetFor(scene: Scene) {
      const screen = screenTarget(scene);
      return scene.focus ? (target(scene.focus, screen ?? document) ?? screen) : screen;
    }
    const chapters = CHAPTERS.filter((c) => scenes.some((s) => s.chapter === c));
    const first = (chapter: string) => scenes.findIndex((s) => s.chapter === chapter);
    const go = async (index: number) => {
      if (ended || busy) return;
      if (index >= scenes.length || index < 0) {
        exit();
        return;
      }
      busy = true;
      const turn = ++ticket;
      const scene = scenes[index];
      try {
        if (scene.screen) {
          if (!allowed(scene.screen)) {
            busy = false;
            void go(index + (index > (tour?.getActiveIndex() ?? 0) ? 1 : -1));
            return;
          }
          const id = useWorkspaceStore.getState().open({
            screenId: scene.screen,
            params: scene.params,
            title: getScreen(scene.screen)?.title,
            instanceKey: 'client-demo:' + scene.screen + ':' + JSON.stringify(scene.params ?? {}),
          });
          owned.add(id);
          for (let i = 0; i < 80 && !target('screen-' + scene.screen); i++) {
            if (ended || turn !== ticket) return;
            await new Promise((r) => setTimeout(r, 30));
          }
          if (scene.tab) {
            for (let i = 0; i < 60; i++) {
              if (ended || turn !== ticket) return;
              const button = target('document-tab-' + scene.tab, target('screen-' + scene.screen) ?? document);
              if (button) {
                button.click();
                break;
              }
              await new Promise((r) => setTimeout(r, 30));
            }
          }
          if (scene.focus) {
            for (let i = 0; i < 50; i++) {
              if (ended || turn !== ticket) return;
              if (target(scene.focus, target('screen-' + scene.screen) ?? document)) break;
              await new Promise((r) => setTimeout(r, 30));
            }
          }
        }
        if (!ended && turn === ticket) tour?.moveTo(index);
      } finally {
        busy = false;
      }
    };
    replacing = true;
    tour.destroy();
    replacing = false;
    tour = makeTour(steps, 'Client Demo', {
      popoverClass: 'ss-tour ss-client-demo',
      onNextClick: () => void go((tour?.getActiveIndex() ?? 0) + 1),
      onPrevClick: () => void go((tour?.getActiveIndex() ?? 0) - 1),
      onDestroyed: destroy,
      onPopoverRender: (popover, opts) => {
        const index = opts.driver.getActiveIndex() ?? 0,
          scene = scenes[index];
        // Replace the general tour's Skip control with chapter navigation.
        for (const b of [...popover.footer.querySelectorAll('button')]) if (b.textContent === 'Skip tour') b.remove();
        const nav = document.createElement('div');
        nav.className = 'ss-demo-nav';
        const label = document.createElement('label');
        label.textContent = 'Jump to chapter';
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Client Demo chapter');
        const intro = document.createElement('option');
        intro.value = '0';
        intro.textContent = 'Welcome';
        select.append(intro);
        for (const c of chapters) {
          const option = document.createElement('option');
          option.value = String(first(c));
          option.textContent = c;
          select.append(option);
        }
        const finish = document.createElement('option');
        finish.value = String(scenes.length - 1);
        finish.textContent = 'Finish / next steps';
        select.append(finish);
        select.value = String(first(scene.chapter));
        select.onchange = () => void go(Number(select.value));
        label.append(select);
        nav.append(label);
        popover.title.before(nav);
        const meta = document.createElement('div');
        meta.className = 'ss-demo-status';
        meta.textContent = scene.chapter + ' | Read-only demo';
        popover.description.before(meta);
        const controls = document.createElement('div');
        controls.className = 'ss-demo-controls';
        const nextChapter = chapters.map(first).find((i) => i > index) || scenes.length - 1;
        if (index < scenes.length - 1) {
          const skip = document.createElement('button');
          skip.type = 'button';
          skip.textContent = 'Skip chapter';
          skip.onclick = () => void go(nextChapter);
          controls.append(skip);
        }
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.textContent = 'Exit demo';
        leave.onclick = exit;
        controls.append(leave);
        popover.footer.prepend(controls);
      },
    });
  } catch (error) {
    if (ended) return;
    replacing = true;
    tour?.destroy();
    replacing = false;
    tour = makeTour(
      [
        {
          popover: {
            title: 'Client Demo could not load',
            description:
              'The saved examples could not be read right now. Check the connection and your access, then replay Client Demo from the profile menu. No business data was changed.',
          },
        },
      ],
      'Client Demo',
      { onDestroyed: destroy },
    );
  }
}
