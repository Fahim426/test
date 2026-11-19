import { prisma, Prisma } from '../lib/prisma';
import type { AuthUser } from '../middleware/auth';
import type { IndexedRecord } from './types';
import { branchScope, canView } from './security';
const cache=new Map<string,{expires:number;records:IndexedRecord[]}>();
export function clearIndexCache(){cache.clear();}
export async function loadIndex(user:AuthUser):Promise<IndexedRecord[]>{
 const branch=branchScope(user),key=[user.id,branch,[...user.permissions].sort().join(','),user.role].join('|');const old=cache.get(key);if(old&&old.expires>Date.now())return old.records;
 const records:IndexedRecord[]=[];
 const add=async(kind:IndexedRecord['kind'],sql:Prisma.Sql)=>{const rows=await prisma.$queryRaw<Record<string,any>[]>(sql);records.push(...rows.map(r=>({kind,id:r.id,code:String(r.code),name:String(r.name),...(r.aliases?{aliases:String(r.aliases).split('|').filter(Boolean)}:{})})));};
 // Branch names are shared master metadata, also used to refuse an explicitly requested inaccessible branch.
 await add('branch',Prisma.sql`SELECT id,code,name FROM Branch WHERE isActive=1 ORDER BY id LIMIT 10000`);
 if(canView(user,'products'))await add('product',Prisma.sql`SELECT p.id,p.code,p.name,(SELECT GROUP_CONCAT(pn.number SEPARATOR '|') FROM ProductPartNumber pn WHERE pn.productId=p.id) aliases FROM Product p ORDER BY p.id LIMIT 10000`);
 if(['customers','sales_invoice','sales_order','sales_quotation'].some(p=>canView(user,p)))await add('customer',Prisma.sql`SELECT c.id,c.code,c.name FROM Customer c WHERE (${branch} IS NULL OR EXISTS(SELECT 1 FROM SalesOrder so JOIN Warehouse w ON w.id=so.warehouseId WHERE so.customerId=c.id AND w.branchId=${branch}) OR EXISTS(SELECT 1 FROM SalesQuotation q JOIN Warehouse w ON w.id=q.warehouseId WHERE q.customerId=c.id AND w.branchId=${branch})) ORDER BY c.id LIMIT 10000`);
 if(['suppliers','purchase_invoice','purchase_order','goods_receipt'].some(p=>canView(user,p)))await add('supplier',Prisma.sql`SELECT s.id,s.code,s.name FROM Supplier s WHERE (${branch} IS NULL OR EXISTS(SELECT 1 FROM PurchaseOrder po JOIN Warehouse w ON w.id=po.warehouseId WHERE po.supplierId=s.id AND w.branchId=${branch})) ORDER BY s.id LIMIT 10000`);
 if(canView(user,'hr_employees'))await add('employee',Prisma.sql`SELECT id,employeeNo code,fullName name FROM Employee WHERE (${branch} IS NULL OR branchId=${branch}) ORDER BY id LIMIT 10000`);
 if(canView(user,'products'))await add('unit',Prisma.sql`SELECT JSON_UNQUOTE(JSON_EXTRACT(value,'$.id')) id,JSON_UNQUOTE(JSON_EXTRACT(value,'$.serialNo')) code,JSON_UNQUOTE(JSON_EXTRACT(value,'$.serialNo')) name FROM SystemSetting WHERE \`key\` LIKE 'equipment.unit.%' AND (${branch} IS NULL OR CAST(JSON_UNQUOTE(JSON_EXTRACT(value,'$.branchId')) AS UNSIGNED)=${branch}) LIMIT 10000`);
 if(canView(user,'sales_invoice'))await add('salesInvoice',Prisma.sql`SELECT i.id,i.docNo code,i.docNo name FROM SalesInvoice i LEFT JOIN SalesOrder so ON so.id=i.salesOrderId LEFT JOIN DeliveryNote dn ON dn.id=i.deliveryId LEFT JOIN Warehouse w ON w.id=COALESCE(so.warehouseId,dn.warehouseId) WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY i.id LIMIT 10000`);
 if(canView(user,'purchase_invoice'))await add('purchaseInvoice',Prisma.sql`SELECT i.id,i.docNo code,i.docNo name FROM PurchaseInvoice i LEFT JOIN PurchaseOrder po ON po.id=i.orderId LEFT JOIN Warehouse w ON w.id=po.warehouseId WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY i.id LIMIT 10000`);
 if(canView(user,'sales_order'))await add('salesOrder',Prisma.sql`SELECT so.id,so.docNo code,so.docNo name FROM SalesOrder so LEFT JOIN Warehouse w ON w.id=so.warehouseId WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY so.id LIMIT 10000`);
 if(canView(user,'purchase_order'))await add('purchaseOrder',Prisma.sql`SELECT po.id,po.docNo code,po.docNo name FROM PurchaseOrder po LEFT JOIN Warehouse w ON w.id=po.warehouseId WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY po.id LIMIT 10000`);
 if(canView(user,'sales_quotation'))await add('quotation',Prisma.sql`SELECT q.id,q.docNo code,q.docNo name FROM SalesQuotation q LEFT JOIN Warehouse w ON w.id=q.warehouseId WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY q.id LIMIT 10000`);
 if(canView(user,'goods_receipt'))await add('receipt',Prisma.sql`SELECT g.id,g.docNo code,g.docNo name FROM GoodsReceipt g LEFT JOIN Warehouse w ON w.id=g.warehouseId WHERE (${branch} IS NULL OR w.branchId=${branch}) ORDER BY g.id LIMIT 10000`);
 if(canView(user,'amc'))await add('amc',Prisma.sql`SELECT c.id,c.contractNo code,c.contractNo name FROM AmcContract c WHERE (${branch} IS NULL OR EXISTS(SELECT 1 FROM SystemSetting u WHERE u.\`key\` LIKE 'equipment.unit.%' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.amcId')) AS UNSIGNED)=c.id AND CAST(JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.branchId')) AS UNSIGNED)=${branch})) ORDER BY c.id LIMIT 10000`);
 if(cache.size>1000)cache.clear();cache.set(key,{expires:Date.now()+15000,records});return records;
}
