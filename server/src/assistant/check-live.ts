import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { AuthUser } from '../middleware/auth';
import { intents } from './intents';
import { answer } from './assistant.service';
import { loadIndex, clearIndexCache } from './record-index';
import { handle } from './handlers';
import { requestSchema } from './validation';
async function main(){
 const admin=await prisma.user.findUniqueOrThrow({where:{username:'admin'},include:{role:true}});
 const actor:AuthUser={id:admin.id,username:admin.username,role:admin.role.name,roleId:admin.roleId,branchId:admin.branchId,permissions:new Set((await prisma.rolePermission.findMany({where:{roleId:admin.roleId}})).map(p=>p.module+':'+p.action))};
 const index=await loadIndex(actor),now=new Date();
 const p=index.find(r=>r.kind==='product'&&r.code==='GX-15300')||index.find(r=>r.kind==='product')!,employee=index.find(r=>r.kind==='employee')!,unit=index.find(r=>r.kind==='unit')!;
 const before={stock:await prisma.stockTransaction.count(),journals:await prisma.journalEntry.count(),audit:await prisma.auditLog.count(),settings:await prisma.systemSetting.count()};
 const results:{intent:string;pass:boolean;error?:string;rows?:number}[]=[];
 for(const def of intents){let message=def.examples[0];if(def.id==='product_lookup')message='product details for '+p.code;if(def.id==='employee_lookup')message='employee details for '+employee.code;if(def.id==='machine_trace')message='trace serial '+unit.code;if(def.id==='audit_history')message='who edited '+p.code;
  try{const result=await answer({message},actor,now);assert.equal(result.intent,def.id,result.text);assert(!result.awaiting,result.text);assert(result.table,'Expected fixed handler query result');results.push({intent:def.id,pass:true,rows:result.table.rows.length});}
  catch(error){results.push({intent:def.id,pass:false,error:(error as Error).message});}
 }
 const sales=await answer({message:'sales this month'},actor,now);assert.equal(Number(sales.table?.rows[0]?.net),1758650);
 const purchases=await answer({message:'purchases this month'},actor,now);assert.equal(Number(purchases.table?.rows[0]?.net),188000);
 const gp=await answer({message:'gross profit this month'},actor,now);assert.equal(Number(gp.table?.rows[0]?.grossProfit),433650);
 const dues=await answer({message:'customer dues show all'},actor,now);assert.equal(dues.table?.rows.reduce((n,r)=>n+Number(r.due),0),788891.25);
 const inv=await answer({message:'show unpaid sales invoices'},actor,now);assert(inv.table?.rows.every(r=>['POSTED','PARTIALLY_PAID'].includes(String(r.status))&&Number(r.due)>0));
 const branch=(await prisma.branch.findMany({where:{code:'DXB'}}))[0];const branchActor:AuthUser={...actor,role:'QA Scoped Reader',branchId:branch.id};
 const scoped=await answer({message:'sales this month'},branchActor,now);assert.equal(Number(scoped.table?.rows[0]?.net),496650);
 const other=await answer({message:'sales in Sharjah this month'},branchActor,now);assert.equal(other.intent,null);assert(other.text.includes('outside your access'));
 const forged=await answer({message:'and last month',memory:{intent:'sales_summary',entities:{branchId:2}}},branchActor,now);assert.equal(forged.intent,null);assert(forged.text.includes('outside your access'));
 const noHr:AuthUser={...branchActor,permissions:new Set(['sales_invoice:view'])};const denied=await answer({message:'list employees'},noHr,now);assert.equal(denied.intent,null);assert(denied.text.includes('role does not allow'));
 const failClosed=await answer({message:'sales this month'},{...branchActor,branchId:null},now);assert(failClosed.text.includes('assigned branch'));
 assert(!requestSchema.safeParse({message:'sales',memory:{intent:'sales_summary',entities:{branchId:'1 OR 1=1'}}}).success);
 assert(!requestSchema.safeParse({message:'sales',memory:{intent:'sales_summary',entities:{role:'Admin'}}}).success);
 const unknownCode=await answer({message:'show stock for GX-NOT-FOUND-999'},actor,now);assert(!unknownCode.table);
 const unknownName=await answer({message:'customer dues for Imaginary Unicorn Holdings'},actor,now);assert(!unknownName.table);
 const follow=await answer({message:'and last month?',memory:sales.memory},actor,now);assert.equal(follow.intent,'sales_summary');assert(follow.memory?.entities.period?.label==='last month');
 const ambiguous=await answer({message:'customer dues for Signage Workshop'},actor,now);assert.equal(ambiguous.awaiting?.type,'entity');const choice=ambiguous.awaiting!.choices![0];const selected=await answer({message:choice.message,context:{awaiting:ambiguous.awaiting},memory:ambiguous.memory},actor,now);assert.equal(selected.intent,'customer_dues');assert(selected.memory?.entities.customerId);
 const after={stock:await prisma.stockTransaction.count(),journals:await prisma.journalEntry.count(),audit:await prisma.auditLog.count(),settings:await prisma.systemSetting.count()};assert.deepEqual(after,before,'Assistant changed database state');
 console.log(JSON.stringify({results,checks:'financial totals; unpaid filtering; branch predicates; forged memory; role checks; fail-closed unassigned users; unknown records; follow-ups; ambiguity; zero database writes'},null,2));
 if(results.some(r=>!r.pass))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
