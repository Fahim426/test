import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../lib/env';
const file=path.resolve(env.uploadDir,'assistant-logs','assistant.log');
export async function logEvent(event:Record<string,unknown>){
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),...event})+'\n','utf8');
}
