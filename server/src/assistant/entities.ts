import { fold, normalise } from './nlp';
import type { Entities, IndexedRecord, Period } from './types';
export interface Extraction {text:string;entities:Entities;ambiguities:{kind:IndexedRecord['kind']|'record';candidates:IndexedRecord[]}[];error?:string;}
const dateKey=(d:Date)=>d.toISOString().slice(0,10);
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(new Date(s+'T00:00:00Z').getTime())&&dateKey(new Date(s+'T00:00:00Z'))===s;
function month(year:number,m:number):Period{return{from:dateKey(new Date(Date.UTC(year,m,1))),to:dateKey(new Date(Date.UTC(year,m+1,0))),label:'calendar month'};}
function escape(s:string){return s.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');}
const filler=new Set('demo f7 llc ltd limited inc company co corporation trading equipment printing the and of'.split(' '));
const field:Record<string,string>={product:'productId',customer:'customerId',supplier:'supplierId',employee:'employeeId',branch:'branchId',unit:'unitId'};
const recordTypes:Record<string,string>={product:'Product',customer:'Customer',supplier:'Supplier',employee:'Employee',unit:'EquipmentUnit',salesInvoice:'SalesInvoice',purchaseInvoice:'PurchaseInvoice',salesOrder:'SalesOrder',purchaseOrder:'PurchaseOrder',quotation:'SalesQuotation',receipt:'GoodsReceipt',amc:'AmcContract'};
export function bindRecord(e:Entities,r:IndexedRecord){const key=field[r.kind];if(key)(e as any)[key]=r.id;if(r.kind!=='branch'){e.recordType=recordTypes[r.kind];e.recordId=String(r.id);}}
export function extract(text:string,index:IndexedRecord[],now=new Date()):Extraction{
 if(/\b(?:invoice|order|product|employee)\s*#?\s*\d+\s*(?:and|,)\s*\d+\b/.test(text))return{text,entities:{},ambiguities:[],error:'Please ask about one record at a time, using its code.'};
 let rest=text;const entities:Entities={},ambiguities:Extraction['ambiguities']=[];
 const today=dateKey(new Date(now.getTime()+4*3600000)),base=new Date(today+'T00:00:00Z'),year=base.getUTCFullYear(),m=base.getUTCMonth();
 const take=(pattern:RegExp,fn:(...parts:string[])=>void)=>{rest=rest.replace(pattern,(...args:any[])=>{fn(...args.slice(0,-2));return ' ';});};
 const period=(from:string,to:string,label:string)=>{if(!validDate(from)||!validDate(to)||from>to)throw Error('Please give valid dates in YYYY-MM-DD order, with the start before the end.');if((+new Date(to)-+new Date(from))/86400000>3660)throw Error('Please use a date range of ten years or less.');entities.period={from,to,label};};
 try{
 take(/\b(?:between|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to|until|through)\s+(\d{4}-\d{2}-\d{2})\b/g,(_,a,b)=>period(a,b,'custom dates'));
 take(/\b(?:between|from)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(?:and|to|until|through)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,(_,d,m,y,dd,mm,yy)=>period(y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0'),yy+'-'+mm.padStart(2,'0')+'-'+dd.padStart(2,'0'),'custom dates'));
 take(/\b(?:last|past|previous)\s+(\d+)\s+days?\b/g,(_,n)=>{const from=new Date(base);from.setUTCDate(from.getUTCDate()-Number(n)+1);period(dateKey(from),today,'last '+n+' days');});
 take(/\b(today|yesterday)\b/g,(_,word)=>{const d=new Date(base);if(word==='yesterday')d.setUTCDate(d.getUTCDate()-1);period(dateKey(d),dateKey(d),word);});
 take(/\b(this|last|previous|next)\s+(month|year|quarter|week)\b/g,(_,which,unit)=>{const offset=which==='this'?0:which==='next'?1:-1;if(unit==='month'){const p=month(year,m+offset);period(p.from,p.to,which+' month');}else if(unit==='year'){period((year+offset)+'-01-01',(year+offset)+'-12-31',which+' year');}else if(unit==='quarter'){const first=Math.floor(m/3)*3+offset*3;period(dateKey(new Date(Date.UTC(year,first,1))),dateKey(new Date(Date.UTC(year,first+3,0))),which+' quarter');}else{const from=new Date(base);from.setUTCDate(from.getUTCDate()-((from.getUTCDay()+6)%7)+offset*7);const to=new Date(from);to.setUTCDate(to.getUTCDate()+6);period(dateKey(from),dateKey(to),which+' week');}});
 take(/\bq([1-4])(?:\s+(20\d{2}))?\b/g,(_,q,y)=>{const first=(Number(q)-1)*3;period(dateKey(new Date(Date.UTC(Number(y)||year,first,1))),dateKey(new Date(Date.UTC(Number(y)||year,first+3,0))),'Q'+q+' '+(y||year));});
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 take(new RegExp('\\b('+months.join('|')+')(?:\\s+(20\\d{2}))?\\b','g'),(_,name,y)=>{const p=month(Number(y)||year,months.indexOf(name));period(p.from,p.to,name+' '+(y||year));});
 take(/\b(\d{4}-\d{2}-\d{2})\b/g,(_,d)=>period(d,d,'specified date'));
 take(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,(_,d,m,y)=>{const date=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');period(date,date,'specified date');});
 }catch(error){return{text:rest,entities,ambiguities,error:(error as Error).message};}
 const amount=(n:string,suffix:string)=>Number(n.replace(/,/g,''))*(suffix==='k'?1000:suffix==='m'?1000000:1);
 take(/\b(?:above|over|at least|atleast)\s*(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/g,(matched,n,k)=>{entities.amountMin=amount(n,k);if((matched.startsWith('at least')||matched.startsWith('atleast')))entities.amountMinInclusive=true;});
 take(/\b(?:below|under|at most|atmost)\s*(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/g,(matched,n,k)=>{entities.amountMax=amount(n,k);if((matched.startsWith('at most')||matched.startsWith('atmost')))entities.amountMaxInclusive=true;});
 const top=rest.match(/\b(?:top|first)\s+(\d+)\b/);if(top){entities.top=Math.min(100,Math.max(1,Number(top[1])));rest=rest.replace(top[0],' top ');}
 if(/\b(?:show all|list all|all of them)\b/.test(text))entities.top=100;
 const statuses:Record<string,string>={'awaiting approval':'PENDING_APPROVAL','pending approval':'PENDING_APPROVAL',draft:'DRAFT',approved:'APPROVED',sent:'SENT',active:'ACTIVE',expired:'EXPIRED',cancelled:'CANCELLED',paid:'PAID'};
 for(const [word,value]of Object.entries(statuses))if(new RegExp('\\b'+word+'\\b').test(rest)){entities.status=value;break;}
 const nameWords=index.flatMap(r=>fold(r.name).split(/[^a-z0-9]+/));const freq=new Map<string,number>();for(const r of index)for(const word of new Set(fold(r.name).split(/[^a-z0-9]+/)))freq.set(word,(freq.get(word)||0)+1);
 const branchNames=new Set(index.filter(r=>r.kind==='branch').flatMap(r=>[fold(r.name),...(r.aliases??[]).map(fold)]));
 const matches:{r:IndexedRecord;start:number;end:number;weight:number}[]=[];
 for(const r of index){
  const words=fold(r.name).split(/[^a-z0-9]+/).filter(w=>w&&!filler.has(w)&&((freq.get(w)||0)/Math.max(1,index.length)<0.75));
  const aliases=new Set([r.code,r.name,...(r.aliases??[]),words.join(' ')]);
  for(let size=2;size<=words.length;size++)for(let i=0;i+size<=words.length;i++)aliases.add(words.slice(i,i+size).join(' '));
  if(r.kind==='employee')for(const w of words)if(w.length>=4)aliases.add(w);
  for(const raw of aliases){const alias=normalise(raw,new Set(nameWords));if(!alias||alias.length<2||filler.has(alias)||(r.kind!=='branch'&&branchNames.has(fold(raw))))continue;const pattern=new RegExp('(?<![a-z0-9])'+escape(alias)+'(?![a-z0-9])','g');for(const match of rest.matchAll(pattern)){const start=match.index!;matches.push({r,start,end:start+match[0].length,weight:alias.length+(fold(raw)===fold(r.code)?1000:0)});}}
 }
 matches.sort((a,b)=>b.weight-a.weight);
 const used:{start:number;end:number}[]=[];const chosen=new Map<string,IndexedRecord[]>();
 for(const match of matches){if(used.some(span=>match.start<span.end&&match.end>span.start)&&!used.some(span=>match.start===span.start&&match.end===span.end))continue;const group=chosen.get(match.r.kind)??[];if(!group.some(r=>r.id===match.r.id))group.push(match.r);chosen.set(match.r.kind,group);if(!used.some(s=>s.start===match.start&&s.end===match.end))used.push({start:match.start,end:match.end});}
 for(const[kind,candidates]of chosen){if(candidates.length===1)bindRecord(entities,candidates[0]);else ambiguities.push({kind:kind as IndexedRecord['kind'],candidates});}
 for(const span of used.sort((a,b)=>b.start-a.start))rest=rest.slice(0,span.start)+' '.repeat(span.end-span.start)+rest.slice(span.end);
 const documentKinds:Record<string,string>={'sale invoice':'SalesInvoice','purchase invoice':'PurchaseInvoice','sale order':'SalesOrder','purchase order':'PurchaseOrder',quote:'SalesQuotation',receipt:'GoodsReceipt',amc:'AmcContract',product:'Product',customer:'Customer',supplier:'Supplier',employee:'Employee',invoice:'Invoice',order:'Order'};
 for(const[noun,type]of Object.entries(documentKinds)){
  const re=new RegExp('\\b'+noun+'\\s*(?:(number|no|id|#)\\s*)?#?\\s*(\\d+)\\b');const match=rest.match(re);if(!match)continue;
  const kinds=type==='Invoice'?['salesInvoice','purchaseInvoice']:type==='Order'?['salesOrder','purchaseOrder']:[Object.entries(recordTypes).find(([,t])=>t===type)?.[0]];
  const explicitId=match[1]==='id'||match[1]==='#'||match[0].includes('#');
  const candidates=index.filter(r=>kinds.includes(r.kind)&&(String(r.id)===match[2]||!explicitId&&Number(r.code.match(/(\d+)$/)?.[1])===Number(match[2])));
  if(candidates.length===1)bindRecord(entities,candidates[0]);
  else if(candidates.length>1)ambiguities.push({kind:'record',candidates});
  else return{text:rest,entities,ambiguities,error:'I cannot match that number within your permitted records. Use the full document/product code, or specify an ID explicitly.'};
  rest=rest.replace(match[0],noun);break;
 }
 return{text:rest.trim(),entities,ambiguities};
}
export function currentMonth(now:Date):Period{const d=new Date(now.getTime()+4*3600000);return{...month(d.getUTCFullYear(),d.getUTCMonth()),label:'this month'};}
