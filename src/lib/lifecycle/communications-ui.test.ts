import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({state:[] as any[],refs:[] as any[],memos:[] as any[],deps:[] as any[],cleanups:[] as any[],effects:[] as {index:number;effect:()=>any}[],si:0,ri:0,mi:0,ei:0,
 token:'00000000-0000-0000-0000-000000000001',t:(key:string)=>key,read:vi.fn(),save:vi.fn(),queue:vi.fn(),readiness:vi.fn(),rpc:vi.fn(),staff:vi.fn(),tables:{} as Record<string,any[]>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:any)=>{const i=h.si++;if(!(i in h.state))h.state[i]=typeof initial==='function'?initial():initial;return[h.state[i],(next:any)=>{h.state[i]=typeof next==='function'?next(h.state[i]):next;}];},
 useRef:(initial:any)=>h.refs[h.ri++]??(h.refs[h.ri-1]={current:initial}),
 useCallback:(callback:any,deps:any[])=>{const i=h.mi++;if(!h.memos[i]||deps.some((v,k)=>!Object.is(v,h.memos[i].deps[k])))h.memos[i]={callback,deps};return h.memos[i].callback;},
 useEffect:(effect:()=>any,deps:any[])=>{const i=h.ei++;if(!h.deps[i]||deps.some((v,k)=>!Object.is(v,h.deps[i][k]))){h.deps[i]=deps;h.effects.push({index:i,effect});}},
}));
vi.mock('@/lib/i18n',()=>({useT:()=>h.t,useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/i18n/translate',()=>({translator:()=>h.t}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'admin'}})}));
vi.mock('react-router',()=>({useParams:()=>({token:h.token}),Link:'link'}));
vi.mock('@/lib/supabase/communications',()=>({readPreference:h.read,savePreference:h.save,queueCommunicationReply:h.queue,readCommunicationReadiness:h.readiness}));
vi.mock('@/lib/supabase/admin-users',()=>({listAdminUsers:h.staff}));
vi.mock('@/lib/supabase/client',()=>({supabase:{rpc:h.rpc,from:(table:string)=>{
 const filters:((row:any)=>boolean)[]=[];const result=()=>({data:(h.tables[table]??[]).filter(row=>filters.every(test=>test(row))),error:null});
 const q:any={select:()=>q,eq:(key:string,value:any)=>{filters.push(row=>row[key]===value);return q;},is:(key:string,value:any)=>{filters.push(row=>row[key]===value);return q;},order:()=>q,limit:()=>q,
  single:async()=>({...result(),data:result().data[0]}),then:(resolve:any)=>Promise.resolve(result()).then(resolve)};return q;
}}}));
import Preferences from '@/app/routes/communication-preferences';
import { CommunicationInbox } from '@/components/admin/communications/CommunicationInbox';
import { CommunicationSettings } from '@/components/admin/communications/CommunicationSettings';
import { CommunicationReadiness } from '@/components/admin/communications/CommunicationReadiness';
function render<T>(component:()=>T):T {h.si=h.ri=h.mi=h.ei=0;const tree=component();for(const {index,effect}of h.effects.splice(0)){h.cleanups[index]?.();h.cleanups[index]=effect();}return tree;}
function nodes(value:any):any[]{return Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children)]:[];}
function text(value:any):string{return Array.isArray(value)?value.map(text).join(' '):typeof value==='string'?value:value?.props?text(value.props.children):'';}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const token='00000000-0000-0000-0000-000000000001';
const preference={lang:'en',activation_unsubscribed:false,project_creation_paused:false};
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();h.state=[];h.refs=[];h.memos=[];h.deps=[];h.cleanups=[];h.effects=[];h.token=token;
 h.tables={communication_settings:[{id:true,delivery_enabled:false,sender_name:'Groundwork',sender_email:'hello@example.test',followup_sender_email:'contact@example.test',application_sender_email:'partner@example.test',reply_domain:'reply.example.test',test_recipients:[],default_owner_id:null,next_contact_hours:48,updated_at:'2026-11-13T12:00:00Z'}],communication_runs:[],communication_issues:[],communication_threads:[{id:'thread',email:'client@example.test',automation_paused:true,last_message_at:'2026-11-13T12:00:00Z',lifecycle_enrollments:{full_name:'Client',context:{}}}],communication_messages:[]};
 h.staff.mockResolvedValue([{id:'admin',email:'staff@example.test',roles:'admin'}]);h.read.mockResolvedValue(preference);h.save.mockResolvedValue({...preference,project_creation_paused:true});h.queue.mockResolvedValue('message');
 h.rpc.mockImplementation(async(name,args)=>({data:name==='admin_save_communication_settings'?{...args.p_settings,updated_at:'2026-11-13T13:00:00Z'}:null,error:null}));
});
describe('email setup checks',()=>{
 it('runs only on request and shows a restricted key as incomplete without changing delivery settings',async()=>{
  h.readiness.mockResolvedValue({checkedAt:'2026-11-13T12:00:00Z',checks:[{key:'sending',state:'unknown',reason:'api_key_restricted'}]});
  const component=()=>CommunicationReadiness({settingsVersion:'saved-one'});
  render(component);await flush();expect(h.readiness).not.toHaveBeenCalled();
  const click=nodes(render(component)).find(node=>node.type==='button').props.onClick;click();click();await flush();
  const view=render(component);expect(h.readiness).toHaveBeenCalledOnce();expect(text(view)).toContain('communications.setup.reasons.api_key_restricted');
  expect(text(view)).toContain('communications.setup.states.unknown');expect(h.rpc).not.toHaveBeenCalled();
 });
 it('discards a delayed result after the saved settings change',async()=>{
  let finish!:(result:any)=>void;h.readiness.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  let version='one';const component=()=>CommunicationReadiness({settingsVersion:version});
  render(component);nodes(render(component)).find(node=>node.type==='button').props.onClick();
  version='two';render(component);finish({checkedAt:'2026-11-13T12:00:00Z',checks:[{key:'sending',state:'pass',reason:'sending_verified'}]});await flush();
  expect(text(render(component))).not.toContain('communications.setup.reasons.sending_verified');
 });
 it('keeps a failed check visible and permits a retry',async()=>{
  h.readiness.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({checkedAt:'2026-11-13T12:00:00Z',checks:[]});
  const component=()=>CommunicationReadiness({settingsVersion:'one'});render(component);
  nodes(render(component)).find(node=>node.type==='button').props.onClick();await flush();
  let view=render(component);expect(text(view)).toContain('communications.setup.failed');
  nodes(view).find(node=>node.type==='button').props.onClick();await flush();view=render(component);
  expect(text(view)).not.toContain('communications.setup.failed');expect(h.readiness).toHaveBeenCalledTimes(2);
 });
});
afterEach(()=>{h.cleanups.forEach(cleanup=>cleanup?.());vi.clearAllTimers();vi.useRealTimers();});
describe('recipient preference confirmation',()=>{
 it('reads a link without saving a preference, then saves only the recipient’s explicit choice',async()=>{
  render(Preferences);await flush();const view=render(Preferences);expect(h.save).not.toHaveBeenCalled();expect(h.read).toHaveBeenCalledWith(token);
  nodes(view).find(node=>node.type==='button'&&text(node)==='communications.pauseProject').props.onClick();await flush();
  expect(h.save).toHaveBeenCalledWith(token,'pause_project');expect(text(render(Preferences))).toContain('communications.preferenceSaved');
 });
 it('does not apply a previous link’s delayed save result to the next recipient',async()=>{
  let finish!:(value:any)=>void;h.save.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(Preferences);await flush();nodes(render(Preferences)).find(node=>node.type==='button').props.onClick();
  h.token='00000000-0000-0000-0000-000000000002';render(Preferences);await flush();
  finish({...preference,project_creation_paused:true});await flush();expect(text(render(Preferences))).toContain('communications.remindersAllowed');
 });
 it('shows an unavailable link without presenting a successful unsubscribe',async()=>{
  h.read.mockRejectedValue(new Error('unavailable'));render(Preferences);await flush();const view=render(Preferences);
  expect(text(view)).toContain('communications.unavailable');expect(nodes(view).filter(node=>node.type==='button')).toHaveLength(0);expect(h.save).not.toHaveBeenCalled();
 });
});
describe('admin communication controls',()=>{
 it('loads settings with delivery off and saves the expected version only after a submit',async()=>{
  render(CommunicationSettings);await flush();let view=render(CommunicationSettings);expect(h.rpc).not.toHaveBeenCalled();
  expect(nodes(view).find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked).toBe(false);
  nodes(view).find(node=>node.type==='textarea').props.onChange({target:{value:'tester@example.test'}});view=render(CommunicationSettings);
  nodes(view).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();
  expect(h.rpc).toHaveBeenCalledWith('admin_save_communication_settings',expect.objectContaining({p_expected_at:'2026-11-13T12:00:00Z',p_settings:expect.objectContaining({test_recipients:['tester@example.test'],delivery_enabled:false})}));
 });
 it('shows a stale settings refusal without claiming the save succeeded',async()=>{
  render(CommunicationSettings);await flush();h.rpc.mockResolvedValue({error:{message:'stale_settings'}});
  nodes(render(CommunicationSettings)).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();
  expect(text(render(CommunicationSettings))).toContain('communications.staleSettings');
 });
});
async function openInbox(){render(CommunicationInbox);await flush();const view=render(CommunicationInbox);nodes(view).find(node=>node.type==='button'&&node.props['aria-pressed']===false).props.onClick();render(CommunicationInbox);await flush();return render(CommunicationInbox);}
describe('staff conversation replies',()=>{
 it('shows paused automation and queues a reply once to the selected saved thread',async()=>{
  let view=await openInbox();expect(text(view)).toContain('communications.automationPaused');
  nodes(view).find(node=>node.type==='textarea').props.onChange({target:{value:'Here is the next step.'}});view=render(CommunicationInbox);
  const submit=nodes(view).find(node=>node.type==='form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await flush();
  expect(h.queue).toHaveBeenCalledOnce();expect(h.queue.mock.calls[0].slice(0,2)).toEqual(['thread','Here is the next step.']);
  expect(text(render(CommunicationInbox))).toContain('communications.replyQueued');
 });
 it('retains a failed reply and its idempotency reference for retry',async()=>{
  let view=await openInbox();nodes(view).find(node=>node.type==='textarea').props.onChange({target:{value:'Please continue.'}});
  h.queue.mockRejectedValueOnce(new Error('connection interrupted'));view=render(CommunicationInbox);nodes(view).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();
  view=render(CommunicationInbox);expect(nodes(view).find(node=>node.type==='textarea').props.value).toBe('Please continue.');
  nodes(view).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();expect(h.queue.mock.calls[1]).toEqual(h.queue.mock.calls[0]);
 });
 it('renders untrusted incoming content as text without HTML injection',async()=>{
  h.tables.communication_messages=[{id:'message',thread_id:'thread',direction:'inbound',body:'<script>unsafe()</script>',subject:'Help',status:'received',authenticated:false,attachment_count:0,created_at:'2026-11-13T12:00:00Z'}];
  const view=await openInbox();expect(text(view)).toContain('<script>unsafe()</script>');expect(text(view)).toContain('communications.unverified');
  expect(nodes(view).some(node=>node.props.dangerouslySetInnerHTML)).toBe(false);
 });
});
