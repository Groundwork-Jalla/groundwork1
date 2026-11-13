import { getSupabaseAdmin } from '../_lib/stripe.js';
import { UUID } from '../_lib/communication-email.js';
/** RFC 8058 POST only. Email scanners following a GET never change preferences. */
export async function handler(req: any,res: any) {
  if(req.method!=='POST') {res.status(405).json({error:'Use the preference page to manage reminders.'});return;}
  const token=req.query?.token;
  if(typeof token!=='string'||!UUID.test(token)) {res.status(400).json({error:'preference_link_unavailable'});return;}
  const result=await getSupabaseAdmin().rpc('set_communication_preference',{p_token:token,p_choice:'unsubscribe'});
  if(result.error) {res.status(404).json({error:'preference_link_unavailable'});return;}
  res.status(200).json({ok:true});
}
