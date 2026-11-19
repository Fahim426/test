import { Router } from 'express';
import { answer, InputError } from './assistant.service';
const counts=new Map<number,{start:number;count:number}>();
export const router=Router();
router.post('/message',async(req,res)=>{
 const user=req.user!;const now=Date.now();let bucket=counts.get(user.id);if(!bucket||now-bucket.start>=60000){bucket={start:now,count:0};counts.set(user.id,bucket);}bucket.count++;
 if(counts.size>10000)for(const[id,b]of counts)if(now-b.start>=60000)counts.delete(id);
 if(bucket.count>30){res.setHeader('Retry-After',String(Math.ceil((60000-(now-bucket.start))/1000)));res.status(429).json({intent:null,text:'Please wait a little. The assistant allows 30 messages per minute per signed-in user.'});return;}
 try{res.setHeader('Cache-Control','private, no-store');res.json(await answer(req.body,user));}
 catch(error){if(error instanceof InputError){res.status(400).json({intent:null,text:error.message});return;}console.error('[assistant]',error instanceof Error?error.name:'Error');res.status(503).json({intent:null,text:'I could not read that data just now. Please try again.'});}
});
