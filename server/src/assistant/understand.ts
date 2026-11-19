import { intents, intentById } from './intents';
import { normalise, tokens, synonymVocabulary, actionRequest } from './nlp';
import { extract, bindRecord } from './entities';
import type { Awaiting, Entities, IndexedRecord, Memory, Understanding } from './types';
const vocabulary=new Set([...synonymVocabulary,...intents.flatMap(i=>i.examples.flatMap(tokens)),...intents.flatMap(i=>i.core.flat())]);
const docs=intents.flatMap(i=>i.examples.map(example=>({intent:i.id,words:tokens(normalise(example,vocabulary))})));
const df=new Map<string,number>();for(const d of docs)for(const w of new Set(d.words))df.set(w,(df.get(w)||0)+1);
function vector(words:string[]){const values=new Map<string,number>();for(const w of words)if(df.has(w))values.set(w,(values.get(w)||0)+1);for(const[w,n]of values)values.set(w,(1+Math.log(n))*(1+Math.log((docs.length+1)/((df.get(w)||0)+1))));const length=Math.sqrt([...values.values()].reduce((n,v)=>n+v*v,0));if(length)for(const[w,n]of values)values.set(w,n/length);return values;}
const examples=docs.map(d=>({...d,vector:vector(d.words)}));
function cosine(a:Map<string,number>,b:Map<string,number>){let n=0;for(const[w,v]of a)n+=v*(b.get(w)||0);return n;}
function core(id:string,words:string[],entities:Entities){const set=new Set(words),has=(...terms:string[])=>terms.some(t=>set.has(t));
 if(id==='sales_summary')return has('sale')&&!has('invoice','order','quote','top','profit','branch')&&(words.length===1||!!entities.period||has('total','revenue','summary','value','amount','count'));
 if(id==='purchase_summary')return has('purchase')&&!has('invoice','order','receipt','grn')&&(words.length===1||!!entities.period||has('total','summary','value','amount','spending','count'));
 if(id==='stock_summary')return has('stock')&&!has('low','reorder','shortage','receipt')&&(!!entities.productId||has('available','quantity','balance','list','onhand','product'));
 if(id==='product_lookup')return !has('stock','top','history','edit','change','invoice','order','amc','serial','due','reorder','shortage','low')&&(!!entities.productId||has('product','machine','price','cost'))&&has('detail','price','cost','information','specification','brand','product','machine');
 if(id==='employee_lookup')return has('employee')&&(!!entities.employeeId||has('detail','profile','contact','information','department','phone'))&&!has('history');
 if(id==='employees')return has('employee')&&!entities.employeeId&&!has('detail','profile','contact','information','department','phone','history')&&has('list','count','headcount','active');
 if(id==='amc_contracts')return has('amc','contract')&&!has('expire','renew','end','visit','due')&&(has('list','active','contract','customer')||!!entities.customerId||!!entities.productId);
 if(id==='amc_expiring')return has('amc','contract')&&has('expire','renew','end','due')&&!has('visit');
 if(id==='machine_trace')return !has('edit','change')&&(!!entities.unitId||has('serial')&&has('trace','machine','history','warranty','number','location')||has('machine')&&has('warranty','installed','installation','trace'));
 if(id==='audit_history')return has('history','edit','change')&&!has('serial','installation','warranty');
 if(id==='low_stock')return has('stock','product')&&has('low','reorder','shortage','minimum');
 if(id==='goods_receipts')return has('grn')&&(has('list')||!!entities.period||words.length===1)||has('receipt')&&has('goods','purchase','stock');
 if(id==='service_due')return has('service','visit','maintenance')&&(has('due','scheduled','upcoming','pending','next')||!!entities.period);
 if(id==='gross_profit')return has('gross','margin')&&has('profit','margin','cost');
 if(id==='top_products'&&has('customer','branch'))return false;
 return intentById.get(id)!.core.every(group=>group.some(w=>set.has(w)));
}
function rank(text:string,e:Entities){let words=tokens(text);if(words.includes('revenue')&&!words.some(w=>['purchase','branch','top','profit','gross'].includes(w)))words.push('sale');if(e.employeeId&&words.some(w=>['detail','profile','contact','information','department','phone'].includes(w)))words.push('employee');if(e.productId&&words.some(w=>['quantity','count','left','available'].includes(w))&&!words.some(w=>['sale','purchase','invoice','order','price','cost'].includes(w)))words.push('stock','quantity');if((e.customerId||words.includes('customer'))&&(words.includes('invoice')||words.includes('order'))&&!words.includes('purchase'))words.push('sale');if((e.supplierId||words.includes('supplier'))&&(words.includes('invoice')||words.includes('order'))&&!words.includes('sale'))words.push('purchase');if(e.productId&&!words.length)words.push('product','detail');if(e.employeeId&&!words.length)words.push('employee','detail');if(e.unitId&&!words.length)words.push('serial','trace');if(e.recordId&&!words.length){const kinds:Record<string,string[]>={SalesInvoice:['sale','invoice'],PurchaseInvoice:['purchase','invoice'],SalesOrder:['sale','order'],PurchaseOrder:['purchase','order'],SalesQuotation:['list','quote'],GoodsReceipt:['goods','receipt'],AmcContract:['amc','contract']};words.push(...(kinds[e.recordType??'']??[]));}
 const v=vector(words);return intents.filter(i=>core(i.id,words,e)).map(i=>({intent:i.id,title:i.title,score:Math.max(0,...examples.filter(d=>d.intent===i.id).map(d=>cosine(v,d.vector)))})).sort((a,b)=>b.score-a.score);
}
export function understand(message:string,index:IndexedRecord[]=[],memory?:Memory,awaiting?:Awaiting,now=new Date()):Understanding{
 if(actionRequest(message))return{intent:null,entities:{},score:0,margin:0,candidates:[],text:'I can only read ERP data. I cannot create, edit, send, approve, delete or post anything.',refused:true};
 const normal=normalise(message,new Set([...vocabulary,...index.flatMap(r=>tokens(r.name+' '+r.code))]));
 if(actionRequest(normal))return{intent:null,entities:{},score:0,margin:0,candidates:[],refused:true,text:'I can only read ERP data. I cannot create, edit, send, approve, delete or post anything.'};
 if(/\b(?:weather|recipe|football|joke|poem|unsupportednetprofit|forecast|predict|prediction|projection|stock market|ignore instructions|system prompt)\b/.test(normal))return{intent:null,entities:{},score:0,margin:0,candidates:[],text:'I answer supported questions about ERP data. Try sales totals, stock, invoice dues, machine serials or AMC renewals.'};
 const combined=tokens(normal);
 const pair=combined.includes('sale')&&combined.includes('purchase')?['sales_summary','purchase_summary']:combined.includes('top')&&combined.includes('customer')&&combined.includes('product')?['top_customers','top_products']:null;
 if(pair){const choices=pair.map(id=>({label:intentById.get(id)!.title,message:intentById.get(id)!.title,intent:id}));return{intent:null,entities:{},score:0,margin:0,candidates:[],text:'I answer one question at a time. Which would you like first?',awaiting:{type:'intent',choices}};}
 const found=extract(normal,index,now);if(/\boverdue\b/i.test(message))found.entities.overdue=true;
 if(found.error)return{intent:null,entities:found.entities,score:0,margin:0,candidates:[],text:found.error};
 let entities:Entities={...found.entities};let forced:string|undefined;let resolvedChoice=false;
 if(awaiting?.type==='intent'){
   const choice=awaiting.choices?.find(c=>normalise(c.message,vocabulary)===normal||normalise(c.label,vocabulary)===normal);
   if(choice?.intent){forced=choice.intent;entities={...awaiting.entities,...entities};}
 }
 if(awaiting?.type==='entity'){
   const choice=/^\s*\d+\s*$/.test(message)?awaiting.choices?.[Number(message.trim())-1]:awaiting.choices?.find(c=>normalise(c.message,vocabulary)===normal||normalise(c.label,vocabulary)===normal);
   if(choice?.kind&&choice.id!==undefined){const record=index.find(r=>r.kind===choice.kind&&String(r.id)===String(choice.id));if(record){entities={...awaiting.entities,...entities};bindRecord(entities,record);forced=awaiting.intent??({salesInvoice:'sales_invoices',purchaseInvoice:'purchase_invoices',salesOrder:'sales_orders',purchaseOrder:'purchase_orders',quotation:'quotations',receipt:'goods_receipts',amc:'amc_contracts',product:'product_lookup',employee:'employee_lookup',unit:'machine_trace'} as Record<string,string>)[record.kind];resolvedChoice=true;found.ambiguities=[];}}
 }
 if(awaiting?.type==='detail'&&awaiting.intent){entities={...awaiting.entities,...entities};forced=awaiting.intent;if(entities.recordId&&!entities.recordType){const types:Record<string,string>={'sale invoice':'SalesInvoice','purchase invoice':'PurchaseInvoice','sale order':'SalesOrder','purchase order':'PurchaseOrder'};for(const[noun,type]of Object.entries(types))if(normal.includes(noun))entities.recordType=type;}}
 const own=rank(found.text,entities);
 const residual=tokens(found.text).filter(w=>!['same','last','month','week','year','quarter','all','only','due','top'].includes(w));
 const followup=!!memory&&!forced&&!resolvedChoice&&!(['SalesInvoice','PurchaseInvoice','SalesOrder','PurchaseOrder','SalesQuotation','GoodsReceipt','AmcContract'].includes(entities.recordType??''))&&(/^(?:and|also|same|what about|how about|now|instead|only|show all|list all)\b/i.test(message.trim())||!residual.length)&&(!own.length||!residual.length);
 if(followup){entities={...memory!.entities,...entities};forced=memory!.intent;}
 if(found.ambiguities.length){const a=found.ambiguities[0],choices=a.candidates.slice(0,12).map(r=>({label:r.code+' - '+r.name,message:r.code,kind:r.kind,id:r.id}));const candidate=forced||own[0]?.intent;return{intent:candidate??null,entities,score:own[0]?.score??0,margin:0,candidates:own.slice(0,3),text:'Which '+a.kind+' do you mean?',awaiting:{type:'entity',intent:candidate,entities,slot:a.kind,choices}};}
 const ranked=forced&&intentById.has(forced)?[{intent:forced,title:intentById.get(forced)!.title,score:1}]:own;
 const best=ranked[0],second=ranked[1],score=best?.score??0,margin=score-(second?.score??0);
 if(!best||score<0.14||margin<0.035){const fallback=tokens(found.text).includes('invoice')?['sales_invoices','purchase_invoices']:tokens(found.text).includes('order')?['sales_orders','purchase_orders']:tokens(found.text).includes('due')?['customer_dues','supplier_dues']:['sales_summary','purchase_summary','stock_summary'];const choices=(ranked.length?ranked.slice(0,3):intents.filter(i=>fallback.includes(i.id)).map(i=>({intent:i.id,title:i.title,score:0}))).map(i=>({label:i.title,message:i.title,intent:i.intent}));return{intent:null,entities,score,margin,candidates:ranked.slice(0,3),text:ranked.length?'Did you mean one of these?':'I did not understand that question. Try one of these:',awaiting:{type:'intent',entities,choices}};}
 const def=intentById.get(best.intent)!;
 if(['sales_invoices','purchase_invoices'].includes(def.id)&&/\b(?:unpaid|outstanding|due|overdue|open)\b/i.test(message))entities.unpaid=true;
 if(['sales_orders','purchase_orders','quotations'].includes(def.id)&&/\b(?:pending|open|unfulfilled|waiting)\b/i.test(message))entities.openOnly=true;
 if(def.required&&!entities[def.required])return{intent:def.id,entities,score,margin,candidates:ranked.slice(0,3),text:def.required==='employeeId'?'Which employee name or employee number?':def.required==='unitId'?'Which machine serial number?':'Which record? Give its document code, product code, or record type and ID.',awaiting:{type:'detail',intent:def.id,slot:def.required,entities}};
 return{intent:def.id,entities,score,margin,candidates:ranked.slice(0,3)};
}
