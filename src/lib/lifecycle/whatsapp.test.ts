import { afterEach,describe,expect,it,vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { approvedTemplateMatches,latestDueWhatsAppStep,META_API_VERSION,sameWhatsAppDefinition,serviceWindowOpen,whatsappCommand,whatsappPhone,whatsappTemplate,whatsappTemplatePayload } from '../../../shared/whatsapp';
import { equalSecret,postMetaMessage,validMetaSignature,type MetaWhatsAppConfig } from '../../../api/_lib/meta-whatsapp';
import { receiveMetaEvents } from '../../../api/_lib/whatsapp-communications';
import type { Step } from '../../../shared/lifecycle-copy';

const step:Step={position:1,delay_hours:0,channel:'email',code:'CS01',subject_en:'Welcome',subject_fr:'Bienvenue',body_en:'Hi {{first_name}}, finish onboarding for {{project_name}}.',body_fr:'Bonjour {{first_name}}, terminez votre inscription pour {{project_name}}.',cta_key:'onboarding',cta_label_en:'Complete onboarding',cta_label_fr:'Terminer mon inscription'};
const cfg:MetaWhatsAppConfig={enabled:true,mode:'test',phone_number_id:'123456789',business_account_id:'987654321',display_phone:'+15550001111',messaging_account_id:'',test_recipients:['+237699123456'],api_version:META_API_VERSION,token:'private-token',appSecret:'private-app-secret',verifyToken:'private-verify-token',webhook_verified_at:'2026-11-14',signed_event_at:'2026-11-14',template_checked_at:null};
afterEach(()=>vi.unstubAllGlobals());

describe('WhatsApp identities, consent and windows',()=>{
  it('normalizes international phones without guessing local country codes or interpreting arbitrary text',()=>{
    expect(whatsappPhone('+237 699-123-456')).toBe('+237699123456');
    expect(whatsappPhone('237699123456')).toBe('+237699123456');
    for(const bad of ['0699','+00123456789','call me 237699123456','+237699123456<script>','+237699123456\nSTOP',null]) expect(whatsappPhone(bad)).toBeNull();
  });
  it('recognizes deliberate STOP and one-time START commands',()=>{
    expect(whatsappCommand(' ARRÊT ')).toBe('stop');
    expect(whatsappCommand(`START ${'a'.repeat(32)}`)).toBe('a'.repeat(32));
    expect(whatsappCommand('please do not stop my project')).toBeNull();
    expect(whatsappCommand('START short')).toBeNull();
  });
  it('uses the signed inbound timestamp; old/future messages do not invent a new 24-hour window',()=>{
    const now=Date.parse('2026-11-14T12:00:00Z');
    expect(serviceWindowOpen('2026-11-14T11:59:00Z',now)).toBe(true);
    expect(serviceWindowOpen('2026-11-13T12:00:00Z',now)).toBe(false);
    expect(serviceWindowOpen('2026-11-15T12:00:00Z',now)).toBe(false);
    expect(serviceWindowOpen(null,now)).toBe(false);
  });
});
describe('approved reminder copy and independent timing',()=>{
  it('preserves English/French copy and the exact action in a per-step template',()=>{
    const {definition,payload,body}=whatsappTemplatePayload(step,{email:'alex@example.com',fullName:'Alex Smith',lang:'fr'},{project_name:'My home'},'https://tryjalla.com');
    expect(definition.name).toBe('groundwork_cs01');expect(definition.language).toBe('fr');
    expect(definition.components[0].text).toContain('Bonjour {{1}}');
    expect(payload.template.components[0].parameters).toEqual([{type:'text',text:'Alex'},{type:'text',text:'My home'}]);
    expect(payload.template.components[1].parameters[0].text).toBe('work/onboarding');
    expect(body).toContain('https://tryjalla.com/work/onboarding');
  });
  it('requires exact locale, copy and button approval; an unrelated template is never a fallback',()=>{
    const definition=whatsappTemplate(step,'en','https://tryjalla.com');
    const remote={...definition,status:'APPROVED'};
    expect(approvedTemplateMatches(definition,remote)).toBe(true);
    expect(approvedTemplateMatches(definition,{...remote,language:'fr'})).toBe(false);
    expect(approvedTemplateMatches(definition,{...remote,status:'PAUSED'})).toBe(false);
    expect(approvedTemplateMatches(definition,{...remote,name:'hello_world'})).toBe(false);
    expect(approvedTemplateMatches(definition,{...remote,components:remote.components.map((c,i)=>i?c:{...c,text:'different'})})).toBe(false);
    expect(sameWhatsAppDefinition({b:2,a:{c:3,d:4}},{a:{d:4,c:3},b:2})).toBe(true);
  });
  it('holds missing translations, unknown variables and overlong template copy',()=>{
    expect(()=>whatsappTemplate({...step,body_fr:''},'fr','https://tryjalla.com')).toThrow('translation_required');
    expect(()=>whatsappTemplate({...step,body_en:'{{admin_secret}}'},'en','https://tryjalla.com')).toThrow('unknown_template_variable');
    expect(()=>whatsappTemplate({...step,body_en:'a'.repeat(1025)},'en','https://tryjalla.com')).toThrow('template_copy_invalid');
  });
  it('refuses external and backslash invitation targets',()=>{
    for(const invite_path of ['https://example.com','//example.com/path','/\\example.com']) expect(()=>whatsappTemplatePayload({...step,cta_key:'invitation'},{email:'a@example.com'},{invite_path},'https://tryjalla.com')).toThrow('unsafe_action_link');
  });
  it('uses entry-based 0/24/72/168-hour timing and chooses one latest due reminder after a late connection',()=>{
    const entered='2026-11-01T00:00:00Z';const base=Date.parse(entered);
    const steps=[0,24,48,96].map((delay_hours,i)=>({...step,position:i+1,delay_hours}));
    expect(latestDueWhatsAppStep(steps,entered,base+23*3600_000)?.position).toBe(1);
    expect(latestDueWhatsAppStep(steps,entered,base+72*3600_000)?.position).toBe(3);
    expect(latestDueWhatsAppStep(steps,entered,base+200*3600_000)?.position).toBe(4);
    expect(latestDueWhatsAppStep(steps,entered,base-1)).toBeNull();
  });
});
describe('raw signed callbacks and Meta delivery',()=>{
  it('verifies the exact bytes, including whitespace, using the App Secret',()=>{
    const raw=Buffer.from('{ "object": "whatsapp_business_account" }');
    const signature=`sha256=${createHmac('sha256',cfg.appSecret).update(raw).digest('hex')}`;
    expect(validMetaSignature(raw,signature,cfg.appSecret)).toBe(true);
    expect(validMetaSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),signature,cfg.appSecret)).toBe(false);
    expect(validMetaSignature(raw,'sha256=bad',cfg.appSecret)).toBe(false);
    expect(validMetaSignature(raw,signature,'')).toBe(false);
    expect(equalSecret('challenge','challenge')).toBe(true);expect(equalSecret('','')).toBe(false);
  });
  it('records API acceptance with a durable callback reference, without claiming delivery',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({messages:[{id:'wamid.accepted'}]}),{status:200}));vi.stubGlobal('fetch',fetcher);
    expect(await postMetaMessage(cfg,'message-uuid',{to:'+237699123456',type:'text',text:{body:'Hello'}})).toEqual({status:'sent',providerId:'wamid.accepted'});
    const [url,request]=fetcher.mock.calls[0];expect(url).toBe(`https://graph.facebook.com/${META_API_VERSION}/123456789/messages`);
    const payload=JSON.parse(request.body);expect(payload.biz_opaque_callback_data).toBe('groundwork:message-uuid');expect(payload.to).toBe('+237699123456');expect(payload).not.toHaveProperty('token');
  });
  it('does not retry timeouts or replace a rejected text with a generic template',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:131047,message:'private provider detail'}}),{status:400}));vi.stubGlobal('fetch',fetcher);
    expect(await postMetaMessage(cfg,'id',{to:'+237699123456',type:'text'})).toEqual({status:'failed',error:'meta_131047'});expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new Error('connection interrupted'));
    expect(await postMetaMessage(cfg,'id',{type:'text'})).toEqual({status:'uncertain',error:'uncertain_send'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('holds success-without-ID and provider server errors as uncertain',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:200})).mockResolvedValueOnce(new Response('{}',{status:503}));vi.stubGlobal('fetch',fetcher);
    expect((await postMetaMessage(cfg,'id',{})).status).toBe('uncertain');expect((await postMetaMessage(cfg,'id',{})).status).toBe('uncertain');
  });
  it('accepts only configured account/phone events and retains BSUID-only senders',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{received:true},error:null});const svc={rpc,from:vi.fn()};
    const change={field:'messages',value:{metadata:{phone_number_id:cfg.phone_number_id},messages:[{id:'inbound-1',from_user_id:'US.123456789',timestamp:'1794657600',type:'text',text:{body:'Help please'}}]}};
    expect(await receiveMetaEvents(svc,cfg,{object:'whatsapp_business_account',entry:[{id:'wrong-account',changes:[change]}]})).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(await receiveMetaEvents(svc,cfg,{object:'whatsapp_business_account',entry:[{id:cfg.business_account_id,changes:[change]}]})).toBe(1);
    expect(rpc).toHaveBeenCalledWith('record_whatsapp_inbound',expect.objectContaining({p_phone:null,p_bsuid:'US.123456789',p_body:'Help please',p_at:'2026-11-14T12:00:00.000Z'}));
  });
});
