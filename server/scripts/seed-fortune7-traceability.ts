/** Add serial examples for the working demo; no stock or accounting rows are changed. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient({errorFormat:'minimal'});let token='';
async function call(method:string,url:string,body?:unknown):Promise<any>{const r=await fetch('http://127.0.0.1:4000/api'+url,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(url+': '+JSON.stringify(data));return data;}
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='3307')throw Error('Local demo only');
 if(!(await db.systemSetting.findUnique({where:{key:'demo.fortune7.activity.v1'}})))throw Error('Working Fortune 7 demo required');
 token=(await call('POST','/auth/login',{username:'admin',password:'admin123'})).accessToken;
 const state=JSON.parse(fs.readFileSync(path.resolve('../.local-run/fortune7-activity-checkpoint.json'),'utf8'));
 const current=JSON.parse(fs.readFileSync(path.resolve('../.local-run/fortune7-current-purchase.json'),'utf8'));
 const contracts=await db.amcContract.findMany({where:{serialNo:{startsWith:'DEMO-F7-SERIAL-'}},orderBy:{id:'asc'}});
 const ensure=async(input:any)=>{const rows=(await call('GET','/equipment-units')).rows;const existing=rows.find((r:any)=>r.serialNo===input.serialNo);return existing||call('POST','/equipment-units',input);};
 const primary=contracts.find(c=>c.serialNo==='DEMO-F7-SERIAL-1')!;
 let unit=await ensure({serialNo:primary.serialNo,productId:primary.productId,sourceType:'OPENING',sourceId:state.steps['opening:0'].id,deliveryId:state.steps['deal-delivery:0'].id,notes:'DEMO serial linked to the actual sample delivery.'});
 if(unit.status==='DELIVERED')unit=await call('POST','/equipment-units/'+unit.id+'/events',{action:'INSTALL',version:unit.version,installationDate:new Date().toISOString().slice(0,10),warrantyEnd:new Date(Date.now()+365*86400000).toISOString().slice(0,10),notes:'DEMO installation and sample 12-month warranty; confirm supplier terms for live use.'});
 if(!unit.amcId)await call('POST','/equipment-units/'+unit.id+'/events',{action:'LINK_AMC',version:unit.version,refId:primary.id,notes:'DEMO matching serial, product and customer linked to AMC.'});
 for(const c of contracts.filter(c=>c.id!==primary.id))await ensure({serialNo:c.serialNo,productId:c.productId,sourceType:'LEGACY_INSTALLED',sourceId:c.id,notes:'DEMO previously installed machine supported by the existing sample AMC.'});
 const transfer=await db.stockTransfer.findUniqueOrThrow({where:{id:state.steps.transfer.id},include:{items:true}});
 unit=await ensure({serialNo:'DEMO-F7-TRANSFER-001',productId:transfer.items[0].productId,sourceType:'OPENING',sourceId:state.steps['opening:0'].id,notes:'DEMO machine selected for the completed showroom stock transfer.'});
 if(unit.warehouseId===transfer.fromWarehouseId)await call('POST','/equipment-units/'+unit.id+'/events',{action:'TRANSFER',version:unit.version,refId:transfer.id,notes:'DEMO serial traced on the completed Dubai to Sharjah transfer.'});
 const receipt=await db.goodsReceipt.findUniqueOrThrow({where:{id:current.steps.grn.id},include:{items:true}});
 await ensure({serialNo:'DEMO-F7-RECEIVED-001',productId:receipt.items[0].productId,sourceType:'GOODS_RECEIPT',sourceId:receipt.id,notes:'DEMO in-stock serial registered from the current-month goods receipt.'});
 // Show a real employee attribution example, restoring the sample price after the demonstration edit.
 const manager=await call('POST','/auth/login',{username:'manager',password:'manager123'});token=manager.accessToken;
 const p=await db.product.findUniqueOrThrow({where:{code:'GX-15300'}});
 if(!(await db.auditLog.findFirst({where:{entity:'Product',entityId:String(p.id),action:'UPDATE_FIELDS',username:'manager'}}))){
  await call('PUT','/products/'+p.id,{retailPrice:Number(p.retailPrice)+1000,changeReason:'DEMO: show employee-attributed price revision.'});
  await call('PUT','/products/'+p.id,{retailPrice:Number(p.retailPrice),changeReason:'DEMO: restore the original sample selling price.'});
 }
 console.log('Five serial examples and employee-attributed price history installed. Stock and invoice values unchanged.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
