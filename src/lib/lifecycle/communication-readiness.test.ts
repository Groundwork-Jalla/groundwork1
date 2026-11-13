import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({requireUser:vi.fn(),from:vi.fn(),fetch:vi.fn(),roles:true,roleError:null as any,schemaError:null as any,secret:'private-signing-secret'}));
vi.mock('../../../api/_lib/stripe.js',()=>({requireUser:h.requireUser,getSupabaseAdmin:()=>({from:h.from})}));
import { handler } from '../../../api/_handlers/communication-status';
import { checkCommunicationProvider,COMMUNICATION_WEBHOOK_EVENTS } from '../../../api/_lib/communication-readiness';

const id='d91cd9bd-1176-453e-8fc1-35364d380206';
const settings={sender_email:'welcome@mail.example.test',followup_sender_email:'contact@example.test',application_sender_email:'partner@example.test',reply_domain:'replies.example.test'};
const domains=[
 {id,name:'mail.example.test',status:'verified',capabilities:{sending:'enabled',receiving:'disabled'}},
 {id,name:'example.test',status:'verified',capabilities:{sending:'enabled',receiving:'disabled'}},
 {id,name:'replies.example.test',status:'verified',capabilities:{sending:'disabled',receiving:'enabled'}},
];
const hooks=[{id,endpoint:'https://www.example.test/api/events?action=email-receipt',status:'enabled',events:COMMUNICATION_WEBHOOK_EVENTS,signing_secret:'provider-secret-never-returned'}];
const json=(data:any,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function provider(options:{domains?:any[];hooks?:any[];mxStatus?:string}={}) {
 h.fetch.mockImplementation(async(url:string)=>{
  const path=new URL(url).pathname;
  if(path==='/domains')return json({data:options.domains??domains,has_more:false});
  if(path==='/webhooks')return json({data:options.hooks??hooks,has_more:false});
  if(path.startsWith('/domains/'))return json({status:'verified',capabilities:{receiving:'enabled'},records:[{record:'Receiving',type:'MX',status:options.mxStatus??'verified'}]});
  if(path.startsWith('/emails/receiving/'))return json({name:'not_found'},404);
  throw new Error('unexpected destination');
 });
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('fetch',h.fetch);vi.stubEnv('RESEND_API_KEY','private-server-key');vi.stubEnv('PUBLIC_SITE_URL','https://www.example.test');vi.stubEnv('RESEND_WEBHOOK_SECRET','');
 h.roles=true;h.roleError=null;h.schemaError=null;h.secret='private-signing-secret';h.requireUser.mockResolvedValue({id:'admin-user'});
 h.from.mockImplementation((table:string)=>{
  const result=()=>({data:table==='user_roles'?(h.roles?[{role:'admin'}]:[]):table==='communication_settings'?settings:table==='app_config'?{value:h.secret}:[],error:table==='user_roles'?h.roleError:table==='communication_settings'?h.schemaError:null});
  const query:any={select:()=>query,eq:()=>query,limit:()=>query,single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:any)=>Promise.resolve(result()).then(resolve)};return query;
 });
 provider();
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const response=()=>({setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn()});
describe('admin email setup authorization',()=>{
 it('requires a signed-in administrator before accessing provider configuration',async()=>{
  h.requireUser.mockResolvedValueOnce(null);const anonymous=response();await handler({method:'GET'},anonymous);
  expect(anonymous.status).toHaveBeenCalledWith(401);expect(h.from).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  h.roles=false;const member=response();await handler({method:'GET'},member);
  expect(member.status).toHaveBeenCalledWith(403);expect(h.from.mock.calls.every(([table])=>table==='user_roles')).toBe(true);expect(h.fetch).not.toHaveBeenCalled();
 });
 it('treats an unavailable role check separately from an ordinary denial',async()=>{
  h.roleError={code:'network_error'};const res=response();await handler({method:'GET'},res);
  expect(res.status).toHaveBeenCalledWith(503);expect(h.fetch).not.toHaveBeenCalled();
 });
 it('refuses mutations and prevents caching the private diagnostic',async()=>{
  const res=response();await handler({method:'POST'},res);
  expect(res.status).toHaveBeenCalledWith(405);expect(h.requireUser).not.toHaveBeenCalled();expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
 });
 it('returns explicit configuration checks without exposing keys, secrets or provider payloads',async()=>{
  const res=response();await handler({method:'GET'},res);expect(res.status).toHaveBeenCalledWith(200);
  const report=res.json.mock.calls[0][0];expect(report.checks).toHaveLength(6);expect(report.checks.every((row:any)=>row.state==='pass')).toBe(true);
  const serialized=JSON.stringify(report);
  for(const secret of ['private-server-key','private-signing-secret','provider-secret-never-returned'])expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain('welcome@mail.example.test');
  for(const [url,init]of h.fetch.mock.calls){expect(new URL(url).origin).toBe('https://api.resend.com');expect(init.method).toBe('GET');expect(init.redirect).toBe('error');}
  expect(h.fetch.mock.calls.filter(([url])=>url.includes('/emails/receiving/')).map(([url])=>new URL(url).pathname)).toEqual(['/emails/receiving/00000000-0000-0000-0000-000000000000']);
 });
 it('points an incomplete deployed schema to the incremental migration',async()=>{
  h.schemaError={code:'42703',message:'not returned'};h.secret='';const res=response();await handler({method:'GET'},res);
  expect(res.json.mock.calls[0][0].checks).toEqual(expect.arrayContaining([
   {key:'schema',state:'attention',reason:'schema_required'},
   {key:'signingSecret',state:'attention',reason:'signing_secret_required'},
  ]));
 });
});
describe('provider configuration checks',()=>{
 it('keeps an unavailable settings read separate from genuinely missing sender addresses',async()=>{
  const checks=await checkCommunicationProvider(null);
  expect(checks).toContainEqual({key:'sending',state:'unknown',reason:'database_unavailable'});
  expect(checks).toContainEqual({key:'receiving',state:'unknown',reason:'database_unavailable'});
  expect(checks.some(row=>['senders_required','reply_domain_required'].includes(row.reason))).toBe(false);
 });
 it('keeps a restricted API key distinct from missing domains or webhooks',async()=>{
  h.fetch.mockResolvedValue(json({name:'restricted_api_key',message:'private-provider-error'},401));
  const checks=await checkCommunicationProvider(settings);
  expect(checks).toHaveLength(4);expect(checks.every(row=>row.state==='unknown'&&row.reason==='api_key_restricted')).toBe(true);
  expect(JSON.stringify(checks)).not.toContain('private-provider-error');
 });
 it('does not attempt provider requests without the runtime email key',async()=>{
  vi.stubEnv('RESEND_API_KEY','');const checks=await checkCommunicationProvider(settings);
  expect(h.fetch).not.toHaveBeenCalled();expect(checks.every(row=>row.reason==='api_key_missing')).toBe(true);
 });
 it('checks all three sender addresses and flags the unverified apex domain',async()=>{
  provider({domains:domains.filter(row=>row.name!=='example.test')});
  expect(await checkCommunicationProvider(settings)).toContainEqual({key:'sending',state:'attention',reason:'sending_unverified',domains:['example.test']});
 });
 it('does not infer verified receiving from a verified sending domain',async()=>{
  provider({mxStatus:'pending'});
  const checks=await checkCommunicationProvider(settings);
  expect(checks.find(row=>row.key==='sending')?.state).toBe('pass');
  expect(checks).toContainEqual({key:'receiving',state:'attention',reason:'receiving_unverified'});
 });
 it('reports a reply domain that is unset without reading a real inbox',async()=>{
  const checks=await checkCommunicationProvider({...settings,reply_domain:null});
  expect(checks).toContainEqual({key:'receiving',state:'attention',reason:'reply_domain_required'});
  expect(h.fetch.mock.calls.some(([url])=>new URL(url).pathname.startsWith('/domains/'))).toBe(false);
 });
 it('requires a matching enabled webhook with the complete event subscription',async()=>{
  for(const [override,reason]of [
   [{endpoint:'https://another.example.test/api/events?action=email-receipt'},'webhook_required'],
   [{status:'disabled'},'webhook_disabled'],
   [{events:['email.delivered']},'webhook_events_required'],
  ] as const){provider({hooks:[{...hooks[0],...override}]});expect(await checkCommunicationProvider(settings)).toContainEqual({key:'webhook',state:'attention',reason});}
 });
 it('follows pagination before declaring a sender or webhook missing',async()=>{
  const standard=h.fetch.getMockImplementation()!;
  h.fetch.mockImplementation(async(url:string,init:any)=>{
   const parsed=new URL(url);
   if(['/domains','/webhooks'].includes(parsed.pathname)&&!parsed.searchParams.has('after'))return json({data:[{id:'first-page'}],has_more:true});
   return standard(url,init);
  });
  const checks=await checkCommunicationProvider(settings);
  expect(checks.every(row=>row.state==='pass')).toBe(true);
  expect(h.fetch.mock.calls.filter(([url])=>new URL(url).searchParams.get('after')==='first-page')).toHaveLength(2);
 });
 it('does not present an incomplete provider page set as absent configuration',async()=>{
  h.fetch.mockResolvedValue(json({data:[],has_more:true}));
  const checks=await checkCommunicationProvider(settings);
  expect(checks.filter(row=>['sending','webhook'].includes(row.key)).every(row=>row.state==='unknown'&&row.reason==='provider_unavailable')).toBe(true);
 });
 it('reports network failures without returning provider details',async()=>{
  h.fetch.mockRejectedValue(new Error('private debug payload'));
  const checks=await checkCommunicationProvider(settings);
  expect(checks.every(row=>row.state==='unknown'&&row.reason==='provider_unavailable')).toBe(true);
  expect(JSON.stringify(checks)).not.toContain('private debug payload');
 });
 it('recovers a temporary provider rate limit without sending any mail',async()=>{
  vi.useFakeTimers();const normal=h.fetch.getMockImplementation()!;let limited=false;
  h.fetch.mockImplementation(async(url:string,init:any)=>{
   if(new URL(url).pathname==='/domains'&&!limited){limited=true;return json({name:'rate_limit_exceeded'},429);}
   return normal(url,init);
  });
  const pending=checkCommunicationProvider(settings);await vi.runAllTimersAsync();const checks=await pending;
  expect(checks.every(row=>row.state==='pass')).toBe(true);
  expect(h.fetch.mock.calls.filter(([url])=>new URL(url).pathname==='/domains')).toHaveLength(2);
  expect(h.fetch.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
 });
});
