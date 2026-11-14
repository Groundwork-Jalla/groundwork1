import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHmac } from 'node:crypto';
const h=vi.hoisted(()=>({user:vi.fn(),from:vi.fn(),rpc:vi.fn(),cfg:vi.fn(),receive:vi.fn(),role:true,saves:[] as any[]}));
vi.mock('../../../api/_lib/stripe.js',()=>({requireUser:h.user,getSupabaseAdmin:()=>({from:h.from,rpc:h.rpc})}));
vi.mock('../../../api/_lib/meta-whatsapp.js',async original=>({...await original<typeof import('../../../api/_lib/meta-whatsapp.js')>(),metaWhatsAppConfig:h.cfg}));
vi.mock('../../../api/_lib/whatsapp-communications.js',async original=>({...await original<typeof import('../../../api/_lib/whatsapp-communications.js')>(),receiveMetaEvents:h.receive}));
import { handler as admin } from '../../../api/_handlers/whatsapp-admin';
import { handler as webhook } from '../../../api/_handlers/whatsapp-webhook';

const cfg={enabled:false,mode:'test',phone_number_id:'123456789',business_account_id:'987654321',display_phone:'+15550001111',messaging_account_id:'',test_recipients:['+237699123456'],api_version:'v27.0',token:'saved-access-token-private',appSecret:'saved-app-secret-private',verifyToken:'saved-verify-token-private',webhook_verified_at:null,signed_event_at:null};
function response(){const res:any={code:0,body:null,setHeader:vi.fn()};res.status=(code:number)=>{res.code=code;return res;};res.json=(body:any)=>{res.body=body;return res;};res.send=res.json;res.end=()=>res;return res;}
beforeEach(()=>{
 vi.stubEnv('PUBLIC_SITE_URL','https://tryjalla.com');
 vi.clearAllMocks();h.saves=[];h.role=true;h.user.mockResolvedValue({id:'admin-user'});h.cfg.mockResolvedValue({...cfg});h.receive.mockResolvedValue(1);h.rpc.mockResolvedValue({data:true,error:null});
 h.from.mockImplementation((table:string)=>{
   const q:any={};let saved=false;
   q.select=q.eq=q.neq=q.limit=q.maybeSingle=()=>q;
   q.update=(patch:any)=>{saved=true;h.saves.push({table,patch});return q;};q.upsert=(patch:any)=>{saved=true;h.saves.push({table,patch});return q;};
   q.then=(resolve:any)=>Promise.resolve({data:table==='user_roles'?(h.role?[{role:'admin'}]:[]):null,error:null}).then(resolve);
   return q;
 });
});
afterEach(()=>vi.unstubAllEnvs());
describe('WhatsApp Admin authorization and secret handling',()=>{
 it('rejects unsigned-in and non-admin callers before exposing connection state',async()=>{
   h.user.mockResolvedValueOnce(null);let res=response();await admin({method:'GET'},res);expect(res.code).toBe(401);expect(h.cfg).not.toHaveBeenCalled();
   h.role=false;res=response();await admin({method:'GET'},res);expect(res.code).toBe(403);expect(h.cfg).not.toHaveBeenCalled();
 });
 it('returns only secret presence, with a canonical www callback',async()=>{
   const res=response();await admin({method:'GET'},res);expect(res.code).toBe(200);expect(res.body.credentials).toEqual({token:true,appSecret:true,verifyToken:true});
   const serialized=JSON.stringify(res.body);for(const value of [cfg.token,cfg.appSecret,cfg.verifyToken])expect(serialized).not.toContain(value);
   expect(res.body.callbackUrl).toBe('https://www.tryjalla.com/api/whatsapp-webhook');
 });
 it('cannot enable sending before both verification checks succeed',async()=>{
   const res=response();await admin({method:'POST',body:{operation:'save',enabled:true}},res);
   expect(res.code).toBe(400);expect(res.body.error).toBe('verify_webhook_before_enabling');expect(h.saves).toHaveLength(0);
 });
 it('refuses endpoint injection and unsupported operations',async()=>{
   let res=response();await admin({method:'POST',body:{operation:'save',phone_number_id:'123/messages?access_token=x'}},res);expect(res.code).toBe(400);expect(h.saves).toHaveLength(0);
   res=response();await admin({method:'POST',body:{operation:'send_arbitrary_payload',payload:{to:'other'}}},res);expect(res.body.error).toBe('unknown_operation');expect(h.rpc).not.toHaveBeenCalled();
 });
 it('invalidates old account approvals and sending when the business identity changes',async()=>{
   const res=response();await admin({method:'POST',body:{operation:'save',business_account_id:'999999999'}},res);
   expect(res.code).toBe(200);
   expect(h.saves).toContainEqual({table:'communication_whatsapp_templates',patch:{status:'NEEDS_CHECK'}});
   expect(h.saves).toContainEqual(expect.objectContaining({table:'communication_whatsapp_settings',patch:expect.objectContaining({enabled:false,webhook_verified_at:null,signed_event_at:null,template_checked_at:null})}));
 });
});
describe('public Meta webhook boundary',()=>{
 it('echoes the verified challenge as text and rejects a wrong verify token',async()=>{
   let res=response();await webhook({method:'GET',query:{'hub.mode':'subscribe','hub.verify_token':cfg.verifyToken,'hub.challenge':'12345'}},res);
   expect(res.code).toBe(200);expect(res.body).toBe('12345');expect(h.saves[0].patch.webhook_verified_at).toBeTruthy();
   res=response();await webhook({method:'GET',query:{'hub.mode':'subscribe','hub.verify_token':'wrong','hub.challenge':'12345'}},res);expect(res.code).toBe(403);
 });
 it('never processes an unsigned or modified POST',async()=>{
   const raw=Buffer.from('{"object":"whatsapp_business_account"}');const res=response();
   await webhook({method:'POST',rawBody:raw,body:JSON.parse(raw.toString()),headers:{}},res);expect(res.code).toBe(401);expect(h.receive).not.toHaveBeenCalled();
 });
 it('accepts a valid signature while sending is disabled; retries storage failures with 503',async()=>{
   const raw=Buffer.from('{"object":"whatsapp_business_account"}');const req={method:'POST',rawBody:raw,body:JSON.parse(raw.toString()),headers:{'x-hub-signature-256':`sha256=${createHmac('sha256',cfg.appSecret).update(raw).digest('hex')}`}};
   let res=response();await webhook(req,res);expect(res.code).toBe(200);expect(h.receive).toHaveBeenCalledOnce();
   h.receive.mockRejectedValueOnce(new Error('temporary storage error'));res=response();await webhook(req,res);expect(res.code).toBe(503);expect(res.body.error).not.toContain('storage error');
 });
});
