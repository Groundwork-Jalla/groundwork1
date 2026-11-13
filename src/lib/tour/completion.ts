import { supabase } from '@/lib/supabase/client';
/** Server-confirmed completed actions; local tour dismissal is a separate preference. */
export async function readTourCompletion(projectId?:string):Promise<string[]> {
 const {data,error}=await supabase.rpc('my_project_action_completion',{p_project:projectId??null});
 if(error)return [];return Array.isArray(data)?data.filter((value):value is string=>typeof value==='string'):[];
}
export function completedTourSteps(seen:readonly string[],completed:readonly string[]):string[]{return [...new Set([...seen,...completed])];}
