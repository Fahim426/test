import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, parse } from '../lib/http';
import { badRequest, forbidden } from '../lib/errors';
import { AuthUser } from '../middleware/auth';
import { audit } from '../services/audit';
import type { ModuleDef } from '../app';
const router=Router();
const prefsSchema=z.object({renewalDays:z.number().int().min(1).max(90),serviceDays:z.number().int().min(1).max(90),paymentDays:z.number().int().min(1).max(90)});
const allowed=(u:AuthUser,perm:string)=>u.role==='Admin'||u.permissions.has(perm+':view');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
async function preferences(userId:number){const row=await prisma.systemSetting.findUnique({where:{key:'reminders.preferences.'+userId}});return row?prefsSchema.parse(JSON.parse(row.value)):{renewalDays:30,serviceDays:7,paymentDays:7};}
async function reminderRows(user:AuthUser){
 const p=await preferences(user.id), now=new Date(), today=new Date(now.toISOString().slice(0,10)+'T23:59:59.999Z');
 const until=(days:number)=>new Date(today.getTime()+days*86400000);
 const rows:{id:string;kind:string;title:string;party:string;dueDate:string;amount?:number;sourceId:number;screenId:string;severity:string;fingerprint:string;acknowledged?:boolean;snoozedUntil?:string}[]=[];
 const add=(kind:string,id:number,title:string,party:string,due:Date,screenId:string,amount?:number)=>{const date=due.toISOString().slice(0,10),key=kind+':'+id;rows.push({id:key,kind,title,party,dueDate:date,sourceId:id,screenId,amount,severity:date<today.toISOString().slice(0,10)?'OVERDUE':date===today.toISOString().slice(0,10)?'TODAY':'UPCOMING',fingerprint:hash(JSON.stringify([key,date,amount??null]))});};
 if(allowed(user,'amc')){
  const contracts=await prisma.amcContract.findMany({where:{status:'ACTIVE',endDate:{lte:until(p.renewalDays)}},include:{customer:{select:{name:true}}}});
  for(const c of contracts)add('AMC_RENEWAL',c.id,c.contractNo+' - AMC renewal',c.customer.name,c.endDate,'amc-form',Number(c.total));
  const visits=await prisma.amcVisit.findMany({where:{status:{in:['SCHEDULED','IN_PROGRESS']},scheduledDate:{lte:until(p.serviceDays)},contract:{status:'ACTIVE'}},include:{contract:{include:{customer:{select:{name:true}}}}}});
  for(const v of visits){add('SERVICE_VISIT',v.id,v.contract.contractNo+' - visit '+v.visitNo,v.contract.customer.name,v.scheduledDate,'amc-form');rows[rows.length-1].sourceId=v.contractId;}
 }
 if(allowed(user,'sales_invoice')){
  const invoices=await prisma.salesInvoice.findMany({where:{status:{in:['POSTED','PARTIALLY_PAID']},dueDate:{lte:until(p.paymentDays)}}});
  const parties=await prisma.customer.findMany({where:{id:{in:invoices.map(i=>i.customerId)}},select:{id:true,name:true}});
  for(const i of invoices){const amount=Math.round((Number(i.baseTotal)-Number(i.receivedAmount))*100)/100;if(amount>0.005&&i.dueDate)add('CUSTOMER_PAYMENT',i.id,i.docNo+' - customer payment',parties.find(p=>p.id===i.customerId)?.name||'',i.dueDate,'sales-invoice-form',amount);}
 }
 if(allowed(user,'purchase_invoice')){
  const invoices=await prisma.purchaseInvoice.findMany({where:{status:{in:['POSTED','PARTIALLY_PAID']},dueDate:{lte:until(p.paymentDays)}}});
  const parties=await prisma.supplier.findMany({where:{id:{in:invoices.map(i=>i.supplierId)}},select:{id:true,name:true}});
  for(const i of invoices){const amount=Math.round((Number(i.baseTotal)-Number(i.paidAmount))*100)/100;if(amount>0.005&&i.dueDate)add('SUPPLIER_PAYMENT',i.id,i.docNo+' - supplier payment',parties.find(p=>p.id===i.supplierId)?.name||'',i.dueDate,'purchase-invoice-form',amount);}
 }
 const state=await prisma.systemSetting.findMany({where:{key:{startsWith:'reminders.state.'+user.id+'.'}}});
 for(const row of rows){const stored=state.find(s=>s.key==='reminders.state.'+user.id+'.'+hash(row.id));if(!stored)continue;const value=JSON.parse(stored.value);if(value.fingerprint!==row.fingerprint)continue;row.acknowledged=!!value.acknowledgedAt;row.snoozedUntil=value.snoozedUntil;}
 return rows.sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
}
router.get('/preferences',ah(async(req,res)=>res.json(await preferences(req.user!.id))));
router.put('/preferences',ah(async(req,res)=>{
 const input=parse(prefsSchema,req.body);const key='reminders.preferences.'+req.user!.id;
 await prisma.$transaction(async tx=>{const before=await preferences(req.user!.id);await tx.systemSetting.upsert({where:{key},create:{key,value:JSON.stringify(input)},update:{value:JSON.stringify(input)}});await audit(tx,req.user,'UPDATE_FIELDS','ReminderPreferences',req.user!.id,{changes:Object.keys(input).filter(k=>(before as any)[k]!== (input as any)[k]).map(field=>({field,before:(before as any)[field],after:(input as any)[field]}))});});res.json(input);
}));
router.get('/',ah(async(req,res)=>{
 const all=await reminderRows(req.user!);const now=new Date();const active=all.filter(r=>!r.acknowledged&&(!r.snoozedUntil||new Date(r.snoozedUntil)<=now));res.setHeader('Cache-Control','private, no-store');res.json({rows:req.query.includeHandled==='true'?all:active,count:active.length,generatedAt:now.toISOString(),channel:'IN_APP'});
}));
router.post('/state',ah(async(req,res)=>{
 const input=parse(z.object({id:z.string().max(100),action:z.enum(['ACKNOWLEDGE','SNOOZE','RESTORE']),days:z.number().int().min(1).max(30).optional()}),req.body);
 const row=(await reminderRows(req.user!)).find(r=>r.id===input.id);if(!row)throw forbidden('Reminder is not available to this user or is no longer due');
 if(input.action==='SNOOZE'&&!input.days)throw badRequest('Specify a snooze duration');
 const value={fingerprint:row.fingerprint,acknowledgedAt:input.action==='ACKNOWLEDGE'?new Date().toISOString():null,snoozedUntil:input.action==='SNOOZE'?new Date(Date.now()+input.days!*86400000).toISOString():null};const key='reminders.state.'+req.user!.id+'.'+hash(row.id);
 await prisma.$transaction(async tx=>{await tx.systemSetting.upsert({where:{key},create:{key,value:JSON.stringify(value)},update:{value:JSON.stringify(value)}});await audit(tx,req.user,input.action,'Reminder',row.id);});res.json({ok:true});
}));
export default [{path:'/reminders',router}] satisfies ModuleDef[];
