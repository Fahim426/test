import { driver, type Config, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { useAuth, hasPermission } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
const KEY = 'ss-tour-seen-v1';
let active: Driver | undefined;
let storageFailed = false;
export function tourSeen() {
  if (storageFailed) return true;
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    storageFailed = true;
    return true;
  }
}
function seen() {
  try {
    localStorage.setItem(KEY, 'true');
  } catch {
    storageFailed = true;
  }
}
function visible(name: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(
    (e) => e.getClientRects().length > 0,
  );
}
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function makeTour(steps: DriveStep[], label: string, extraConfig: Config = {}) {
  active?.destroy();
  const tour = driver({
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    allowClose: true,
    allowKeyboardControl: true,
    stagePadding: 6,
    stageRadius: 10,
    smoothScroll: true,
    nextBtnText: 'Next →',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    popoverClass: 'ss-tour',
    disableActiveInteraction: true,
    ...extraConfig,
    steps,
    onPopoverRender: (popover, opts) => {
      const index = opts.driver.getActiveIndex() ?? 0,
        total = steps.length;
      const bar = document.createElement('div');
      bar.className = 'ss-tour-progress';
      const fill = document.createElement('span');
      fill.style.width = ((index + 1) / total) * 100 + '%';
      bar.append(fill);
      popover.wrapper.prepend(bar);
      const eyebrow = document.createElement('div');
      eyebrow.className = 'ss-tour-eyebrow';
      const badge = document.createElement('span');
      badge.textContent = String(index + 1);
      eyebrow.append(badge, document.createTextNode(' ' + label.toUpperCase()));
      popover.title.before(eyebrow);
      if (index < total - 1) {
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'ss-tour-skip';
        skip.textContent = 'Skip tour';
        skip.onclick = () => opts.driver.destroy();
        popover.footer.prepend(skip);
      }
      extraConfig.onPopoverRender?.(popover, opts);
    },
    onDestroyed: (el, step, opts) => {
      seen();
      if (active === tour) active = undefined;
      extraConfig.onDestroyed?.(el, step, opts);
    },
  });
  active = tour;
  tour.drive();
  return tour;
}
export function tourRunning() { return !!active?.isActive(); }
export function stopTour() {
  active?.destroy();
}
export function startTour() {
  const app = document.title || 'ERP';
  const steps: DriveStep[] = [
    {
      popover: {
        title: 'Welcome to ' + escape(app),
        description:
          'A quick look at the main controls. Use the arrow keys to move between steps. Replay any time from your profile menu.',
      },
    },
  ];
  const entries: [string, string, string, 'bottom' | 'right' | 'left'][] = [
    [
      'modules',
      'Module menu',
      'Choose Home, Finance, Inventory, Reports and the other modules available to your role.',
      'bottom',
    ],
    [
      'ribbon',
      'Module screens',
      'Screens are grouped under the selected module. Click one to open it as a workspace tab.',
      'bottom',
    ],
    [
      'tree',
      'Left tree menu',
      'Expand modules to browse their grouped screens. Collapse the panel into an icon rail when you need more space.',
      'right',
    ],
    [
      'tree-toggle',
      'Choose your navigation',
      'Switch the left tree on or off. When it is on, the top module menu and ribbon are hidden.',
      'bottom',
    ],
    [
      'new',
      'Quick create',
      'Use + New to start an accessible sales order, purchase order, product or voucher.',
      'bottom',
    ],
    [
      'search',
      'Global search',
      'Find products by code, manufacturer or alternate number, and find customers, suppliers and documents. Ctrl+K opens search.',
      'bottom',
    ],
    [
      'tabs',
      'Workspace tabs',
      'Keep screens side by side in tabs. Pin tabs, drag to reorder, or close others / all from the tab menu.',
      'bottom',
    ],
    [
      'assistant',
      'ERP assistant',
      'Ask supported questions in plain English. The assistant is read-only and never changes company records.',
      'left',
    ],
    [
      'user',
      'Your profile menu',
      'Change your password, switch interface, sign out and replay the product or sales-flow tours.',
      'bottom',
    ],
  ];
  for (const [name, title, description, side] of entries) {
    const element = visible(name) || (name === 'search' ? visible('search-icon') : undefined);
    if (element) steps.push({ element, popover: { title, description, side } });
  }
  return makeTour(steps, 'Product tour');
}
const stages = [
  [
    'sales-enquiries',
    'Enquiry',
    'Record the customer requirement and equipment requested. From an enquiry, use Create Quotation to prepare the offer.',
  ],
  [
    'sales-quotations',
    'Quotation',
    'Offer prices, quantities and terms. Use Create Order when accepted, or Create Proforma where your process uses one.',
  ],
  [
    'proforma-invoices',
    'Proforma (optional)',
    'Prepare a preliminary invoice or advance request. Use the document conversion actions to continue to the sales order.',
  ],
  [
    'sales-orders',
    'Sales Order',
    'Confirm the agreed sale and warehouse fulfilment. Approve where required, then use Create Picking.',
  ],
  ['pickings', 'Picking', 'Identify and pick the ordered stock. Confirm picking, then use Create Packing.'],
  ['packing-lists', 'Packing', 'Record the packed quantities and dispatch details. Use Create Delivery to continue.'],
  [
    'delivery-notes',
    'Delivery',
    'Confirm what leaves the warehouse. Post Delivery before creating the linked invoice.',
  ],
  [
    'sales-invoices',
    'Invoice',
    'Record the bill, VAT and customer balance. Post the invoice; record and allocate a customer receipt when payment arrives.',
  ],
  [
    'bank-receipts',
    'Receipt',
    'Record the money received and allocate it to the invoice. A posted, allocated receipt reduces the amount outstanding.',
  ],
];
function allowed(id: string) {
  const def = getScreen(id),
    perms = useAuth.getState().user?.permissions;
  if (!def) return false;
  return (
    !def.permission ||
    hasPermission(
      perms,
      ...(def.permission.includes(':')
        ? (def.permission.split(':') as [string, string])
        : ([def.permission, 'view'] as [string, string])),
    )
  );
}
export function startSalesFlowTour() {
  const available = stages.filter(([id]) => allowed(id));
  const steps: DriveStep[] = [
    {
      popover: {
        title: 'Sales flow walkthrough',
        description:
          'Enquiry → Quotation → (Proforma) → Order → Picking → Packing → Delivery → Invoice → Receipt. This walkthrough only opens list screens. It never creates or changes data. Stages outside your permissions are skipped.',
      },
    },
    ...available.map(([id, title, description]) => ({
      element: () => visible('screen-' + id)!,
      popover: { title, description, side: 'top' as const },
    })),
    {
      popover: {
        title: 'Follow the Document Flow tracker',
        description:
          'Open a document to inspect its Document Flow tracker and linked records. Conversions, approvals and postings are actions performed by authorised staff. This tour did not create or change any business records.',
      },
    },
  ];
  let ticket = 0;
  const go = async (tour: Driver, index: number) => {
    const current = ++ticket;
    if (index < 0 || index >= steps.length) {
      tour.destroy();
      return;
    }
    const stage = available[index - 1];
    if (stage) {
      if (!allowed(stage[0])) {
        void go(tour, index + (index > (tour.getActiveIndex() ?? 0) ? 1 : -1));
        return;
      }
      useWorkspaceStore.getState().open({ screenId: stage[0], title: getScreen(stage[0])?.title });
      for (let i = 0; i < 60 && !visible('screen-' + stage[0]); i++) await new Promise((r) => setTimeout(r, 30));
      if (current !== ticket || !tour.isActive()) return;
      if (!visible('screen-' + stage[0])) {
        void go(tour, index + 1);
        return;
      }
    }
    if (current === ticket && tour.isActive()) tour.moveTo(index);
  };
  return makeTour(steps, 'Sales flow', {
    onNextClick: (_el, _s, { driver: t }) => void go(t, (t.getActiveIndex() ?? 0) + 1),
    onPrevClick: (_el, _s, { driver: t }) => void go(t, (t.getActiveIndex() ?? 0) - 1),
    onDestroyed: () => {
      ticket++;
    },
  });
}
