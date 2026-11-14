import { getSupabaseAdmin } from '../_lib/stripe.js';
import { equalSecret, metaWhatsAppConfig, validMetaSignature } from '../_lib/meta-whatsapp.js';
import { receiveMetaEvents } from '../_lib/whatsapp-communications.js';

export async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)) {res.status(405).end();return;}
  try {
    const svc=getSupabaseAdmin();const cfg=await metaWhatsAppConfig(svc);
    if(!cfg?.appSecret || !cfg.verifyToken) {res.status(503).json({error:'WhatsApp webhook not configured'});return;}
    if(req.method==='GET') {
      if(req.query?.['hub.mode']!=='subscribe' || !equalSecret(String(req.query?.['hub.verify_token']??''),cfg.verifyToken) || !/^\d{1,100}$/.test(String(req.query?.['hub.challenge']??''))) {res.status(403).end();return;}
      const saved=await svc.from('communication_whatsapp_settings').update({webhook_verified_at:new Date().toISOString()}).eq('id',true);
      if(saved.error) throw saved.error;
      res.setHeader('Content-Type','text/plain');res.status(200).send(String(req.query['hub.challenge']));return;
    }
    if(!Buffer.isBuffer(req.rawBody) || req.rawBody.length>2_000_000) {res.status(413).end();return;}
    if(!validMetaSignature(req.rawBody,req.headers?.['x-hub-signature-256'],cfg.appSecret)) {res.status(401).end();return;}
    await receiveMetaEvents(svc,cfg,req.body);
    res.status(200).json({ok:true});
  } catch {res.status(503).json({error:'WhatsApp callback processing unavailable. Meta may retry this event.'});}
}
