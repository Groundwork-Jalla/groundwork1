import { randomBytes } from 'node:crypto';
import { requireUser,getSupabaseAdmin } from '../_lib/stripe.js';
import { metaWhatsAppConfig } from '../_lib/meta-whatsapp.js';
import { hashConsent } from '../_lib/whatsapp-communications.js';
import { whatsappPhone } from '../../shared/whatsapp.js';

export async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','private, no-store');
  if(!['GET','POST'].includes(req.method)) {res.status(405).end();return;}
  try {
    const user=await requireUser(req);if(!user){res.status(401).json({error:'not_signed_in'});return;}
    const svc=getSupabaseAdmin();const cfg=await metaWhatsAppConfig(svc);
    if(!cfg?.phone_number_id || !cfg.display_phone || !cfg.appSecret || !cfg.webhook_verified_at) {res.status(200).json({available:false});return;}
    if(req.method==='GET') {
      const contact=await svc.from('communication_whatsapp_contacts').select('phone,consent_at,opted_out_at').eq('phone_number_id',cfg.phone_number_id).eq('user_id',user.id).maybeSingle();
      if(contact.error) throw contact.error;
      res.status(200).json({available:true,contact:contact.data});return;
    }
    if(req.body?.operation==='disconnect') {
      const saved=await svc.rpc('disconnect_whatsapp_contact',{p_user:user.id});
      if(saved.error) throw saved.error;
      res.status(200).json({ok:true});return;
    }
    if(req.body?.operation!=='connect' || req.body?.consent!==true) {res.status(400).json({error:'consent_required'});return;}
    const phone=whatsappPhone(req.body.phone);if(!phone) {res.status(400).json({error:'phone_with_country_code_required'});return;}
    if(cfg.mode==='test' && !cfg.test_recipients.includes(phone)) {res.status(400).json({error:'test_recipient_required'});return;}
    const code=randomBytes(16).toString('hex');
    const saved=await svc.rpc('begin_whatsapp_consent',{p_user:user.id,p_phone:phone,p_hash:hashConsent(code)});
    if(saved.error) {res.status(400).json({error:saved.error.message?.includes('consent_request_wait')?'consent_request_wait':'consent_connection_unavailable'});return;}
    res.status(200).json({ok:true,url:`https://wa.me/${cfg.display_phone.replace(/\D/g,'')}?text=${encodeURIComponent(`START ${code}`)}`,expiresIn:600});
  } catch {res.status(503).json({error:'whatsapp_preferences_unavailable'});}
}
