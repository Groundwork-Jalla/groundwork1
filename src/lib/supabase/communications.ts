import { supabase } from './client';
export interface CommunicationSettings {
  delivery_enabled: boolean;sender_name: string;sender_email: string|null;followup_sender_email:string;application_sender_email:string;reply_domain: string|null;
  test_recipients: string[];default_owner_id: string|null;next_contact_hours: number;updated_at: string;
}
export interface CommunicationReadiness {
  checkedAt:string;
  checks:{key:'schema'|'sending'|'receiving'|'receivingAccess'|'webhook'|'signingSecret';state:'pass'|'attention'|'unknown';reason:string;domains?:string[]}[];
}
export async function readCommunicationReadiness():Promise<CommunicationReadiness> {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('not_signed_in');
  const response=await fetch('/api/events?action=communication-status',{
    method:'GET',headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',
  });
  if(!response.ok)throw new Error('communication_check_unavailable');
  return response.json();
}
export type Preference = {lang:'en'|'fr';project_creation_paused:boolean;activation_unsubscribed:boolean};
export async function readPreference(token: string): Promise<Preference> {
  const {data,error}=await supabase.rpc('communication_preference_preview',{p_token:token});
  if(error||!data) throw new Error('preference_link_unavailable');
  return data;
}
export async function savePreference(token: string,choice: 'pause_project'|'unsubscribe'|'resume'): Promise<Preference> {
  const {data,error}=await supabase.rpc('set_communication_preference',{p_token:token,p_choice:choice});
  if(error||!data) throw new Error('preference_save_failed');return data;
}
export async function queueCommunicationReply(threadId: string,body: string,clientRef: string) {
  const {data:{session}}=await supabase.auth.getSession();if(!session) throw new Error('not_signed_in');
  const response=await fetch('/api/events?action=communication-reply',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({threadId,body,clientRef})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.messageId) throw new Error(result.error||'message_queue_failed');
  return result.messageId as string;
}
