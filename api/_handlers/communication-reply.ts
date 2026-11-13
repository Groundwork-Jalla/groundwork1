import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { UUID } from '../_lib/communication-email.js';

/** Queue the staff's explicit send. The worker delivers the saved recipient/body. */
export async function handler(req: any,res: any) {
  if(req.method!=='POST') {res.status(405).json({error:'Method not allowed'});return;}
  const user=await requireUser(req);if(!user) {res.status(401).json({error:'Not signed in'});return;}
  const {threadId,body,clientRef}=req.body??{};
  if(!UUID.test(String(threadId))||!UUID.test(String(clientRef))||typeof body!=='string'||!body.trim()||body.length>10000) {res.status(400).json({error:'invalid_message'});return;}
  const svc=getSupabaseAdmin();
  const roles=await svc.from('user_roles').select('role').eq('user_id',user.id).eq('role','admin').limit(1);
  if(roles.error) {res.status(503).json({error:'Role check unavailable'});return;}
  if(!roles.data?.length) {res.status(403).json({error:'not_admin'});return;}
  const {createClient}=await import('@supabase/supabase-js');
  const bearer=String(req.headers?.authorization??'').replace(/^Bearer\s+/i,'');
  const caller=createClient(process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY!,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const result=await caller.rpc('queue_communication_reply',{p_thread:threadId,p_body:body.trim(),p_client_ref:clientRef});
  if(result.error) {res.status(409).json({error:result.error.message});return;}
  res.status(202).json({ok:true,messageId:result.data,status:'queued'});
}
