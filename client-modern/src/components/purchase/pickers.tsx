/* "New ..." pickers of the purchase chain: list the documents that still have items pending for the next step,
   like the sales pickers. Each also offers a blank document for purchases that skip the earlier steps. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FilePlus2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/calc';
import { fmt } from '@/lib/format';
import { colDate, colDoc, colQty, colStatus, SourceCol, SourcePicker } from '@/components/sales/SourcePicker';

interface PickerProps { open: boolean; onClose: () => void }

/** "3 items" (+ "partly done: PR-0004" when an earlier conversion exists) */
const colPending: SourceCol = {
  header: 'Pending items',
  render: (r) => (
    <span>
      <b>{r.pendingLines}</b> item{r.pendingLines === 1 ? '' : 's'}
      {r.started && r.targets && <span className="ml-1.5 text-xs text-ink-muted">(already in {r.targets})</span>}
    </span>
  ),
};
const colWho: SourceCol = { header: 'Requested By', render: (r) => [r.requestedBy, r.department].filter(Boolean).join(' · ') };

function Blank({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button icon={FilePlus2} onClick={onClick} className="mr-auto">{label}</Button>;
}

/** Shared shape: one tab fed by GET /pending/open/:stage, picking runs the conversion and opens the new document. */
function StagePicker({ open, onClose, stage, title, hint, docHeader, extraCols, actionLabel, convert, targetForm, empty, blankLabel, blankForm }: PickerProps & {
  stage: string; title: string; hint: string; docHeader: string; extraCols: SourceCol[]; actionLabel: string;
  convert: (r: any) => Promise<any>; targetForm: string; empty: string; blankLabel: string; blankForm: string;
}) {
  const openScreen = useOpenScreen();
  return (
    <SourcePicker
      open={open}
      title={title}
      hint={hint}
      onClose={onClose}
      footerExtra={<Blank label={blankLabel} onClick={() => { onClose(); openScreen(blankForm, {}, blankLabel); }} />}
      tabs={[{
        key: stage,
        label: title,
        url: `/pending/open/${stage}`,
        empty,
        columns: [colDoc(docHeader, 'docNo'), colDate(), ...extraCols, colPending, colQty('Pending Qty', 'pendingQty'), colStatus],
        actionLabel,
        onPick: async (r) => {
          const d = await convert(r);
          toast.success(`${d.docNo} created from ${r.docNo}`);
          openScreen(targetForm, { id: d.id }, d.docNo);
        },
      }]}
    />
  );
}

export function NewRequisitionPicker(p: PickerProps) {
  return (
    <StagePicker
      {...p}
      stage="MR_PR"
      title="New Requisition - select the material request"
      hint="Approved material requests with items not yet on a requisition. Only the pending items are copied, so a request can be requisitioned in parts."
      docHeader="Request No"
      extraCols={[colWho]}
      actionLabel="Create Requisition"
      convert={async (r) => (await api.post(`/material-requests/${r.id}/create-requisition`, {})).data}
      targetForm="purchase-requisition-form"
      empty="No approved material requests with items waiting for a requisition."
      blankLabel="Blank requisition"
      blankForm="purchase-requisition-form"
    />
  );
}

export function NewEnquiryPicker(p: PickerProps) {
  return (
    <StagePicker
      {...p}
      stage="PR_RFQ"
      title="New Enquiry (RFQ) - select the requisition"
      hint="Approved requisitions with items not yet sent for quotation. Only the pending items are copied; add the suppliers to invite on the new enquiry."
      docHeader="PR No"
      extraCols={[colWho]}
      actionLabel="Create Enquiry"
      convert={async (r) => (await api.post(`/purchase-requisitions/${r.id}/create-enquiry`, { supplierIds: [] })).data}
      targetForm="purchase-enquiry-form"
      empty="No approved requisitions with items waiting for an enquiry."
      blankLabel="Blank enquiry"
      blankForm="purchase-enquiry-form"
    />
  );
}

export function NewPurchaseOrderPicker(p: PickerProps) {
  return (
    <StagePicker
      {...p}
      stage="SQ_PO"
      title="New Purchase Order - select the supplier quotation"
      hint="Selected supplier quotations with items not yet ordered. Supplier, prices and terms come from the quotation; only the pending items are copied."
      docHeader="Quotation No"
      extraCols={[
        { header: 'Supplier', render: (r) => r.supplier?.name ?? '' },
        { header: 'Supplier Ref', render: (r) => r.supplierRef ?? '' },
        { header: 'Total', right: true, render: (r) => `${r.currencyCode ?? ''} ${fmt.money(r.total)}` },
      ]}
      actionLabel="Create PO"
      convert={async (r) => (await api.post(`/supplier-quotations/${r.id}/create-order`, {})).data}
      targetForm="purchase-order-form"
      empty="No selected supplier quotations waiting for a purchase order."
      blankLabel="Blank PO (direct purchase)"
      blankForm="purchase-order-form"
    />
  );
}

/** Quotations are entered per supplier, so this lists enquiries still waiting for supplier replies. */
export function NewQuotationPicker({ open, onClose }: PickerProps) {
  const openScreen = useOpenScreen();
  return (
    <SourcePicker
      open={open}
      title="New Supplier Quotation - select the enquiry"
      hint="Sent enquiries still waiting for supplier replies. The quotation opens with the enquiry's items; choose the supplier and enter the prices."
      onClose={onClose}
      footerExtra={<Blank label="Quotation without enquiry" onClick={() => { onClose(); openScreen('supplier-quotation-form', {}, 'New Quotation'); }} />}
      tabs={[{
        key: 'rfq',
        label: 'Enquiries',
        url: '/purchase-enquiries',
        params: { status: 'SENT,PARTIALLY_QUOTED,QUOTED' },
        filter: (r) => !r.supplierCount || num(r.respondedCount) < num(r.supplierCount) || num(r.pendingCount) > 0,
        empty: 'No sent enquiries waiting for supplier quotations.',
        columns: [
          colDoc('RFQ No', 'docNo'), colDate(),
          { header: 'Items', right: true, render: (r) => r.itemCount },
          { header: 'Suppliers replied', render: (r) => (r.supplierCount ? `${r.respondedCount} of ${r.supplierCount}` : 'no suppliers listed') },
          { header: 'Not quoted yet', right: true, render: (r) => (num(r.pendingCount) > 0 ? `${r.pendingCount} item${r.pendingCount === 1 ? '' : 's'}` : r.respondedCount ? '' : 'all') },
          colStatus,
        ],
        actionLabel: 'Enter Quotation',
        onPick: (r) => { openScreen('supplier-quotation-form', { enquiryId: r.id }, `Quotation for ${r.docNo}`); },
      }]}
    />
  );
}
