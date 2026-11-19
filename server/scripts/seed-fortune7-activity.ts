/* Fictional, resumable Fortune 7 demo. All business transactions use the normal REST workflows. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
const db = new PrismaClient({errorFormat:'minimal'});
const BASE='http://127.0.0.1:4000/api', MARKER='demo.fortune7.activity.v1', LABEL='DEMO F7 - fictional figures';
const checkpoint=path.resolve('../.local-run/fortune7-activity-checkpoint.json');
let token='', state:any;
const money=(n:any)=>Math.round(Number(n)*100)/100;
const save=()=>{fs.mkdirSync(path.dirname(checkpoint),{recursive:true});fs.writeFileSync(checkpoint,JSON.stringify(state,null,2));};
const day=(offset:number)=>{const d=new Date(state.startedAt);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const iso=(offset:number)=>day(offset)+'T09:00:00.000Z';
async function call(method:string,endpoint:string,body?:unknown):Promise<any>{
 const r=await fetch(BASE+endpoint,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await r.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}
 if(!r.ok)throw Error(method+' '+endpoint+' -> '+r.status+': '+JSON.stringify(data).slice(0,900));return data;
}
async function step(key:string,method:string,endpoint:string,body?:unknown):Promise<any>{
 if(state.steps[key])return state.steps[key];const data=await call(method,endpoint,body);state.steps[key]=data||{ok:true};save();return state.steps[key];
}
async function approve(key:string,endpoint:string,id:number){
 let row=await call('GET',endpoint+'/'+id);
 // A resumed, already progressed document needs no further approval.
 if(!['DRAFT','PENDING_APPROVAL','SUBMITTED'].includes(row.status))return;
 if(row.status==='DRAFT')row=await step(key+':submit','POST',endpoint+'/'+id+'/submit');
 for(let i=0;i<5&&['PENDING_APPROVAL','SUBMITTED'].includes(row.status);i++)row=await step(key+':approve:'+i,'POST',endpoint+'/'+id+'/approve',{comment:LABEL});
 if(row.status!=='APPROVED')throw Error('Approval incomplete: '+endpoint+'/'+id+' '+row.status);
}
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='3307'||url.pathname!=='/smartspare_erp')throw Error('Restricted to the isolated local demo on port 3307.');
 if(!(await db.company.findFirst({where:{code:'F7',name:'Fortune 7 Printing Equipment Trading LLC'}})))throw Error('Fortune 7 catalogue setup is required.');
 if(await db.systemSetting.findUnique({where:{key:MARKER}})){console.log('Demo activity is already installed. No duplicates created.');return;}
 if(fs.existsSync(checkpoint))state=JSON.parse(fs.readFileSync(checkpoint,'utf8'));
 else{
  for(const model of ['stockTransaction','salesInvoice','purchaseOrder','voucher','journalEntry'])if(await(db as any)[model].count())throw Error('Existing business activity found without a demo checkpoint; refusing to mix data.');
  const backup:any={createdAt:new Date().toISOString()};
  for(const model of Prisma.dmmf.datamodel.models){if(['User','RefreshToken'].includes(model.name))continue;const delegate=model.name[0].toLowerCase()+model.name.slice(1);backup[delegate]=await(db as any)[delegate].findMany();}
  fs.mkdirSync(path.dirname(checkpoint),{recursive:true});const backupFile=path.resolve('../.local-run/before-fortune7-activity-'+Date.now()+'.json');fs.writeFileSync(backupFile,JSON.stringify(backup,null,2));state={startedAt:new Date().toISOString(),backupFile,steps:{}};save();
 }
 token=(await call('POST','/auth/login',{username:'admin',password:'admin123'})).accessToken;if(!token)throw Error('Login failed');
 const rows=(await call('GET','/products?pageSize=100')).rows;
 const prices:[string,number,number][]=[['GX-12025',250000,325000],['GX-15300',82000,110000],['GX-1530AB',165000,220000],['GX-1540-G',110000,149000],['GX-1560',72000,98000],['GX-2040 Z',98000,132000],['GX-4020AB',185000,245000],['GX-6020Z',145000,195000],['GX-CG60X',130000,175000],['GX-CG60',78000,105000]];
 if(rows.length!==10||prices.some(([code])=>!rows.some((p:any)=>p.code===code)))throw Error('Expected ten confirmed machines.');
 const warehouses=(await call('GET','/warehouses?pageSize=100')).rows;
 const branches=['DXB','SHJ','AUH','AJM'];const wh=['WH-DXB-MAIN','WH-SHJ','WH-AUH','WH-AJM'].map(code=>{const w=warehouses.find((w:any)=>w.code===code);if(!w)throw Error('Missing '+code);return w.id;});
 const salesmen=(await call('GET','/salesmen?pageSize=100')).rows;
 const net30=(await call('GET','/payment-terms?pageSize=100')).rows.find((r:any)=>r.code==='NET30')?.id;
 const products=[];
 for(const[code,cost,retail]of prices){const p=rows.find((p:any)=>p.code===code);await step('product:'+code,'PUT','/products/'+p.id,{costPrice:cost,retailPrice:retail,wholesalePrice:money(retail*.95),minStock:1,reorderLevel:2,maxStock:10,defaultWarehouseId:wh[0],description:LABEL+'. Sample cost and selling price for demonstration only; replace with confirmed supplier quotes before live use.'});products.push({id:p.id,code,cost,retail,vatRate:Number(p.vatRate)});}
 console.log('Ten machines: demo costs and selling prices installed.');
 const customers=[];
 for(let i=0;i<8;i++){const city=['Dubai','Sharjah','Abu Dhabi','Ajman'][i%4];customers.push(await step('customer:'+i,'POST','/customers',{code:'DEMO-F7-C'+(i+1),name:'DEMO - '+city+(i<4?' Signage Workshop':' Metal Fabrication'),city,country:'UAE',currencyCode:'AED',creditLimit:3000000,paymentTermId:net30,salesmanId:salesmen[i%salesmen.length]?.id,openingBalance:0}));}
 const supplier=await step('supplier','POST','/suppliers',{code:'DEMO-F7-S1',name:'DEMO - UAE Equipment Distributor',country:'UAE',currencyCode:'AED',paymentTermId:net30,openingBalance:0});
 for(let b=0;b<4;b++){const selected=products.filter((_,i)=>b<2||(b===2?i%2===0:i%2===1));const opening=await step('opening:'+b,'POST','/stock-adjustments',{adjType:'OPENING',warehouseId:wh[b],txDate:day(-24),reason:LABEL,remarks:LABEL+' - '+branches[b]+' opening stock',items:selected.map(p=>({productId:p.id,qtyChange:b===0?3:2,unitCost:p.cost}))});await step('opening-post:'+b,'POST','/stock-adjustments/'+opening.id+'/post');}
 console.log('Opening stock posted for four branches.');
 for(let b=0;b<4;b++){
  const chosen=[products[b*2],products[b*2+1]];
  const po=await step('po:'+b,'POST','/purchase-orders',{docDate:day(-21),supplierId:supplier.id,warehouseId:wh[b],currencyCode:'AED',remarks:LABEL+' - '+branches[b]+' restock',items:chosen.map(p=>({productId:p.id,qty:1,rate:p.cost,vatRate:p.vatRate}))});await approve('po-flow:'+b,'/purchase-orders',po.id);
  const grn=await step('grn:'+b,'POST','/purchase-orders/'+po.id+'/create-receipt',{docDate:day(-20),remarks:LABEL});await step('grn-post:'+b,'POST','/goods-receipts/'+grn.id+'/post');
  const inv=await step('pi:'+b,'POST','/goods-receipts/'+grn.id+'/create-invoice',{docDate:day(-19),supplierInvoiceNo:'DEMO-F7-SUP-'+(b+1),remarks:LABEL});await step('pi-post:'+b,'POST','/purchase-invoices/'+inv.id+'/post');
  if(b<2){const amount=money(Number(inv.total)*(b===0?1:.5));await step('supplier-payment:'+b,'POST','/payments',{voucherDate:day(-17),partyType:'SUPPLIER',partyId:supplier.id,mode:'BANK',amount,reference:'DEMO-F7-PAY-'+b,narration:LABEL,allocations:[{docType:'PURCHASE_INVOICE',docId:inv.id,amount}]});}
 }
 console.log('Four purchase flows completed, with supplier payments.');
 const deals=[{b:0,c:0,p:[1,3],back:16,paid:1},{b:1,c:1,p:[2],back:14,paid:.5},{b:2,c:2,p:[0],back:12,paid:0},{b:3,c:3,p:[5,7],back:10,paid:1},{b:0,c:4,p:[6],back:8,paid:.5},{b:1,c:5,p:[9],back:6,paid:1},{b:2,c:6,p:[8],back:4,paid:.5},{b:3,c:7,p:[1],back:2,paid:0}];
 for(let i=0;i<deals.length;i++){
  const d=deals[i],customer=customers[d.c],items=d.p.map(index=>({productId:products[index].id,qty:1,rate:money(products[index].retail*(i===4?.97:1))}));
  const quote=await step('deal-quote:'+i,'POST','/sales-quotations',{docDate:day(-d.back-2),validUntil:day(14),customerId:customer.id,warehouseId:wh[d.b],currencyCode:'AED',remarks:LABEL+' - '+branches[d.b]+' sale '+(i+1),items});
  await step('deal-send:'+i,'POST','/sales-quotations/'+quote.id+'/send');await step('deal-accept:'+i,'POST','/sales-quotations/'+quote.id+'/accept');
  const order=await step('deal-order:'+i,'POST','/sales-quotations/'+quote.id+'/create-order',{docDate:day(-d.back-1),warehouseId:wh[d.b],customerPoNo:'DEMO-F7-'+branches[d.b]+'-'+(i+1)});await approve('deal-approval:'+i,'/sales-orders',order.id);
  let dn:any;
  if(i===0){
   const pick=await step('deal-pick:'+i,'POST','/sales-orders/'+order.id+'/create-picking',{});
   await step('deal-pick-update:'+i,'PUT','/picking-lists/'+pick.id+'/pick',{pickedBy:'DEMO Warehouse Operator',remarks:LABEL,items:pick.items.map((it:any)=>({id:it.id,pickedQty:Number(it.orderedQty)}))});
   const pack=await step('deal-pack:'+i,'POST','/picking-lists/'+pick.id+'/create-packing',{boxes:items.length,remarks:LABEL+' - shipment crates',items:items.map((it,index)=>({productId:it.productId,boxNo:index+1,qty:it.qty}))});await step('deal-pack-post:'+i,'POST','/packing-lists/'+pack.id+'/pack');
   dn=await step('deal-delivery:'+i,'POST','/picking-lists/'+pick.id+'/create-delivery',{docDate:day(-d.back),driver:'DEMO Delivery Team'});
  }else dn=await step('deal-delivery:'+i,'POST','/sales-orders/'+order.id+'/create-delivery',{docDate:day(-d.back),driver:'DEMO Delivery Team'});
  await step('deal-delivery-post:'+i,'POST','/delivery-notes/'+dn.id+'/post');
  const inv=await step('deal-invoice:'+i,'POST','/delivery-notes/'+dn.id+'/create-invoice',{docDate:day(-d.back),dueDate:day(i===1||i===2?-1:14),remarks:LABEL+' - '+branches[d.b]+' sale'});await step('deal-invoice-post:'+i,'POST','/sales-invoices/'+inv.id+'/post');
  if(d.paid){const amount=money(Number(inv.total)*d.paid);await step('deal-receipt:'+i,'POST','/receipts',{voucherDate:day(-Math.max(0,d.back-1)),partyType:'CUSTOMER',partyId:customer.id,mode:'BANK',amount,reference:'DEMO-F7-REC-'+(i+1),narration:LABEL,allocations:[{docType:'SALES_INVOICE',docId:inv.id,amount}]});}
  console.log(branches[d.b]+': sale '+(i+1)+' delivered/invoiced; receipt '+d.paid*100+'%.');
 }
 for(let i=0;i<5;i++){
  const b=i%4,p=products[i===2?4:i===3?5:i];const quote=await step('pipeline-quote:'+i,'POST','/sales-quotations',{docDate:day(-1),validUntil:day(21),customerId:customers[b].id,warehouseId:wh[b],remarks:LABEL+' - pipeline '+['draft quotation','sent quotation','awaiting approval','reserved order','ready to dispatch'][i],items:[{productId:p.id,qty:1,rate:p.retail}]});
  if(i>=1)await step('pipeline-send:'+i,'POST','/sales-quotations/'+quote.id+'/send');
  if(i>=2){await step('pipeline-accept:'+i,'POST','/sales-quotations/'+quote.id+'/accept');const order=await step('pipeline-order:'+i,'POST','/sales-quotations/'+quote.id+'/create-order',{warehouseId:wh[b],customerPoNo:'DEMO-F7-PIPE-'+i});
   if(i===2)await step('pipeline-submit:'+i,'POST','/sales-orders/'+order.id+'/submit');else{await approve('pipeline-approval:'+i,'/sales-orders',order.id);if(i===4)await step('pipeline-delivery:'+i,'POST','/sales-orders/'+order.id+'/create-delivery',{driver:'DEMO Delivery Team'});}
  }
 }
 const transfer=await step('transfer','POST','/stock-transfers',{txDate:day(-1),fromWarehouseId:wh[0],toWarehouseId:wh[1],remarks:LABEL+' - Dubai to Sharjah showroom',items:[{productId:products[8].id,qty:1}]});
 for(const action of ['approve','dispatch'])await step('transfer-'+action,'POST','/stock-transfers/'+transfer.id+'/'+action);
 await step('transfer-receive','POST','/stock-transfers/'+transfer.id+'/receive',{receiveAll:true});
 for(let i=0;i<3;i++){const d=deals[i],p=products[d.p[0]];await step('amc:'+i,'POST','/amc',{customerId:customers[d.c].id,productId:p.id,equipmentDesc:p.code+' - DEMO installed machine',serialNo:'DEMO-F7-SERIAL-'+(i+1),contractType:i===1?'LABOUR_ONLY':'COMPREHENSIVE',startDate:iso(i===0?-10:-345),endDate:iso(i===1?20:i===2?-3:365),amount:[12000,9000,18000][i],vatRate:5,visitCount:4,status:i===2?'EXPIRED':'ACTIVE',notes:LABEL+(i===0?'. Related demo invoice '+state.steps['deal-invoice:'+i].docNo:'. Previously installed demo machine; its original historical sale is outside this demonstration dataset')+'. Contract fee is sample service revenue; service cost accounting is a separate planned enhancement.',visits:(i===0?[-2,90,180,270]:i===1?[-250,-160,-70,7]:[-270,-180,-90,-10]).map((offset,index)=>({visitNo:index+1,scheduledDate:iso(offset),completedDate:offset<0?iso(offset):null,visitType:'PREVENTIVE',status:offset<0?'COMPLETED':'SCHEDULED',technicianName:offset<0?'DEMO Service Engineer':null,findings:offset<0?'DEMO alignment, cooling and safety checks completed.':null}))});}
 await db.systemSetting.create({data:{key:MARKER,value:JSON.stringify({startedAt:state.startedAt,completedAt:new Date().toISOString(),checkpoint:path.basename(checkpoint),label:LABEL})}});
 console.log('Completed. Repeat runs will not duplicate demo records.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
