import { createHmac, timingSafeEqual } from 'node:crypto';
import { META_API_VERSION } from '../../shared/whatsapp.js';

export type WhatsAppService = { from: (table:string) => any; rpc: (name:string,args?:any) => any };
export interface MetaWhatsAppConfig {
  enabled:boolean; mode:'test'|'live'; phone_number_id:string; business_account_id:string;
  display_phone:string; messaging_account_id:string; test_recipients:string[]; api_version:string;
  token:string; appSecret:string; verifyToken:string;
  webhook_verified_at:string|null; signed_event_at:string|null;
  template_checked_at:string|null;
}
/** Separate keys from the old GHL/project sender: saving this connection cannot activate it. */
export async function metaWhatsAppConfig(svc: WhatsAppService): Promise<MetaWhatsAppConfig | null> {
  const [settings,secrets] = await Promise.all([
    svc.from('communication_whatsapp_settings').select('*').eq('id',true).maybeSingle(),
    svc.from('app_config').select('key,value').in('key',['meta_whatsapp_token','meta_whatsapp_app_secret','meta_whatsapp_verify_token']),
  ]);
  if (settings.error || !settings.data) {
    if (['42P01','PGRST205'].includes(settings.error?.code)) return null;
    throw new Error('whatsapp_settings_unavailable');
  }
  if (secrets.error) throw new Error('whatsapp_settings_unavailable');
  const keys:Record<string,string> = Object.fromEntries((secrets.data??[]).map((r:any)=>[r.key,String(r.value??'')]));
  return {...settings.data, token:keys.meta_whatsapp_token??'',appSecret:keys.meta_whatsapp_app_secret??'',verifyToken:keys.meta_whatsapp_verify_token??''};
}
export function validMetaSignature(raw: Buffer, signature: unknown, secret: string): boolean {
  if (!secret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256',secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7),'hex'));
}
export function equalSecret(a: string,b: string): boolean {
  return !!a && !!b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
export async function metaRequest(cfg: MetaWhatsAppConfig, path: string, method='GET', body?: any) {
  if (!/^\d+(?:\/[a-z_]+)?$/.test(path) || !/^v\d+\.\d+$/.test(cfg.api_version)) throw new Error('invalid_meta_endpoint');
  const response = await fetch(`https://graph.facebook.com/${cfg.api_version || META_API_VERSION}/${path}`,{
    method,signal:AbortSignal.timeout(12_000),headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const json = await response.json().catch(()=>null);
  return {ok:response.ok,status:response.status,json};
}
export type MetaSendResult = {status:'sent'|'failed'|'uncertain';providerId?:string;error?:string};
/** No automatic retry: a timeout may follow an accepted message. Callback UUID reconciles it. */
export async function postMetaMessage(cfg: MetaWhatsAppConfig, id: string, payload: any): Promise<MetaSendResult> {
  try {
    const response = await metaRequest(cfg,`${cfg.phone_number_id}/messages`,'POST',{
      ...payload,messaging_product:'whatsapp',recipient_type:'individual',biz_opaque_callback_data:`groundwork:${id}`,
      ...(cfg.messaging_account_id ? {messaging_account_id:cfg.messaging_account_id} : {}),
    });
    if (response.ok && typeof response.json?.messages?.[0]?.id === 'string') return {status:'sent',providerId:response.json.messages[0].id};
    if (response.status >= 500 || response.ok) return {status:'uncertain',error:'uncertain_send'};
    const code = Number(response.json?.error?.code);
    return {status:'failed',error:Number.isSafeInteger(code) && code > 0 ? `meta_${code}` : `meta_http_${response.status}`};
  } catch { return {status:'uncertain',error:'uncertain_send'}; }
}
