import type { AuthUser } from '../middleware/auth';
import type { Entities, IndexedRecord, RecordKind } from './types';
export class AccessError extends Error {}
export const canView=(user:AuthUser,module:string)=>user.role==='Admin'||user.permissions.has(module+':view');
export function branchScope(user:AuthUser,e:Entities={}):number|null{
 if(user.branchId!=null){if(e.branchId!=null&&e.branchId!==user.branchId)throw new AccessError('That branch is outside your access. I can only show your assigned branch.');return user.branchId;}
 if(user.role!=='Admin')throw new AccessError('Your account needs an assigned branch before the assistant can read company data. Ask an administrator to assign it.');
 return e.branchId??null;
}
export const kindByType:Record<string,RecordKind>={Product:'product',Customer:'customer',Supplier:'supplier',Employee:'employee',EquipmentUnit:'unit',SalesInvoice:'salesInvoice',PurchaseInvoice:'purchaseInvoice',SalesOrder:'salesOrder',PurchaseOrder:'purchaseOrder',SalesQuotation:'quotation',GoodsReceipt:'receipt',AmcContract:'amc'};
export const sourcePermission:Record<string,string>={Product:'products',Customer:'customers',Supplier:'suppliers',Employee:'hr_employees',EquipmentUnit:'products',SalesInvoice:'sales_invoice',PurchaseInvoice:'purchase_invoice',SalesOrder:'sales_order',PurchaseOrder:'purchase_order',SalesQuotation:'sales_quotation',GoodsReceipt:'goods_receipt',AmcContract:'amc'};
export function validateEntities(e:Entities,index:IndexedRecord[]){
 for(const[field,kind]of Object.entries({productId:'product',customerId:'customer',supplierId:'supplier',employeeId:'employee',branchId:'branch',unitId:'unit'})){const value=(e as any)[field];if(value!==undefined&&!index.some(r=>r.kind===kind&&String(r.id)===String(value)))throw new AccessError('I cannot match that record within your permitted data. Give its name or code.');}
 if(e.recordType&&e.recordId&&!index.some(r=>r.kind===kindByType[e.recordType!]&&String(r.id)===e.recordId))throw new AccessError('I cannot match that record within your permitted data. Give its current document code.');
}
