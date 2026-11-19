import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { prisma, Prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { ah, intParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { renderDocumentPdf } from '../services/report-docpdf';
import { safeFilename } from '../services/report-export';
import type { ModuleDef } from '../app';
const router=Router(), directory=path.resolve(env.uploadDir,'issued-invoices');
router.get('/:type/:id/pdf',ah(async(req,res,next)=>{
 const type=req.params.type.toUpperCase();
 if(type!=='SALES_INVOICE'&&type!=='PURCHASE_INVOICE'){next();return;}
 await new Promise<void>((ok,bad)=>can(type==='SALES_INVOICE'?'sales_invoice':'purchase_invoice','view')(req,res,e=>e?bad(e):ok()));
 const id=intParam(req);
 const invoice=type==='SALES_INVOICE'?await prisma.salesInvoice.findUnique({where:{id}}):await prisma.purchaseInvoice.findUnique({where:{id}});
 if(!invoice)throw notFound('Invoice not found');
 const key='issued.pdf.'+type+'.'+id;
 let result:{buffer:Buffer;filename:string};
 const existing=await prisma.systemSetting.findUnique({where:{key}});
 if(['DRAFT','CANCELLED'].includes(invoice.status)&&!existing?.value){result=await renderDocumentPdf(type,id);}
 else{
  const record=await prisma.$transaction(async tx=>{
   await tx.$executeRaw(Prisma.sql`INSERT INTO SystemSetting (\`key\`, \`value\`) VALUES (${key}, '') ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`);
   const stored=await tx.systemSetting.findUniqueOrThrow({where:{key}});if(stored.value)return JSON.parse(stored.value) as {fileName:string;filename:string};
   const rendered=await renderDocumentPdf(type,id);const fileName=randomUUID()+'.pdf';
   await fs.mkdir(directory,{recursive:true});const target=path.join(directory,fileName);
   await fs.writeFile(target,rendered.buffer,{flag:'wx'});
   try{
    const value={fileName,filename:rendered.filename,sha256:createHash('sha256').update(rendered.buffer).digest('hex'),archivedAt:new Date().toISOString()};
    await tx.attachment.create({data:{docType:'ISSUED_PDF_'+type,docId:id,fileName,filePath:target,mimeType:'application/pdf',size:rendered.buffer.length,uploadedBy:req.user?.id}});
    await tx.systemSetting.update({where:{key},data:{value:JSON.stringify(value)}});
    await audit(tx,req.user,'ARCHIVE_ISSUED_PDF',type==='SALES_INVOICE'?'SalesInvoice':'PurchaseInvoice',id,{sha256:value.sha256,fileName});return value;
   }catch(error){await fs.rm(target,{force:true});throw error;}
  },{timeout:30000});
  if(!/^[a-f0-9-]+\.pdf$/i.test(record.fileName))throw new Error('Invalid archived invoice filename');
  result={buffer:await fs.readFile(path.join(directory,record.fileName)),filename:record.filename};
  res.setHeader('X-Invoice-Copy','archived-original');
 }
 res.setHeader('Content-Type','application/pdf');res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Content-Disposition',(req.query.download==='1'?'attachment':'inline')+'; filename="'+safeFilename(result.filename.replace(/\.pdf$/,''))+'.pdf"');
 res.end(result.buffer);
}));
export default [{path:'/documents',router}] satisfies ModuleDef[];
