import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { applicationSender,composeCommunicationEmail,receiveCommunicationEmail,sendCommunicationEmail,sendQueuedCommunicationReplies } from '../../../api/_lib/communication-email';
const thread='00000000-0000-0000-0000-000000000001';const token='00000000-0000-0000-0000-000000000002';const received='00000000-0000-0000-0000-000000000003';
const input={to:'client@example.test',subject:'Your next action',body:'Hello\n\nContinue your project.',threadId:thread,preferenceToken:token,senderName:'Groundwork',senderEmail:'hello@example.test',replyDomain:'replies.example.test'};
const settings={id:true,delivery_enabled:true,sender_name:'Groundwork',sender_email:'hello@example.test',followup_sender_email:'contact@example.test',application_sender_email:'partner@example.test',reply_domain:'replies.example.test'};
beforeEach(()=>{vi.stubEnv('PUBLIC_SITE_URL','https://groundwork.test');vi.stubEnv('RESEND_API_KEY','test-key');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('communication payloads',()=>{
 it('uses the configured partner address independently of paused activation delivery',async()=>{
  const svc={rpc:vi.fn(),from:vi.fn(()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:{...settings,delivery_enabled:false},error:null})};return q;})};
  expect(await applicationSender(svc)).toBe('Groundwork <partner@example.test>');
 });
 it('puts a confirmed preference choice and a thread-specific reply address on every message',()=>{
  const payload=composeCommunicationEmail({...input,projectOptOut:true,cta:{label:'Create project',path:'/projects/new'}});
  expect(payload.reply_to).toBe(`reply+${thread}@replies.example.test`);
  expect(payload.text).toContain('No project to add right now?');expect(payload.html).toContain(`/communication/preferences/${token}#project`);
  expect(payload.text).toContain('https://groundwork.test/projects/new');expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
 });
 it('uses French preference copy and escapes message HTML',()=>{
  const payload=composeCommunicationEmail({...input,lang:'fr',body:'<script>alert(1)</script>',projectOptOut:true});
  expect(payload.html).not.toContain('<script>');expect(payload.html).toContain('&lt;script&gt;');expect(payload.text).toContain('Aucun projet');
 });
 it('keeps reply threading headers only for valid message identifiers',()=>{
  expect(composeCommunicationEmail({...input,inReplyTo:'<original@example.test>'}).headers['In-Reply-To']).toBe('<original@example.test>');
  expect(composeCommunicationEmail({...input,inReplyTo:'<original>\r\nBcc: other@example.test'}).headers['In-Reply-To']).toBeUndefined();
 });
 it.each([{to:'client@example.test\r\nBcc: other@example.test'},{senderEmail:'bad'},{replyDomain:'evil.test/path'},{threadId:'invalid'}])('rejects malformed delivery identity %j',patch=>{
  expect(()=>composeCommunicationEmail({...input,...patch})).toThrow();
 });
 it('does not turn a protocol-relative CTA into an external link',()=>{
  expect(composeCommunicationEmail({...input,cta:{label:'Go',path:'//attacker.test'}}).text).not.toContain('attacker.test');
 });
});
describe('provider sending',()=>{
 it('sends the exact prepared payload with a stable idempotency key',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{"id":"provider-id"}'));vi.stubGlobal('fetch',fetch);
  const payload=composeCommunicationEmail(input);expect(await sendCommunicationEmail(payload,'communication/message')).toEqual({ok:true,providerId:'provider-id'});
  const request=fetch.mock.calls[0][1];expect(request.headers['Idempotency-Key']).toBe('communication/message');expect(JSON.parse(request.body)).toEqual(payload);
 });
 it('does not attempt delivery without credentials',async()=>{
  vi.stubEnv('RESEND_API_KEY','');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect((await sendCommunicationEmail(composeCommunicationEmail(input),'key')).ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps provider bodies and connection errors out of the returned diagnostic',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('private provider details',{status:429})).mockRejectedValueOnce(new Error('secret details')));
  expect(await sendCommunicationEmail(composeCommunicationEmail(input),'key')).toEqual({ok:false,error:'resend_429'});
  expect(await sendCommunicationEmail(composeCommunicationEmail(input),'key')).toEqual({ok:false,error:'resend_connection_uncertain'});
 });
});
function inboundService(domains=['replies.example.test']) {return {rpc:vi.fn().mockResolvedValue({data:{received:true},error:null}),from:vi.fn(()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{reply_domains:domains},error:null})};return q;})};}
function incoming(patch:Record<string,unknown>={}) {return {id:received,from:'Client <client@example.test>',to:[`reply+${thread}@replies.example.test`],subject:'Help',text:'Please help',message_id:'<client@example.test>',authentication:{dmarc:'pass'},created_at:'2026-11-13T12:00:00Z',attachments:[],...patch};}
describe('incoming replies',()=>{
 it('retrieves content only from the fixed provider endpoint and routes it to the saved thread',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming())));vi.stubGlobal('fetch',fetch);const svc=inboundService();
  await receiveCommunicationEmail(svc,{email_id:received});
  expect(fetch.mock.calls[0][0]).toBe(`https://api.resend.com/emails/receiving/${received}?html_format=cid`);
  expect(svc.rpc).toHaveBeenCalledWith('record_communication_inbound',expect.objectContaining({p_thread:thread,p_sender:'client@example.test',p_authenticated:true,p_body:'Please help'}));
 });
 it.each([{dmarc:'fail',dkim:'pass'},{dmarc:'unknown',dkim:'fail'},{dkim:'pass',spf:'pass'},null])('records failed or missing sender authentication without trusting it: %j',async authentication=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming({authentication})))));const svc=inboundService();
  await receiveCommunicationEmail(svc,{email_id:received});expect(svc.rpc.mock.calls[0][1].p_authenticated).toBe(false);
 });
 it('does not treat DKIM as sender alignment without a DMARC pass',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming({authentication:{dmarc:'gray',dkim:'pass'}})))));const svc=inboundService();
  await receiveCommunicationEmail(svc,{email_id:received});expect(svc.rpc.mock.calls[0][1].p_authenticated).toBe(false);
 });
 it('accepts previously used reply domains after settings change',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming()))));const svc=inboundService(['replies.example.test','new.example.test']);
  await receiveCommunicationEmail(svc,{email_id:received});expect(svc.rpc).toHaveBeenCalledOnce();
 });
 it.each([['other@example.test'],[`reply+${thread}@attacker.test`],[`reply+${thread}@replies.example.test`,'reply+00000000-0000-0000-0000-000000000009@replies.example.test']])('does not route unrelated, wrong-domain or ambiguous recipients: %j',async(...addresses)=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming({to:addresses})))));const svc=inboundService();
  expect((await receiveCommunicationEmail(svc,{email_id:received})).ignored).toBe(true);expect(svc.rpc).not.toHaveBeenCalled();
 });
 it('rejects URL injection and mismatched provider identities',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming({id:token}))));vi.stubGlobal('fetch',fetch);const svc=inboundService();
  await expect(receiveCommunicationEmail(svc,{email_id:'../../domains'})).rejects.toThrow('Invalid inbound email id');expect(fetch).not.toHaveBeenCalled();
  await expect(receiveCommunicationEmail(svc,{email_id:received})).rejects.toThrow('Inbound identity mismatch');
 });
 it('does not fetch raw-email or attachment URLs and renders an HTML-only reply as plain text',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(incoming({text:null,html:'<script>unsafe()</script><p>Help please</p>',attachments:[{id:'attachment'}],raw:{download_url:'https://attacker.test/private'}}))));vi.stubGlobal('fetch',fetch);const svc=inboundService();
  await receiveCommunicationEmail(svc,{email_id:received});expect(fetch).toHaveBeenCalledOnce();expect(svc.rpc.mock.calls[0][1]).toMatchObject({p_body:' Help please ',p_attachments:1});
 });
});
describe('staff outbox',()=>{
 it('does no work while delivery is paused',async()=>{
  const from=vi.fn(()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:{...settings,delivery_enabled:false},error:null})};return q;});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await sendQueuedCommunicationReplies({from,rpc:vi.fn()})).toEqual({sent:0,failed:0,skipped:0});expect(fetch).not.toHaveBeenCalled();
 });
});
