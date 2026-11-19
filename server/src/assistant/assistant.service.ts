import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AuthUser } from '../middleware/auth';
import { intents, intentById } from './intents';
import { normalise, tokens, synonymVocabulary, actionRequest } from './nlp';
import { understand } from './understand';
import { extract, currentMonth } from './entities';
import { loadIndex } from './record-index';
import { handle } from './handlers';
import { requestSchema, entitiesSchema } from './validation';
import { AccessError, branchScope, canView, validateEntities, sourcePermission } from './security';
import { logEvent } from './telemetry';
import type { ChatResponse, Entities, Awaiting } from './types';
const recent=new Map<string,{userId:number;intent:string|null;score:number;time:number}>();
const allowedWords=new Set([...synonymVocabulary,...intents.flatMap(i=>i.examples.flatMap(tokens)),...intents.flatMap(i=>i.core.flat()),...('hey hi hello hiya pls plz thanks thank you okay ok yep yeah wanna gonna gotta lemme gimme around paperwork figures answer out near left shelf bring remain getting anything owner up records retail wholesale details log since onwards please actually currently whole entire complete full again quick quickly just any everything right check checking am tell yesterday tomorrow month week year quarter q1 q2 q3 q4 total count report reports all which date dates value values approved pending due amounts vat aed units unit department contact phone information employees current previous last next mean ve s').split(' ')]);
const defaultQuestions=['Sales this month','Purchases this month','Stock for GX-15300','Who owes us money?','AMC renewals due'];
export class InputError extends Error {}
export async function answer(input:unknown,user:AuthUser,now=new Date()):Promise<ChatResponse>{
 const parsed=requestSchema.safeParse(input);if(!parsed.success)throw new InputError('Invalid message or conversation state. Start a new conversation and try again.');
 const body=parsed.data,started=performance.now();
 if(body.context?.feedback){const f=body.context.feedback,old=recent.get(f.responseId);if(!old||old.userId!==user.id||Date.now()-old.time>3600000)throw new InputError('That feedback reference is no longer available.');await logEvent({event:'feedback',userId:user.id,responseId:f.responseId,intent:old.intent,score:old.score,rating:f.rating});return{intent:null,text:'Thanks for the feedback.'};}
 let understood:ReturnType<typeof understand>|undefined,response:ChatResponse;
 try{
  if(/^(?:hi|hello|help|what can you do|examples|start)$/i.test(body.message.trim()))response={intent:null,text:'Ask about sales, purchases, stock, invoice dues, branch performance, machine serials, AMC, staff or edit history. I only read data; I cannot change or send anything.',chips:defaultQuestions};
  else if(actionRequest(body.message)){understood=understand(body.message);response={intent:null,text:understood.text!};}
  else{
   understood=understand(body.message,[],body.memory as any,undefined,now);
   branchScope(user);const index=await loadIndex(user);
   if(body.memory){branchScope(user,body.memory.entities);validateEntities(body.memory.entities,index);}
   if(body.context?.awaiting?.entities){branchScope(user,body.context.awaiting.entities);validateEntities(body.context.awaiting.entities,index);}
   // Candidate IDs are never trusted merely because they came back from the browser.
   if(body.context?.awaiting?.choices)for(const choice of body.context.awaiting.choices){if(choice.kind&&choice.id!==undefined&&!index.some(r=>r.kind===choice.kind&&String(r.id)===String(choice.id)))throw new AccessError('That record choice is not within your permitted data. Start a new question.');}
   understood=understand(body.message,index,body.memory as any,body.context?.awaiting as Awaiting|undefined,now);
   const e=understood.entities,def=understood.intent?intentById.get(understood.intent):undefined;
   if(def&&!def.permissions.every(p=>canView(user,p)))throw new AccessError('Your role does not allow me to read '+def.title.toLowerCase()+'.');
   if(understood.awaiting){response={intent:understood.intent,text:understood.text!,awaiting:understood.awaiting,chips:understood.awaiting.choices?.map(c=>c.message),...(def?{memory:{intent:def.id,entities:e}}:{})};}
   else if(!def)response={intent:null,text:understood.text||'I did not understand that question. Please rephrase it.',...(understood.awaiting?{awaiting:understood.awaiting}:{}),chips:defaultQuestions};
   else{
    const checked=entitiesSchema.safeParse(e);if(!checked.success)throw new InputError('One of the filters is invalid. Use a valid date range, amount, record code or a top count from 1 to 100.');
    const expectedType:Record<string,string>={sales_invoices:'SalesInvoice',purchase_invoices:'PurchaseInvoice',sales_orders:'SalesOrder',purchase_orders:'PurchaseOrder',quotations:'SalesQuotation',goods_receipts:'GoodsReceipt'};
    if(e.recordId&&!e.recordType&&expectedType[def.id])e.recordType=expectedType[def.id];
    branchScope(user,e);validateEntities(e,index);
    const clean=normalise(body.message,new Set([...allowedWords,...index.flatMap(r=>tokens(r.name+' '+r.code))]));const extraction=extract(clean,index,now);
    const unmatchedCodes=(extraction.text.match(/\b[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*\b/g)||[]).filter(c=>/\d/.test(c));
    const unknown=tokens(extraction.text).filter(w=>!allowedWords.has(w)&&!/^\d/.test(w));
    const queryReferences=unmatchedCodes.length||unknown.length;
    const unsupported=Object.keys(e).filter(key=>!['recordType','recordId','top'].includes(key)&&!def.filters.includes(key));
    const requires=def.id==='product_lookup'&&!e.productId?'productId':def.id==='audit_history'&&(!e.recordId||!e.recordType)?'recordId':undefined;
    const documents:Record<string,string>={sales_invoices:'SalesInvoice',purchase_invoices:'PurchaseInvoice',sales_orders:'SalesOrder',purchase_orders:'PurchaseOrder',quotations:'SalesQuotation',goods_receipts:'GoodsReceipt'};
    if(e.recordType&&documents[def.id]&&['SalesInvoice','PurchaseInvoice','SalesOrder','PurchaseOrder','SalesQuotation','GoodsReceipt'].includes(e.recordType)&&e.recordType!==documents[def.id])response={intent:null,text:'That document code belongs to a different document type. Ask for that type explicitly.',chips:defaultQuestions};
    else if(requires){const text=requires==='productId'?'Which product name or product code?':'Which supported record type and document/product code?';response={intent:def.id,text,awaiting:{type:'detail',intent:def.id,slot:requires,entities:e},memory:{intent:def.id,entities:e}};}
    else if(queryReferences){const words=unmatchedCodes.length?unmatchedCodes:unknown;response={intent:null,text:'I could not match "'+words.slice(0,4).join(' ')+'" to a supported term or permitted record. Please give the exact record name/code or rephrase.',awaiting:{type:'detail',intent:def.id,slot:'record',entities:e},memory:{intent:def.id,entities:e}};}
    else if(/\bas of\b/i.test(body.message)&&['customer_dues','supplier_dues','stock_summary'].includes(def.id)){response={intent:null,text:'I can show current invoice dues or current stock. Historical as-of balances are not supported by this question.',chips:defaultQuestions};}
    else if(unsupported.length){response={intent:null,text:'That question does not support the '+unsupported.map(k=>({period:'date range',productId:'product',customerId:'customer',supplierId:'supplier',employeeId:'employee',branchId:'branch',unitId:'serial number',amountMin:'minimum amount',amountMax:'maximum amount',amountMinInclusive:'inclusive minimum amount',amountMaxInclusive:'inclusive maximum amount',status:'status',unpaid:'unpaid-only',openOnly:'open-only'} as Record<string,string>)[k]||k).join(', ')+' filter. '+(unsupported.includes('period')?'This view shows current records, not a historical snapshot.':'Please choose a more specific invoice/list question.'),chips:defaultQuestions};}
    else{
     if(def.id==='audit_history'&&!canView(user,sourcePermission[e.recordType!]||'__none__'))throw new AccessError('Your role cannot view the underlying record for that edit history.');
     const used:Entities={...e};if(['sales_summary','purchase_summary','top_products','top_customers','branch_performance','gross_profit'].includes(def.id)&&!used.period)used.period=currentMonth(now);
     response=await handle(def.id,{user,entities:used,now});response.memory={intent:def.id,entities:used};
    }
   }
  }
 }catch(error){if(error instanceof AccessError)response={intent:null,text:error.message};else throw error;}
 const responseId=randomUUID();response.responseId=responseId;
 if(recent.size>10000){const cutoff=Date.now()-3600000;for(const[id,value]of recent)if(value.time<cutoff)recent.delete(id);if(recent.size>10000)recent.clear();}
 recent.set(responseId,{userId:user.id,intent:response.intent,score:understood?.score??0,time:Date.now()});
 await logEvent({event:'message',userId:user.id,branchId:user.branchId??null,responseId,intent:understood?.intent??response.intent,score:understood?.score??0,margin:understood?.margin??0,ms:Math.round(performance.now()-started),awaiting:response.awaiting?.type??null,...(!understood?.refused&&(!understood?.intent||response.awaiting?.slot==='record')&&!/^(?:hi|hello|help|what can you do|examples|start)$/i.test(body.message.trim())?{unrecognisedText:body.message}:{} )});
 return response;
}
