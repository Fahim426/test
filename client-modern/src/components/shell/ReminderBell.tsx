import { useQuery } from '@tanstack/react-query';
import { AlarmClock } from 'lucide-react';
import { api } from '@/lib/api';
import { useOpenScreen } from '@/store/workspace';
export function ReminderBell(){const open=useOpenScreen();const q=useQuery({queryKey:['reminders','active'],refetchInterval:60000,retry:false,queryFn:async()=>(await api.get<{count:number}>('/reminders')).data});return <button type="button" title="Service and payment reminders" aria-label="Open reminder centre" onClick={()=>open('reminder-centre')} className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-black/5"><AlarmClock size={17}/>{!!q.data?.count&&<span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] leading-4 text-white">{q.data.count}</span>}</button>;}
