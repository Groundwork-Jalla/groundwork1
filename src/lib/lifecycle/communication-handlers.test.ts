import { createHmac } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({user:{} as any,requireUser:vi.fn(),from:vi.fn(),record:vi.fn(),caller:vi.fn(),create:vi.fn(),receive:vi.fn(),role:true,secret:'',error:null as any}));
vi.mock('../../../api/_lib/stripe.js',()=>({requireUser:h.requireUser,getSupabaseAdmin:()=>({from:h.from,rpc:h.record})}));
vi.mock('@supabase/supabase-js',()=>({createClient:h.create}));
vi.mock('../../../api/_lib/communication-email.js',async original=>({...await original<typeof import('../../../api/_lib/communication-email.js')>(),receiveCommunicationEmail:h.receive}));
import { handler as reply } from '../../../api/_handlers/communication-reply';
import { handler as unsubscribe } from '../../../api/_handlers/communication-unsubscribe';
import { handler as webhook } from '../../../api/_handlers/email-receipt';
const thread='00000000-0000-0000-0000-000000000001';const reference='00000000-0000-0000-0000-000000000002';
const response=()=>({status:vi.fn().mockReturnThis(),json:vi.fn()});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('SUPABASE_URL','https://db.test');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-service');vi.stubEnv('VITE_SUPABASE_ANON_KEY','test-anon');
 h.secret='whsec_'+Buffer.from('unit-test-signature-key').toString('base64');h.role=true;h.error=null;h.requireUser.mockResolvedValue({id:'admin-user'});
 h.record.mockResolvedValue({data:{},error:null});h.caller.mockResolvedValue({data:reference,error:null});h.receive.mockResolvedValue({received:true});
 h.from.mockImplementation((table:string)=>{let mode='select';const q:any={select:()=>mode==='update'?Promise.resolve({data:[],error:null}):q,eq:()=>q,neq:()=>q,update:()=>{mode='update';return q;},
  limit:async()=>({data:h.role?[{role:'admin'}]:[],error:h.error}),maybeSingle:async()=>({data:table==='app_config'?{value:h.secret}:null,error:null})};return q;});
 h.create.mockReturnValue({from:h.from,rpc:h.caller});vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('staff reply authorization',()=>{
 const req=()=>({method:'POST',headers:{authorization:'Bearer admin-session'},body:{threadId:thread,body:'Please continue.',clientRef:reference,to:'attacker@example.test'}});
 it('queues only the saved conversation and attributes the transaction to the caller JWT',async()=>{
  const res=response();await reply(req(),res);expect(res.status).toHaveBeenCalledWith(202);
  expect(h.caller).toHaveBeenCalledWith('queue_communication_reply',{p_thread:thread,p_body:'Please continue.',p_client_ref:reference});
  expect(h.create).toHaveBeenCalledWith('https://db.test','test-anon',expect.objectContaining({global:{headers:{Authorization:'Bearer admin-session'}}}));
  expect(h.record).not.toHaveBeenCalled();
 });
 it('rejects signed-out accounts before reading private roles',async()=>{
  h.requireUser.mockResolvedValue(null);const res=response();await reply(req(),res);expect(res.status).toHaveBeenCalledWith(401);expect(h.from).not.toHaveBeenCalled();
 });
 it('rejects non-admins without making a queue transaction',async()=>{
  h.role=false;const res=response();await reply(req(),res);expect(res.status).toHaveBeenCalledWith(403);expect(h.caller).not.toHaveBeenCalled();
 });
 it('keeps an unavailable role read separate from a denial',async()=>{
  h.error={message:'offline'};const res=response();await reply(req(),res);expect(res.status).toHaveBeenCalledWith(503);expect(h.caller).not.toHaveBeenCalled();
 });
 it('rejects malformed identity and oversized messages',async()=>{
  for(const body of [{threadId:'bad',body:'Hi',clientRef:reference},{threadId:thread,body:'x'.repeat(10001),clientRef:reference}]){const res=response();await reply({...req(),body},res);expect(res.status).toHaveBeenCalledWith(400);}
  expect(h.caller).not.toHaveBeenCalled();
 });
 it('surfaces a database refusal rather than claiming delivery',async()=>{
  h.caller.mockResolvedValue({error:{message:'communications_paused'}});const res=response();await reply(req(),res);expect(res.status).toHaveBeenCalledWith(409);expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ok:true}));
 });
});
describe('recipient one-click preferences',()=>{
 it('does not unsubscribe on a GET from an email scanner',async()=>{
  const res=response();await unsubscribe({method:'GET',query:{token:reference}},res);expect(res.status).toHaveBeenCalledWith(405);expect(h.record).not.toHaveBeenCalled();
 });
 it('uses only the supplied capability for a confirmed POST',async()=>{
  const res=response();await unsubscribe({method:'POST',query:{token:reference}},res);
  expect(h.record).toHaveBeenCalledWith('set_communication_preference',{p_token:reference,p_choice:'unsubscribe'});expect(res.status).toHaveBeenCalledWith(200);
 });
 it('refuses malformed capabilities without changing any preference',async()=>{
  const res=response();await unsubscribe({method:'POST',query:{token:'invalid'}},res);expect(res.status).toHaveBeenCalledWith(400);expect(h.record).not.toHaveBeenCalled();
 });
});
function signed(type:string,data:any,valid=true) {
 const body={type,data,created_at:new Date().toISOString()};const rawBody=Buffer.from(JSON.stringify(body));const id='msg_test';const stamp=String(Math.floor(Date.now()/1000));
 const signature=createHmac('sha256',Buffer.from(h.secret.slice(6),'base64')).update(`${id}.${stamp}.${rawBody.toString()}`).digest('base64');
 return {method:'POST',body,rawBody,headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':`v1,${valid?signature:'invalid'}`}};
}
describe('signed communication webhooks',()=>{
 it('does not fetch or store an unsigned incoming email',async()=>{
  const res=response();await webhook(signed('email.received',{email_id:reference},false),res);expect(res.status).toHaveBeenCalledWith(401);expect(h.receive).not.toHaveBeenCalled();expect(h.caller).not.toHaveBeenCalled();
 });
 it('routes a signed incoming email through the receiving adapter',async()=>{
  const res=response();await webhook(signed('email.received',{email_id:reference}),res);expect(h.receive).toHaveBeenCalledWith(expect.anything(),{email_id:reference});expect(res.json).toHaveBeenCalledWith({ok:true,received:true});
 });
 it('requests a retry when receiving or recording fails',async()=>{
  h.receive.mockRejectedValue(new Error('provider unavailable'));const res=response();await webhook(signed('email.received',{email_id:reference}),res);expect(res.status).toHaveBeenCalledWith(503);
 });
 it('records early provider events using their signed correlation tags',async()=>{
  const res=response();await webhook(signed('email.delivered',{email_id:'provider-id',tags:[{name:'groundwork_enrollment',value:thread},{name:'groundwork_position',value:'2'}]}),res);
  expect(h.caller).toHaveBeenCalledWith('record_communication_email_event',expect.objectContaining({p_provider_id:'provider-id',p_event:'delivered',p_enrollment:thread,p_position:2,p_message:null}));
 });
 it('records reminder engagement even though it is not an invitation delivery status',async()=>{
  const res=response();await webhook(signed('email.clicked',{email_id:'provider-id',tags:{groundwork_message:reference}}),res);
  expect(h.caller).toHaveBeenCalledWith('record_communication_email_event',expect.objectContaining({p_event:'clicked',p_message:reference}));expect(res.status).toHaveBeenCalledWith(200);
 });
 it('does not acknowledge an unrecorded delivery event as successful',async()=>{
  h.caller.mockResolvedValue({error:{code:'42P01'}});const res=response();await webhook(signed('email.delivered',{email_id:'provider-id'}),res);expect(res.status).toHaveBeenCalledWith(503);
 });
});
