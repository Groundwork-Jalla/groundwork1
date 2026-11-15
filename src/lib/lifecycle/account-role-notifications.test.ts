import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { composeAccountRoleNotification,sendAccountRoleNotifications } from '../../../api/_lib/account-role-notifications';
const id='00000000-0000-0000-0000-000000000001';const worker='00000000-0000-0000-0000-000000000002';
const input={email:'person@example.test',role:'contractor' as const,fullName:'Person',senderName:'Groundwork',senderEmail:'noreply@mail.tryjalla.com',replyEmail:'contact@tryjalla.com'};
const settings={delivery_enabled:false,sender_name:input.senderName,sender_email:input.senderEmail,followup_sender_email:input.replyEmail};
beforeEach(()=>{vi.stubEnv('PUBLIC_SITE_URL','https://www.tryjalla.com');vi.stubEnv('RESEND_API_KEY','test-key');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('role-change email content and destinations',()=>{
 it('explains the correction neutrally and links to contractor onboarding',()=>{
  const email=composeAccountRoleNotification(input);
  expect(email.text).toContain('updated to a contractor account');expect(email.text).toContain('Complete contractor onboarding: https://www.tryjalla.com/work/onboarding');
  expect(email.text).not.toMatch(/mistake|wrong|failed/i);expect(email.reply_to).toBe('contact@tryjalla.com');expect(email.headers).not.toHaveProperty('List-Unsubscribe');
 });
 it('returns an unfinished contractor to their existing work project after setup',()=>{
  const email=composeAccountRoleNotification({...input,onboarding:{complete:false,existing_project_count:1,existing_project_path:'/work/projects/build'}});
  expect(email.text).toContain('/work/onboarding?redirect=%2Fwork%2Fprojects%2Fbuild');expect(email.text).not.toContain('/projects/new');
 });
 it('opens a completed contractor’s existing project without repeating the form',()=>{
  const email=composeAccountRoleNotification({...input,onboarding:{complete:true,client_intent:'existing_project',existing_project_count:1,existing_project_path:'/work/projects/build'}});
  expect(email.text).toContain('https://www.tryjalla.com/work/projects/build');expect(email.text).not.toContain('Complete contractor onboarding');
 });
 it.each([['client','/dashboard'],['verifier','/verifiers'],['admin','/admin']] as const)('routes the corrected %s account to its own dashboard', (role,path)=>{
  expect(composeAccountRoleNotification({...input,role}).text).toContain(`https://www.tryjalla.com${path}`);
 });
 it('uses the saved French preference and escapes a name in HTML',()=>{
  const email=composeAccountRoleNotification({...input,lang:'fr',fullName:'<img src=x onerror=alert(1)>'});
  expect(email.subject).toContain('mis à jour');expect(email.text).toContain('Terminer mon inscription');expect(email.html).toContain('&lt;img');expect(email.html).not.toContain('<img');
 });
 it('uses the canonical public host and refuses an injected project URL',()=>{
  vi.stubEnv('PUBLIC_SITE_URL','https://tryjalla.com');
  const email=composeAccountRoleNotification({...input,onboarding:{complete:true,client_intent:'existing_project',existing_project_path:'//outside.test'}});
  expect(email.text).toContain('https://www.tryjalla.com/work');expect(email.text).not.toContain('outside.test');
 });
 it.each([{email:'other@test.example\r\nBcc: bad@test.example'},{senderEmail:''},{replyEmail:'not-an-email'}])('rejects invalid mail configuration %j',patch=>{
  expect(()=>composeAccountRoleNotification({...input,...patch})).toThrow('account_notification_configuration_required');
 });
});
function service(patch:Record<string,any>={}) {
 const notice={id,worker_token:worker,email:input.email,to_role:'contractor',lang:'en',full_name:'Person',payload:null,onboarding:{complete:false},...patch};
 const rpc=vi.fn(async(name:string,args:any)=>({data:name==='claim_account_role_notification'?notice:name==='prepare_account_role_notification'?args.p_payload:null,error:null}));
 const from=vi.fn((table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,lte:()=>q,order:()=>q,limit:async()=>({data:[{id}],error:null}),single:async()=>({data:settings,error:null})};return q;});
 return {rpc,from};
}
describe('durable account mail delivery',()=>{
 it('sends transactional notices while activation reminders are paused, using the frozen payload and stable key',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{"id":"provider-id"}'));vi.stubGlobal('fetch',fetch);const svc=service();
  expect(await sendAccountRoleNotifications(svc)).toEqual({sent:1,failed:0,skipped:0});
  expect(fetch).toHaveBeenCalledOnce();const request=fetch.mock.calls[0][1];expect(request.headers['Idempotency-Key']).toBe(`account-role/${id}`);
  expect(JSON.parse(request.body).to).toBe(input.email);expect(svc.rpc).toHaveBeenLastCalledWith('finish_account_role_notification',expect.objectContaining({p_id:id,p_worker:worker,p_provider:'provider-id',p_error:null}));
 });
 it('uses the saved retry payload even when the sender settings or profile changed',async()=>{
  const original=composeAccountRoleNotification({...input,fullName:'Original'});const svc=service({payload:original,full_name:'Changed'});
  const fetch=vi.fn().mockResolvedValue(new Response('{"id":"same-provider-id"}'));vi.stubGlobal('fetch',fetch);
  await sendAccountRoleNotifications(svc);expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(original);
 });
 it('does not send if a concurrent worker or a newer role prevents a claim',async()=>{
  const svc=service();svc.rpc.mockResolvedValue({data:null,error:null});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await sendAccountRoleNotifications(svc)).toEqual({sent:0,failed:0,skipped:1});expect(fetch).not.toHaveBeenCalled();
 });
 it('records a provider failure for a later retry without pretending the role change failed',async()=>{
  const svc=service();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private details',{status:429})));
  expect(await sendAccountRoleNotifications(svc)).toEqual({sent:0,failed:1,skipped:0});
  expect(svc.rpc).toHaveBeenLastCalledWith('finish_account_role_notification',expect.objectContaining({p_provider:null,p_error:'resend_429'}));
 });
 it('keeps an unconfigured provider retryable without starting a frozen delivery attempt',async()=>{
  vi.stubEnv('RESEND_API_KEY','');const svc=service();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await sendAccountRoleNotifications(svc)).toEqual({sent:0,failed:1,skipped:0});
  expect(svc.rpc.mock.calls.some(call=>call[0]==='prepare_account_role_notification')).toBe(false);expect(fetch).not.toHaveBeenCalled();
  expect(svc.rpc).toHaveBeenLastCalledWith('finish_account_role_notification',expect.objectContaining({p_error:'email_provider_not_configured'}));
 });
 it('holds mail on old deployments without interrupting the existing reminder worker',async()=>{
  const svc={rpc:vi.fn(),from:()=>{const q:any={select:()=>q,in:()=>q,lte:()=>q,order:()=>q,limit:async()=>({data:null,error:{code:'42P01'}})};return q;}};
  expect(await sendAccountRoleNotifications(svc)).toMatchObject({migrationRequired:true,sent:0});expect(svc.rpc).not.toHaveBeenCalled();
 });
});
