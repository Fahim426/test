import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
const BASE='http://127.0.0.1:4000/api';
async function login(username:string,password:string){const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert(r.ok);return(await r.json() as any).accessToken as string;}
async function request(token:string|undefined,body:unknown){const r=await fetch(BASE+'/assistant/message',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return{status:r.status,headers:r.headers,data:await r.json() as any};}
async function snapshot(){const models=['product','company','customer','supplier','stockBalance','stockTransaction','journalEntry','journalLine','salesInvoice','salesInvoiceItem','salesOrder','salesOrderItem','purchaseInvoice','amcContract','employee','auditLog','systemSetting'];const out:Record<string,unknown>={};for(const m of models)out[m]=await(prisma as any)[m].findMany({orderBy:m==='systemSetting'?{key:'asc'}:{id:'asc'}});return createHash('sha256').update(JSON.stringify(out)).digest('hex');}
async function main(){
 const target=new URL(process.env.DATABASE_URL||'');assert(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='3307','HTTP checks are restricted to the isolated local demo.');
 const token=await login('admin','admin123'),limited=await login('manager','manager123');const before=await snapshot();
 const unauth=await request(undefined,{message:'sales this month'});assert.equal(unauth.status,401);
 const sales=await request(token,{message:'sales this month'});assert.equal(sales.status,200);assert.equal(sales.data.intent,'sales_summary');assert.equal(Number(sales.data.table.rows[0].totalInclusive),1846582.5);
 const purchase=await request(token,{message:'purchases this month'});assert.equal(Number(purchase.data.table.rows[0].totalInclusive),197400);
 const invalid=await request(token,{message:'sales',memory:{intent:'sales_summary',entities:{branchId:'1 OR 1=1'}}});assert.equal(invalid.status,400);
 const injected=await request(token,{message:'sales',context:{role:'Admin'}});assert.equal(injected.status,400);
 const unknown=await request(token,{message:'what is the weather'});assert.equal(unknown.data.intent,null);assert(!unknown.data.table);
 const command=await request(token,{message:'make me a purchase order'});assert.equal(command.data.intent,null);assert(command.data.text.includes('only read'));
 const feedback=await request(token,{message:'',context:{feedback:{responseId:sales.data.responseId,rating:'up'}}});assert.equal(feedback.status,200);
 const wrongOwner=await request(limited,{message:'',context:{feedback:{responseId:sales.data.responseId,rating:'down'}}});assert.equal(wrongOwner.status,400);
 let last:any;for(let i=0;i<30;i++)last=await request(limited,{message:'help'});assert.equal(last.status,429);assert(Number(last.headers.get('Retry-After'))>0);
 const after=await snapshot();assert.equal(after,before,'Assistant HTTP requests changed ERP database content');
 const log=(await fs.readFile(path.resolve(env.uploadDir,'assistant-logs','assistant.log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const understood=log.find(r=>r.responseId===sales.data.responseId&&r.event==='message');assert(understood);assert(!('unrecognisedText'in understood));assert.equal(understood.intent,'sales_summary');
 const unrecognised=log.find(r=>r.responseId===unknown.data.responseId);assert.equal(unrecognised.unrecognisedText,'what is the weather');
 const refused=log.find(r=>r.responseId===command.data.responseId);assert(!('unrecognisedText'in refused));assert(log.some(r=>r.event==='feedback'&&r.responseId===sales.data.responseId&&r.rating==='up'));
 console.log(JSON.stringify({checks:['JWT required','VAT-inclusive totals','strict memory/context validation','unknown-query response','action refusal','feedback ownership','per-user rate limit with Retry-After','understood text not logged','unknown text logged','database content unchanged'],pass:true},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
