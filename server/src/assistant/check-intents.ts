import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { understand } from './understand';
import { fixture, tuned, negative, entityCases, NOW } from './intent-cases';
const results:Record<string,{passed:number;total:number;failures:unknown[]}>={};
function group(name:string,cases:any[],run:(c:any)=>void){let passed=0;const failures:unknown[]=[];for(const c of cases){try{run(c);passed++;}catch(error){failures.push({case:c,error:(error as Error).message});}}results[name]={passed,total:cases.length,failures};}
const get=(message:string,memory?:any,awaiting?:any)=>understand(message,fixture,memory,awaiting,NOW);
group('tuned',tuned,c=>assert.equal(get(c.message).intent,c.intent));
group('negative',negative,message=>assert.equal(get(message).intent,null));
group('entities',entityCases,c=>{const r=get(c.message);assert.equal(r.intent,c.intent);for(const[key,value]of Object.entries(c.expected)){assert.deepEqual(key.split('.').reduce((v:any,k)=>v?.[k],r.entities),value,key);}});
group('followups',[
 ['and last month?',{intent:'sales_summary',entities:{branchId:1}},{intent:'sales_summary',branchId:1,from:'2026-10-01'}],
 ['same for Sharjah',{intent:'sales_summary',entities:{branchId:1,period:{from:'2026-10-01',to:'2026-10-31',label:'last month'}}},{intent:'sales_summary',branchId:2,from:'2026-10-01'}],
 ['show all',{intent:'sales_invoices',entities:{branchId:1}},{intent:'sales_invoices',branchId:1,top:100}],
 ['and purchases?',{intent:'sales_summary',entities:{}},{intent:'purchase_summary'}],
],([message,memory,expected])=>{const r=get(message,memory);assert.equal(r.intent,expected.intent);if(expected.branchId)assert.equal(r.entities.branchId,expected.branchId);if(expected.from)assert.equal(r.entities.period?.from,expected.from);if(expected.top)assert.equal(r.entities.top,expected.top);});
group('clarifications',[1,2,3,4],n=>{
 if(n===1){const r=get('customer dues for Signage Workshop');assert.equal(r.awaiting?.type,'entity');assert(!r.entities.customerId);const next=get('1',undefined,r.awaiting);assert.equal(next.intent,'customer_dues');assert(next.entities.customerId);}
 if(n===2){const r=get('employee details for Ahmed');assert.equal(r.awaiting?.type,'entity');assert(!r.entities.employeeId);}
 if(n===3){const r=get('show employee details');assert.equal(r.awaiting?.type,'detail');const next=get('EMP-0001',undefined,r.awaiting);assert.equal(next.intent,'employee_lookup');assert.equal(next.entities.employeeId,41);}
 if(n===4){const r=get('sales between 2026-02-30 and 2026-03-02');assert.equal(r.intent,null);assert(r.text?.includes('valid dates'));}
});
const safety=path.join(__dirname,'safety-regression.json');if(fs.existsSync(safety))group('safety-regression',JSON.parse(fs.readFileSync(safety,'utf8')),message=>assert.equal(get(message).intent,null));
group('number-clarification',[1],()=>{const a=get('show invoice 5');assert.equal(a.awaiting?.type,'entity');assert.equal(a.awaiting?.choices?.length,2);const chosen=get('SI-2026-00005',{intent:'sales_summary',entities:{}},a.awaiting);assert.equal(chosen.intent,'sales_invoices');assert.equal(chosen.entities.recordId,'8');});
group('ambiguity-safety',['sales and purchases today','top customers and products','show invoice 3 and 4'],message=>{const r=get(message);assert.equal(r.intent,null);});
const extra=path.join(__dirname,'fresh-regression.json');if(fs.existsSync(extra))group('fresh-regression',JSON.parse(fs.readFileSync(extra,'utf8')),c=>assert.equal(get(c.message).intent,c.intent));
const held=path.join(__dirname,'held-out.json');if(process.argv.includes('--held-out')&&fs.existsSync(held))group('held-out',JSON.parse(fs.readFileSync(held,'utf8')),c=>assert.equal(get(c.message).intent,c.intent));
if(process.argv.includes('--held-out')){const extraNegative=path.join(__dirname,'held-out-negative.json');if(fs.existsSync(extraNegative))group('held-out-negative',JSON.parse(fs.readFileSync(extraNegative,'utf8')),message=>assert.equal(get(message).intent,null));}
console.log(JSON.stringify(results,null,2));
const failed=Object.entries(results).some(([name,r])=>name==='held-out'?r.passed/r.total<0.9:r.passed!==r.total);if(failed)process.exitCode=1;
