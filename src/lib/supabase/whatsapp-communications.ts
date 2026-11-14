import { supabase } from './client';
export async function whatsappApi(action:'whatsapp-admin'|'whatsapp-profile',body?:Record<string,unknown>) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('not_signed_in');
  const response=await fetch(`/api/events?action=${action}`,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.error??'whatsapp_unavailable');
  return data;
}
