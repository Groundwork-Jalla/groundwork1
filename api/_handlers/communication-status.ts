import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { checkCommunicationProvider, type SetupCheck } from '../_lib/communication-readiness.js';

/** Admin-only, read-only setup checks. Does not send mail or enable any journey. */
export async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.status(405).json({error:'Method not allowed'});return;}
  try {
    const user=await requireUser(req);
    if(!user){res.status(401).json({error:'Not signed in'});return;}
    const svc=getSupabaseAdmin();
    const role=await svc.from('user_roles').select('role').eq('user_id',user.id).eq('role','admin').limit(1);
    if(role.error){res.status(503).json({error:'Role check unavailable'});return;}
    if(!role.data?.length){res.status(403).json({error:'not_admin'});return;}
    const [settings,secret,...schema]=await Promise.all([
      svc.from('communication_settings').select('sender_email,followup_sender_email,application_sender_email,reply_domain').eq('id',true).single(),
      svc.from('app_config').select('value').eq('key','resend_webhook_secret').maybeSingle(),
      svc.from('communication_messages').select('sent_at').limit(0),
      svc.from('followup_queue').select('last_reviewed_at').limit(0),
      svc.from('communication_issues').select('key').limit(0),
    ]);
    const errors=[settings,...schema].flatMap(result=>result.error?[result.error]:[]);
    const missing=errors.some(error=>['42703','42P01','PGRST204','PGRST205'].includes(error.code));
    const checks:SetupCheck[]=[{key:'schema',state:errors.length?'attention':'pass',reason:missing?'schema_required':errors.length?'database_unavailable':'schema_current'}];
    const signingKey=secret.data?.value??process.env.RESEND_WEBHOOK_SECRET??'';
    checks.push({key:'signingSecret',state:secret.error?'unknown':signingKey?'pass':'attention',reason:secret.error?'database_unavailable':signingKey?'signing_secret_present':'signing_secret_required'});
    checks.push(...await checkCommunicationProvider(settings.error?null:settings.data));
    res.status(200).json({checkedAt:new Date().toISOString(),checks});
  }catch{res.status(503).json({error:'Communication setup check unavailable'});}
}
