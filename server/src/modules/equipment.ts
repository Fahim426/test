import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, parse } from '../lib/http';
import { badRequest, conflict } from '../lib/errors';
import { can } from '../middleware/auth';
import { registerUnit, registryLock, units, readUnit, saveUnit, assertStockCapacity, bindDelivery } from '../services/equipment-registry';
import type { ModuleDef } from '../app';
const router = Router();
const create = z.object({ serialNo: z.string().trim().min(1).max(100), productId: z.number().int().positive(), sourceType: z.enum(['OPENING','GOODS_RECEIPT','LEGACY_INSTALLED']), sourceId: z.number().int().positive(), deliveryId: z.number().int().positive().optional(), notes: z.string().max(1000).optional() });
router.get('/', can('products','view'), ah(async (req,res) => {
  const [all, products, warehouses, customers, branches] = await Promise.all([units(), prisma.product.findMany({select:{id:true,code:true,name:true}}), prisma.warehouse.findMany(), prisma.customer.findMany({select:{id:true,code:true,name:true}}), prisma.branch.findMany()]);
  let rows = all.map(u => ({...u, product:products.find(p=>p.id===u.productId), warehouse:warehouses.find(w=>w.id===u.warehouseId), customer:customers.find(c=>c.id===u.customerId), branch:branches.find(b=>b.id===u.branchId)}));
  const search = String(req.query.search || '').toLowerCase();
  if (search) rows = rows.filter(r => [r.serialNo,r.product?.code,r.product?.name,r.customer?.name].some(v=>v?.toLowerCase().includes(search)));
  if (req.query.status) rows = rows.filter(r=>r.status===req.query.status);
  if (req.query.productId) rows = rows.filter(r=>r.productId===Number(req.query.productId));
  if (req.query.branchId) rows = rows.filter(r=>r.branchId===Number(req.query.branchId));
  res.json({rows:rows.sort((a,b)=>a.serialNo.localeCompare(b.serialNo)),total:rows.length});
}));
router.post('/', can('products','edit'), ah(async (req,res) => {
  const input = parse(create,req.body); const row = await prisma.$transaction(tx=>registerUnit(tx,input,req.user),{timeout:30000}); res.status(201).json(row);
}));
router.get('/:id', can('products','view'), ah(async(req,res)=>{
  const row = await readUnit(prisma,req.params.id);
  const invoices = row.customerId ? await prisma.salesInvoice.findMany({where:{customerId:row.customerId, status:{notIn:['DRAFT','CANCELLED']},items:{some:{productId:row.productId}}},select:{id:true,docNo:true,salesOrderId:true,deliveryId:true}}) : [];
  res.json({...row, invoices:invoices.filter(i=>row.events.some(e=>e.action==='DELIVERY'&&e.refId===i.deliveryId))});
}));
const event = z.object({ action:z.enum(['TRANSFER','DELIVERY','INSTALL','LINK_AMC']), version:z.number().int().positive(), refId:z.number().int().positive().optional(), installationDate:z.string().date().optional(), warrantyEnd:z.string().date().nullable().optional(), notes:z.string().trim().min(1).max(1000) });
router.post('/:id/events', can('products','edit'), ah(async(req,res)=>{
  const input=parse(event,req.body);
  const row=await prisma.$transaction(async tx=>{
    await registryLock(tx); const unit=await readUnit(tx,req.params.id), before=JSON.parse(JSON.stringify(unit));
    if(unit.version!==input.version)throw conflict('This machine changed. Refresh before recording another event.');
    const all=await units(tx);let refNo:string|undefined;
    if(input.action==='TRANSFER'){
      if(unit.status!=='IN_STOCK'||!input.refId)throw badRequest('Transfer requires an in-stock machine and a received transfer reference');
      const transfer=await tx.stockTransfer.findUnique({where:{id:input.refId},include:{items:true}});
      if(!transfer||transfer.status!=='COMPLETED'||transfer.fromWarehouseId!==unit.warehouseId)throw badRequest('Select a received transfer from this machine warehouse');
      const qty=transfer.items.filter(i=>i.productId===unit.productId).reduce((n,i)=>n+Number(i.receivedQty),0);
      if(all.filter(u=>u.productId===unit.productId&&u.events.some(e=>e.action==='TRANSFER'&&e.refId===input.refId)).length>=qty)throw badRequest('Serial assignments exceed the received transfer quantity');
      await assertStockCapacity(tx,all,unit.productId,transfer.toWarehouseId,unit.id);
      unit.warehouseId=transfer.toWarehouseId;unit.branchId=(await tx.warehouse.findUnique({where:{id:unit.warehouseId}}))?.branchId??null;refNo=transfer.transferNo;
    }else if(input.action==='DELIVERY'){
      if(unit.status!=='IN_STOCK'||!input.refId)throw badRequest('Delivery requires an in-stock machine and a posted delivery reference');
      await bindDelivery(tx,unit,input.refId,all);unit.events.pop();
      refNo=(await tx.deliveryNote.findUnique({where:{id:input.refId}}))?.docNo;
    }else if(input.action==='INSTALL'){
      if(!['DELIVERED','INSTALLED'].includes(unit.status)||!input.installationDate)throw badRequest('Install a delivered machine and specify the installation date');
      const delivered=unit.events.find(e=>e.action==='DELIVERY');
      if(delivered&&input.installationDate<delivered.date.slice(0,10))throw badRequest('Installation cannot precede delivery');
      if(input.warrantyEnd&&input.warrantyEnd<input.installationDate)throw badRequest('Warranty cannot end before installation');
      unit.status='INSTALLED';unit.installationDate=input.installationDate;unit.warrantyEnd=input.warrantyEnd??null;
    }else{
      if(!unit.customerId||!input.refId)throw badRequest('Select an AMC for a delivered or installed customer machine');
      const amc=await tx.amcContract.findUnique({where:{id:input.refId}});
      if(!amc||amc.productId!==unit.productId||amc.customerId!==unit.customerId||amc.serialNo?.normalize('NFKC').trim().toUpperCase()!==unit.serialNo)throw badRequest('AMC product, customer and serial must match this machine');
      unit.amcId=amc.id;refNo=amc.contractNo;
    }
    unit.version++;unit.events.push({action:input.action,date:new Date().toISOString(),employee:req.user?.username||'',refId:input.refId,refNo,notes:input.notes});
    await saveUnit(tx,unit,req.user,'UPDATE_FIELDS',before,input.notes);return unit;
  },{timeout:30000});res.json(row);
}));
export default [{path:'/equipment-units',router}] satisfies ModuleDef[];
