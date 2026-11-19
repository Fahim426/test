/** Add one clearly labelled current-month purchasing example without changing posted historical documents. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
const db=new PrismaClient({errorFormat:'minimal'});
const file=path.resolve('../.local-run/fortune7-current-purchase.json');
let state:any, token='';
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2));
async function call(method:string,endpoint:string,body?:unknown):Promise<any>{
 const r=await fetch('http://127.0.0.1:4000/api'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(method+' '+endpoint+': '+JSON.stringify(data));return data;
}
async function step(key:string,method:string,url:string,body?:unknown){if(state.steps[key])return state.steps[key];const data=await call(method,url,body);state.steps[key]=data;save();return data;}
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='3307'||url.pathname!=='/smartspare_erp')throw Error('Restricted to the isolated demo database.');
 if(!(await db.systemSetting.findUnique({where:{key:'demo.fortune7.activity.v1'}})))throw Error('Working Fortune 7 demo required.');
 if(fs.existsSync(file))state=JSON.parse(fs.readFileSync(file,'utf8'));
 else{const backup:any={createdAt:new Date().toISOString()};for(const m of Prisma.dmmf.datamodel.models){if(['User','RefreshToken'].includes(m.name))continue;const key=m.name[0].toLowerCase()+m.name.slice(1);backup[key]=await(db as any)[key].findMany();}fs.writeFileSync(path.resolve('../.local-run/before-current-purchase-'+Date.now()+'.json'),JSON.stringify(backup,null,2));state={date:new Date().toISOString().slice(0,10),steps:{}};save();}
 if(state.completed){console.log('Current-month purchase already posted; no duplicates created.');return;}
 token=(await call('POST','/auth/login',{username:'admin',password:'admin123'})).accessToken;
 const products=(await call('GET','/products?pageSize=100')).rows;
 const supplier=(await call('GET','/suppliers?search=DEMO-F7-S1')).rows.find((r:any)=>r.code==='DEMO-F7-S1');
 const warehouse=(await call('GET','/warehouses?pageSize=100')).rows.find((r:any)=>r.code==='WH-DXB-MAIN');if(!supplier||!warehouse)throw Error('Missing demo masters.');
 const items=['GX-1540-G','GX-CG60'].map(code=>{const p=products.find((r:any)=>r.code===code);if(!p)throw Error('Missing machine '+code);return{productId:p.id,qty:1,rate:Number(p.costPrice),vatRate:Number(p.vatRate)};});
 const po=await step('po','POST','/purchase-orders',{docDate:state.date,supplierId:supplier.id,warehouseId:warehouse.id,currencyCode:'AED',remarks:'DEMO F7 - fictional figures - current-month equipment restock',items});
 let current=await call('GET','/purchase-orders/'+po.id);if(current.status==='DRAFT')current=await step('submit','POST','/purchase-orders/'+po.id+'/submit');
 for(let i=0;i<5&&['SUBMITTED','PENDING_APPROVAL'].includes(current.status);i++)current=await step('approval:'+i,'POST','/purchase-orders/'+po.id+'/approve',{comment:'DEMO current-month purchase'});
 const grn=await step('grn','POST','/purchase-orders/'+po.id+'/create-receipt',{docDate:state.date,remarks:'DEMO F7 - fictional figures - received current-month restock'});
 await step('grn-post','POST','/goods-receipts/'+grn.id+'/post');
 const invoice=await step('invoice','POST','/goods-receipts/'+grn.id+'/create-invoice',{docDate:state.date,supplierInvoiceNo:'DEMO-F7-CURRENT-001',remarks:'DEMO F7 - fictional figures - current-month purchase invoice'});
 await step('invoice-post','POST','/purchase-invoices/'+invoice.id+'/post');
 state.completed=true;save();console.log(JSON.stringify({purchaseOrder:po.docNo,purchaseInvoice:invoice.docNo,date:state.date,subtotal:invoice.subtotal,vat:invoice.vatAmount,total:invoice.total}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
