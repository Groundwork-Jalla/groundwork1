import { ctaPath, pickLang, render, stepTimeline, type Context, type Person, type Step } from './lifecycle-copy.js';

export const META_API_VERSION = 'v27.0';
export function whatsappPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[\d ()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
export function serviceWindowOpen(lastInbound: string | null, now = Date.now()): boolean {
  const at = lastInbound ? Date.parse(lastInbound) : NaN;
  return Number.isFinite(at) && at <= now && at > now - 24 * 3600_000;
}
export function whatsappCommand(body: string): 'stop' | string | null {
  const text = body.trim();
  if (/^(stop|unsubscribe|cancel|arrêt|arret|désabonner|desabonner)$/i.test(text)) return 'stop';
  return text.match(/^START\s+([a-f0-9]{32})$/i)?.[1].toLowerCase() ?? null;
}
export function latestDueWhatsAppStep<T extends Step>(steps: T[], entered: string, now: number): T | null {
  return stepTimeline(steps).filter(s => Date.parse(entered) + s.hoursFromEntry * 3600_000 <= now).at(-1)?.step ?? null;
}

const variables = new Set(['first_name','name','email','project_name','client_name','contractor_name','client_first_name','contractor_first_name']);
export interface WhatsAppTemplate {
  name: string; language: 'en' | 'fr'; category: 'UTILITY';
  components: Array<Record<string, any>>;
  variables: string[];
}
/** Exact per-step approval copy. Never substitute an unrelated generic template. */
export function whatsappTemplate(step: Step, language: 'en' | 'fr', site: string): WhatsAppTemplate {
  if (!step.code || !/^[a-z0-9_]+$/i.test(step.code)) throw new Error('step_code_required');
  const body = (language === 'fr' ? step.body_fr : step.body_en)?.trim();
  if (!body) throw new Error('translation_required');
  const keys: string[] = [];
  const text = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!variables.has(key)) throw new Error('unknown_template_variable');
    let index = keys.indexOf(key); if (index < 0) index = keys.push(key) - 1;
    return `{{${index + 1}}}`;
  });
  if (text.length > 1024 || /\{\{|\}\}/.test(text.replace(/\{\{\d+\}\}/g, ''))) throw new Error('template_copy_invalid');
  const examples = keys.map(key => ({ first_name:'Alex',name:'Alex Smith',email:'alex@example.com',project_name:'My home',client_name:'Alex Smith',contractor_name:'Sam Jones',client_first_name:'Alex',contractor_first_name:'Sam' }[key] ?? 'Groundwork'));
  const components: WhatsAppTemplate['components'] = [{ type:'BODY', text, ...(keys.length ? {example:{body_text:[examples]}} : {}) },
    {type:'FOOTER',text:language === 'fr' ? 'Envoyez STOP pour arrêter les rappels.' : 'Reply STOP to stop reminders.'}];
  if (step.cta_key) {
    const label = (language === 'fr' ? step.cta_label_fr : step.cta_label_en)?.trim();
    if (!label || label.length > 25) throw new Error('template_button_invalid');
    const origin = new URL(site).origin;
    components.push({ type:'BUTTONS', buttons:[{type:'URL',text:label,url:`${origin}/{{1}}`,example:[`${origin}/dashboard`]}] });
  }
  return {name:`groundwork_${step.code.toLowerCase()}`,language,category:'UTILITY',components,variables:keys};
}
export function approvedTemplateMatches(expected: WhatsAppTemplate, actual: any): boolean {
  if (actual?.status !== 'APPROVED' || actual.name !== expected.name || actual.language !== expected.language) return false;
  const shape = (components: any[]) => (components ?? []).map(c => ({
    type:c.type, ...(c.text !== undefined ? {text:c.text} : {}),
    ...(c.buttons ? {buttons:c.buttons.map((b:any) => ({type:b.type,text:b.text,url:b.url}))} : {}),
  }));
  return JSON.stringify(shape(actual.components)) === JSON.stringify(shape(expected.components));
}
/** Postgres jsonb reorders object keys. Compare structures, not insertion order. */
export function sameWhatsAppDefinition(a: unknown,b: unknown): boolean {
  const stable = (v:any):any => Array.isArray(v) ? v.map(stable) : v && typeof v==='object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])) : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export function whatsappTemplatePayload(step: Step, person: Person, context: Context, site: string) {
  const language = pickLang(person.lang);
  const definition = whatsappTemplate(step, language, site);
  const components: Array<Record<string, any>> = [];
  if (definition.variables.length) components.push({type:'body',parameters:definition.variables.map(key => ({type:'text',text:render(`{{${key}}}`,person,context,language).replace(/\s+/g,' ').trim().slice(0,500) || (language === 'fr' ? 'votre contact' : 'your contact')}))});
  let link: string | null = null;
  if (step.cta_key) {
    const path = ctaPath(step.cta_key,context);
    if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('unsafe_action_link');
    const target = new URL(path,site);
    if (target.origin !== new URL(site).origin) throw new Error('unsafe_action_link');
    link = target.href;
    components.push({type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:target.href.slice(target.origin.length + 1)}]});
  }
  return {definition,payload:{type:'template',template:{name:definition.name,language:{code:language},components}},
    body:render(language === 'fr' ? step.body_fr : step.body_en,person,context,language) + (link ? `\n${link}` : '')};
}

export const WHATSAPP_ERRORS: Record<string,string> = {
  not_configured:'Save the Meta connection details first.',
  connection_disabled:'WhatsApp sending is switched off.',
  consent_required:'The recipient must connect WhatsApp from their profile and send the START message first.',
  test_recipient_required:'Add this team phone to the test recipients in both Meta and Groundwork.',
  outside_24h_window:'Ask the recipient to message the business again. Free-text replies are available for 24 hours after their latest message.',
  recipient_opted_out:'This recipient stopped WhatsApp messages. They must opt in again from their profile.',
  template_not_approved:'This exact reminder and language need Meta template approval. Export templates, then check the connection again.',
  uncertain_send:'Meta did not confirm the result. This message will not be resent automatically; check WhatsApp Manager and the delivery callbacks.',
  meta_190:'The Meta access token has expired or is invalid. Replace it in the connection settings.',
  meta_131030:'Verify this recipient in Meta API Setup before sending from the test number.',
  meta_131047:'The 24-hour reply window has closed. The recipient must message the business again.',
  meta_132001:'Meta could not find this approved template in the requested language.',
  whatsapp_migration_required:'Apply the Meta WhatsApp communications migration, then refresh this page.',
  verify_webhook_before_enabling:'Verify the callback in Meta and send a message from the team phone before enabling sending.',
  consent_request_wait:'Wait 30 seconds before requesting another connection link.',
  review_details_required:'Describe the result you checked and confirm the delivery review.',
  meta_message_id_required:'Enter the message ID from Meta, starting with wamid.',
  reminder_changed:'This reminder changed before it was sent. Review its current copy and template approval.',
  manually_confirmed_not_sent:'Staff verified that this message was not sent. It has not been resent.',
};
export function whatsappError(code: string) { return WHATSAPP_ERRORS[code] ?? `WhatsApp could not complete this action (${code}).`; }
