import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import type { ModuleDef } from '../app';
const router=Router();
const permissions:Record<string,string>={Customer:'customers',Supplier:'suppliers',Employee:'hr_employees',Attendance:'hr_attendance',LeaveRequest:'hr_leave',Payroll:'hr_payroll',Product:'products',SalesOrder:'sales_order',SalesQuotation:'sales_quotation',SalesEnquiry:'sales_enquiry',ProformaInvoice:'proforma_invoice',DeliveryNote:'delivery_note',SalesInvoice:'sales_invoice',PurchaseOrder:'purchase_order',PurchaseInvoice:'purchase_invoice',GoodsReceipt:'goods_receipt',StockTransfer:'stock_transfer',StockAdjustment:'stock_adjustment',AmcContract:'amc',EquipmentUnit:'products'};
router.get('/:entity/:id',(req,res,next)=>{const permission=permissions[req.params.entity];if(!permission)return next(badRequest('Unsupported history record'));can(permission,'view')(req,res,next);},ah(async(req,res)=>{
 const rows=await prisma.auditLog.findMany({where:{entity:req.params.entity,entityId:req.params.id,action:'UPDATE_FIELDS'},orderBy:{id:'desc'},take:100});
 const users=await prisma.user.findMany({where:{id:{in:rows.flatMap(r=>r.userId?[r.userId]:[])}},select:{id:true,fullName:true}});
 res.json({rows:rows.map(r=>({...r,employee:users.find(u=>u.id===r.userId)?.fullName||r.username,details:r.details?JSON.parse(r.details):null}))});
}));
export default [{path:'/revision-history',router}] satisfies ModuleDef[];
