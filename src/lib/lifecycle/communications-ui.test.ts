import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({state:[] as any[],refs:[] as any[],memos:[] as any[],deps:[] as any[],cleanups:[] as any[],effects:[] as {index:number;effect:()=>any}[],si:0,ri:0,mi:0,ei:0,
 token:'00000000-0000-0000-0000-000000000001',t:(key:string)=>key,read:vi.fn(),save:vi.fn(),queue:vi.fn(),readiness:vi.fn(),rpc:vi.fn(),staff:vi.fn(),update:vi.fn(),selectRead:vi.fn(),tables:{} as Record<string,any[]>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:any)=>{const i=h.si++;if(!(i in h.state))h.state[i]=typeof initial==='function'?initial():initial;return[h.state[i],(next:any)=>{h.state[i]=typeof next==='function'?next(h.state[i]):next;}];},
 useRef:(initial:any)=>h.refs[h.ri++]??(h.refs[h.ri-1]={current:initial}),
 useCallback:(callback:any,deps:any[])=>{const i=h.mi++;if(!h.memos[i]||deps.some((v,k)=>!Object.is(v,h.memos[i].deps[k])))h.memos[i]={callback,deps};return h.memos[i].callback;},
 useEffect:(effect:()=>any,deps:any[])=>{const i=h.ei++;if(!h.deps[i]||deps.some((v,k)=>!Object.is(v,h.deps[i][k]))){h.deps[i]=deps;h.effects.push({index:i,effect});}},
}));
vi.mock('@/lib/i18n',()=>({useT:()=>h.t,useLanguage:()=>({lang:'en'})}));
vi.mock('@/lib/i18n/translate',()=>({translator:()=>h.t}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'admin'}})}));
vi.mock('react-router',()=>({useParams:()=>({token:h.token}),useSearchParams:()=>[new URLSearchParams()],Link:'link'}));
vi.mock('@/lib/supabase/communications',()=>({readPreference:h.read,savePreference:h.save,queueCommunicationReply:h.queue,readCommunicationReadiness:h.readiness}));
vi.mock('@/lib/supabase/admin-users',()=>({listAdminUsers:h.staff}));
vi.mock('@/lib/supabase/client',()=>({supabase:{rpc:h.rpc,from:(table:string)=>{
 let patch:any=null;
 const filters:((row:any)=>boolean)[]=[];const result=()=>({data:(h.tables[table]??[]).filter(row=>filters.every(test=>test(row))),error:null});
 const settle=async(single=false)=>{const response=patch?await h.update(table,patch,result().data):await h.selectRead(table,result());return single?{...response,data:response.data?.[0]??null}:response;};
 const q:any={select:()=>q,eq:(key:string,value:any)=>{filters.push(row=>row[key]===value);return q;},is:(key:string,value:any)=>{filters.push(row=>row[key]===value);return q;},order:()=>q,limit:()=>q,
  update:(value:any)=>{patch=value;return q;},single:()=>settle(true),maybeSingle:()=>settle(true),then:(resolve:any)=>settle().then(resolve)};return q;
}}}));
import Preferences from '@/app/routes/communication-preferences';
import { CommunicationInbox } from '@/components/admin/communications/CommunicationInbox';
import { CommunicationSettings } from '@/components/admin/communications/CommunicationSettings';
import { CommunicationReadiness } from '@/components/admin/communications/CommunicationReadiness';
import { CommunicationJourneys } from '@/components/admin/communications/CommunicationJourneys';
import { CommunicationTracking } from '@/components/admin/communications/CommunicationTracking';
import { CommunicationContactHistory } from '@/components/admin/communications/CommunicationContactHistory';
import { ProjectDuplicateFlag } from '@/components/admin/communications/ProjectDuplicateFlag';
import { COMMUNICATION_RATIOS,type CommunicationTrackingReport } from '@/lib/supabase/communication-tracking';
import AdminSequences from '@/app/routes/admin/sequences';
import { ACTIVATION_JOURNEYS,type JourneySequence,type JourneyStep } from '@/lib/lifecycle/journeys';
function render<T>(component:()=>T):T {h.si=h.ri=h.mi=h.ei=0;const tree=component();for(const {index,effect}of h.effects.splice(0)){h.cleanups[index]?.();h.cleanups[index]=effect();}return tree;}
function nodes(value:any):any[]{return Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children)]:[];}
function text(value:any):string{return Array.isArray(value)?value.map(text).join(' '):typeof value==='string'?value:value?.props?text(value.props.children):'';}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const token='00000000-0000-0000-0000-000000000001';
const preference={lang:'en',activation_unsubscribed:false,project_creation_paused:false};
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();h.state=[];h.refs=[];h.memos=[];h.deps=[];h.cleanups=[];h.effects=[];h.token=token;
 h.t=(key:string)=>key;
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal('document',{visibilityState:'visible'});
 h.tables={communication_settings:[{id:true,delivery_enabled:false,sender_name:'Groundwork',sender_email:'hello@example.test',followup_sender_email:'contact@example.test',application_sender_email:'partner@example.test',reply_domain:'reply.example.test',test_recipients:[],default_owner_id:null,next_contact_hours:48,updated_at:'2026-11-13T12:00:00Z'}],communication_runs:[],communication_issues:[],communication_threads:[{id:'thread',email:'client@example.test',automation_paused:true,last_message_at:'2026-11-13T12:00:00Z',lifecycle_enrollments:{full_name:'Client',context:{}}}],communication_messages:[]};
 h.staff.mockResolvedValue([{id:'admin',email:'staff@example.test',roles:'admin'}]);h.read.mockResolvedValue(preference);h.save.mockResolvedValue({...preference,project_creation_paused:true});h.queue.mockResolvedValue('message');
 h.rpc.mockImplementation(async(name,args)=>({data:name==='admin_save_communication_settings'?{...args.p_settings,updated_at:'2026-11-13T13:00:00Z'}:null,error:null}));
 h.update.mockImplementation(async(table,patch,rows)=>{const data=rows.map((row:any)=>({...row,...patch}));h.tables[table]=h.tables[table].map(row=>data.find((saved:any)=>saved.id===row.id)??row);return {data,error:null};});
 h.selectRead.mockImplementation((_table,result)=>result);
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
afterEach(()=>{h.cleanups.forEach(cleanup=>cleanup?.());vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
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

const exampleSequence=(key='cs_signup'):JourneySequence=>({key,name:key,journey:'Contractor self-signup',audience:'contractor',enabled:false,awaiting_action:'Complete onboarding',followup_after_days:7});
const exampleStep=(key='cs_signup'):JourneyStep=>({id:`${key}-message`,sequence_key:key,position:1,delay_hours:0,channel:'email',code:'CS01',subject_en:'Welcome {{first_name}}',subject_fr:'Bienvenue {{first_name}}',body_en:'Open {{project_name}} with {{client_name}}.',body_fr:'Ouvrez {{project_name}} avec {{client_name}}.',cta_key:'onboarding',cta_label_en:'Complete onboarding',cta_label_fr:'Terminer l’inscription'});
describe('activation journey review',()=>{
 it('shows the four journeys and distinguishes invited onboarding branches without enabling delivery',()=>{
  const sequences=ACTIVATION_JOURNEYS.flatMap(journey=>journey.sequences.map(key=>({...exampleSequence(key),journey:journey.name,audience:journey.id.startsWith('contractor')?'contractor':'client'})));
  const edit=vi.fn();const view=render(()=>CommunicationJourneys({sequences,steps:sequences.map(sequence=>exampleStep(sequence.key)),onEdit:edit}));
  for(const journey of ACTIVATION_JOURNEYS)expect(text(view)).toContain(`communications.journeys.titles.${journey.id}`);
  expect(text(view)).toContain('communications.journeys.branches.alreadyOnboarded');
  expect(text(view)).toContain('communications.journeys.branches.afterOnboarding');
  expect(h.rpc).not.toHaveBeenCalled();expect(h.update).not.toHaveBeenCalled();
  nodes(view).filter(node=>node.type==='button'&&text(node)==='communications.journeys.edit')[0].props.onClick();expect(edit).toHaveBeenCalledWith('contractorSignup');
 });
 it('previews the actual English/French wording and contractor destination using example details',()=>{
  const component=()=>CommunicationJourneys({sequences:[exampleSequence()],steps:[exampleStep()],onEdit:vi.fn()});
  const view=render(component);nodes(view).find(node=>node.type==='button'&&text(node).startsWith('CS01')).props.onClick();
  let preview=render(component);expect(text(preview)).toContain('Welcome Alex');expect(text(preview)).toContain('Open Example project with Sam Obi.');
  expect(text(preview)).toContain('/work/onboarding');expect(text(preview)).toContain('communications.journeys.exampleOnly');
  nodes(preview).find(node=>node.type==='select').props.onChange({target:{value:'fr'}});preview=render(component);
  expect(text(preview)).toContain('Bienvenue Alex');expect(text(preview)).toContain('Ouvrez Projet exemple avec Sam Obi.');
  expect(nodes(preview).some(node=>node.type==='a')).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('shows days from stage entry and uses the existing client invitation route',()=>{
  h.t=(key:string,vars?:any)=>key+(vars&&key==='communications.journeys.day'?` ${vars.count}`:'');
  const steps=[0,24,48,96].map((delay,index)=>({...exampleStep('iv_invited'),id:`m${index}`,position:index+1,delay_hours:delay,code:`IV0${index+1}`,cta_key:'invitation'}));
  const component=()=>CommunicationJourneys({sequences:[{...exampleSequence('iv_invited'),journey:'Client invited by a contractor',audience:'client'}],steps:[steps[3],steps[1],steps[0],steps[2]],onEdit:vi.fn()});
  let view=render(component);const labels=nodes(view).filter(node=>node.type==='button').map(node=>text(node).replace(/\s+/g,' '));
  expect(labels).toEqual(expect.arrayContaining(['IV01 · communications.journeys.immediate','IV02 · communications.journeys.day 1','IV03 · communications.journeys.day 3','IV04 · communications.journeys.day 7']));
  nodes(view).find(node=>node.type==='button'&&text(node).startsWith('IV01')).props.onClick();view=render(component);
  expect(text(view)).toContain('/share/example-invitation');expect(text(view)).not.toContain('/projects/new');
 });
});

async function openSequenceEditor() {
 h.tables.lifecycle_sequences=[{...exampleSequence(),description:'Onboarding reminders',trigger_event:'user_signup',exit_events:['contractor_onboarding_completed']}];
 h.tables.lifecycle_sequence_steps=[exampleStep()];
 render(AdminSequences);await flush();let view=render(AdminSequences);
 nodes(view).find(node=>node.type==='button'&&text(node)==='Sequences').props.onClick();return render(AdminSequences);
}
const editorBody=(view:any)=>nodes(view).find(node=>node.type==='textarea'&&node.props.placeholder==='Message (EN)');
const saveMessage=(view:any)=>nodes(view).find(node=>node.type==='button'&&text(node)==='communications.journeys.saveStep');
describe('message drafts during background refresh',()=>{
 it('preserves unsaved wording during the 30-second refresh and saves only the edited field',async()=>{
  let view=await openSequenceEditor();editorBody(view).props.onChange({target:{value:'My reviewed draft'}});view=render(AdminSequences);
  h.tables.lifecycle_sequence_steps[0]={...h.tables.lifecycle_sequence_steps[0],body_en:'Older server copy',subject_en:'Another admin’s subject'};
  await vi.advanceTimersByTimeAsync(30_000);await flush();view=render(AdminSequences);
  expect(editorBody(view).props.value).toBe('My reviewed draft');expect(text(view)).toContain('communications.journeys.unsaved');
  saveMessage(view).props.onClick();await flush();view=render(AdminSequences);
  expect(h.update).toHaveBeenCalledWith('lifecycle_sequence_steps',{body_en:'My reviewed draft'},expect.any(Array));
  expect(h.tables.lifecycle_sequence_steps[0].subject_en).toBe('Another admin’s subject');
  expect(text(view)).toContain('communications.journeys.stepSaved');expect(text(view)).not.toContain('communications.journeys.unsaved');
 });
 it('retains a failed save as a draft and allows a successful retry',async()=>{
  let view=await openSequenceEditor();editorBody(view).props.onChange({target:{value:'Keep this draft'}});view=render(AdminSequences);
  h.update.mockResolvedValueOnce({data:null,error:{message:'offline'}});saveMessage(view).props.onClick();await flush();view=render(AdminSequences);
  expect(editorBody(view).props.value).toBe('Keep this draft');expect(text(view)).toContain('communications.journeys.saveFailed');expect(saveMessage(view).props.disabled).toBe(false);
  saveMessage(view).props.onClick();await flush();expect(text(render(AdminSequences))).toContain('communications.journeys.stepSaved');
 });
 it('keeps edits typed while the previous save is in flight and refuses duplicate saves',async()=>{
  let finish!:(result:any)=>void;let view=await openSequenceEditor();editorBody(view).props.onChange({target:{value:'Submitted copy'}});view=render(AdminSequences);
  h.update.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const save=saveMessage(view).props.onClick;save();save();await flush();
  view=render(AdminSequences);editorBody(view).props.onChange({target:{value:'Newer copy'}});
  finish({data:[{...exampleStep(),body_en:'Submitted copy'}],error:null});await flush();view=render(AdminSequences);
  expect(h.update).toHaveBeenCalledOnce();expect(editorBody(view).props.value).toBe('Newer copy');expect(text(view)).toContain('communications.journeys.unsaved');expect(text(view)).toContain('communications.journeys.newerEdits');
 });
 it('does not restore old text when a background read finishes after a successful save',async()=>{
  let finish!:(result:any)=>void;let held=false;let view=await openSequenceEditor();
  h.selectRead.mockImplementation((table,result)=>table==='lifecycle_sequence_steps'&&!held?(held=true,new Promise(resolve=>{finish=resolve;})):result);
  await vi.advanceTimersByTimeAsync(30_000);await flush();view=render(AdminSequences);editorBody(view).props.onChange({target:{value:'Saved newer copy'}});view=render(AdminSequences);
  saveMessage(view).props.onClick();await flush();finish({data:[exampleStep()],error:null});await flush();
  expect(editorBody(render(AdminSequences)).props.value).toBe('Saved newer copy');
 });
});

function trackingReport(changes:Partial<CommunicationTrackingReport>={}):CommunicationTrackingReport {
 return {from:'2026-10-15T00:00:00Z',until:'2026-11-15T00:00:00Z',asOf:'2026-11-14T12:00:00Z',offset:0,limit:50,total:0,rows:[],projects:[],recovery:[],
  metrics:{...Object.fromEntries(COMMUNICATION_RATIOS.map(key=>[key,{completed:0,total:0,percent:null}])),medianConnectionHours:null,knownConnectionTimes:0,historicalUnknownConnectionTimes:3,invitationsWithoutDeliveryProof:2,knownSignupEvents:0,unclassifiedSignupEvents:1} as CommunicationTrackingReport['metrics'],...changes};
}
const trackingPerson:CommunicationTrackingReport['rows'][number]={id:'enrollment',email:'returning@example.test',phone:'+123456789',name:'Returning builder',role:'contractor',journey:'Contractor self-signup',sequenceKey:'cs_client_pending',action:'Client accepts invitation',state:'awaiting_action',enteredAt:'2026-11-01T12:00:00Z',completedAt:null,projectId:'project',projectName:'Home',entrySource:'independent_signup',accountId:'account',threadId:'thread',nextEmailAt:null,nextEmailCode:null,lastEmail:{code:'CS14',subject:'Invitation reminder',sentAt:'2026-11-07T12:00:00Z',status:'delivered'},followup:{id:'followup',kind:'activation',status:'open',ownerId:'admin',ownerName:'Staff member',dueAt:'2026-11-15T12:00:00Z',contactStatus:'contacted',attempts:1,lastContactedAt:'2026-11-13T12:00:00Z'}};
describe('activation measurement and people tracking',()=>{
 it('shows missing denominators and historical timing as unknown without sending or changing settings',async()=>{
  h.rpc.mockResolvedValue({data:trackingReport(),error:null});const component=()=>CommunicationTracking({onConversation:vi.fn()});
  render(component);await vi.advanceTimersByTimeAsync(200);await flush();const view=render(component);
  expect(text(view)).toContain('communications.tracking.timeCoverage');expect(text(view)).toContain('communications.tracking.coverage');
  expect(nodes(view).filter(node=>node.type==='article').every(node=>text(node).includes('—'))).toBe(true);
  expect(text(view)).not.toContain('0%');expect(text(view)).toContain('communications.tracking.noPeople');
  expect(h.rpc).toHaveBeenCalledOnce();expect(h.rpc.mock.calls[0][0]).toBe('admin_communication_tracking');expect(h.update).not.toHaveBeenCalled();expect(h.queue).not.toHaveBeenCalled();
 });
 it('keeps exhausted stages visible, opens the saved conversation and resets paging when a person filter changes',async()=>{
  h.rpc.mockImplementation(async(_name,args)=>({data:trackingReport({rows:[trackingPerson],total:51,offset:args.p_offset}),error:null}));const conversation=vi.fn();const component=()=>CommunicationTracking({onConversation:conversation});
  render(component);await vi.advanceTimersByTimeAsync(200);await flush();let view=render(component);
  expect(text(view)).toContain('communications.tracking.states.awaiting_action');expect(text(view)).toContain('Staff member');
  expect(nodes(view).find(node=>node.type==='a'&&node.props.href?.startsWith('tel:')).props.href).toBe('tel:+123456789');
  nodes(view).find(node=>node.type==='button'&&text(node)==='communications.tracking.conversation').props.onClick();expect(conversation).toHaveBeenCalledWith('thread');
  nodes(view).find(node=>node.type==='button'&&text(node)==='communications.tracking.nextPage').props.onClick();render(component);await vi.advanceTimersByTimeAsync(200);await flush();view=render(component);
  expect(h.rpc).toHaveBeenLastCalledWith('admin_communication_tracking',expect.objectContaining({p_offset:50}));
  nodes(view).find(node=>node.type==='input'&&node.props['aria-label']==='communications.tracking.search').props.onChange({target:{value:'Returning'}});
  view=render(component);expect(text(view)).toContain('Returning builder');await vi.advanceTimersByTimeAsync(200);await flush();render(component);
  expect(h.rpc).toHaveBeenLastCalledWith('admin_communication_tracking',expect.objectContaining({p_offset:0,p_search:'Returning'}));
 });
 it('discards a slower report for a previous date range',async()=>{
  let finishOld!:(value:any)=>void;h.rpc.mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;})).mockResolvedValue({data:trackingReport({rows:[{...trackingPerson,name:'Current date cohort'}]}),error:null});
  const component=()=>CommunicationTracking({onConversation:vi.fn()});render(component);await vi.advanceTimersByTimeAsync(200);
  nodes(render(component)).find(node=>node.type==='input'&&node.props.type==='date').props.onChange({target:{value:'2026-10-01'}});render(component);await vi.advanceTimersByTimeAsync(200);await flush();
  finishOld({data:trackingReport({rows:[{...trackingPerson,name:'Old date cohort'}]}),error:null});await flush();const view=render(component);
  expect(text(view)).toContain('Current date cohort');expect(text(view)).not.toContain('Old date cohort');
 });
 it('presents a missing migration as an installation requirement and allows a read-only retry',async()=>{
  h.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}}).mockResolvedValue({data:trackingReport(),error:null});const component=()=>CommunicationTracking({onConversation:vi.fn()});
  render(component);await vi.advanceTimersByTimeAsync(200);await flush();let view=render(component);expect(text(view)).toContain('communications.tracking.install');
  nodes(view).find(node=>node.type==='button'&&text(node)==='communications.inboxRefresh').props.onClick();render(component);await vi.advanceTimersByTimeAsync(200);await flush();view=render(component);
  expect(text(view)).not.toContain('communications.tracking.install');expect(h.rpc.mock.calls.every(call=>call[0]==='admin_communication_tracking')).toBe(true);
 });
});

function savedContact(status='done') {
 h.tables.followup_queue=[{id:'followup',email:'returning@example.test',status,note:'Earlier contact',due_at:null,attempt_count:1}];
 h.tables.communication_followup_events=[{id:'contact-event',followup_id:'followup',kind:'contacted',note:'Recorded call',created_at:'2026-11-14T12:00:00Z',contacted_at:'2026-11-13T12:00:00Z'}];
}
describe('staff contact history after activation',()=>{
 it('records the actual conversation time once on a completed task without scheduling or reopening it',async()=>{
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));savedContact();const changed=vi.fn();const component=()=>CommunicationContactHistory({followupId:'followup',onChanged:changed});
  render(component);await flush();let view=render(component);expect(text(view)).toContain('communications.tracking.contactClosed');expect(text(view)).toContain(new Date('2026-11-13T12:00:00Z').toLocaleString());
  expect(nodes(view).filter(node=>node.type==='input'&&node.props.type==='datetime-local')).toHaveLength(1);
  nodes(view).find(node=>node.type==='textarea').props.onChange({target:{value:'The conversation happened before the client joined.'}});
  const actual='2026-11-13T11:30:00';nodes(view).find(node=>node.type==='input'&&node.props.type==='datetime-local').props.onChange({target:{value:actual}});view=render(component);
  const submit=nodes(view).find(node=>node.type==='form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await flush();
  expect(h.rpc).toHaveBeenCalledOnce();expect(h.rpc).toHaveBeenCalledWith('admin_log_communication_contact',expect.objectContaining({p_id:'followup',p_contacted_at:new Date(actual).toISOString(),p_next_at:null}));
  expect(h.tables.followup_queue[0].status).toBe('done');expect(h.update).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledOnce();
 });
 it('retains the note after a refused contact time and lets staff correct it',async()=>{
  savedContact();h.rpc.mockResolvedValue({error:{message:'invalid_contact_time'}});const component=()=>CommunicationContactHistory({followupId:'followup',onChanged:vi.fn()});render(component);await flush();
  nodes(render(component)).find(node=>node.type==='textarea').props.onChange({target:{value:'Keep my contact record'}});nodes(render(component)).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();const view=render(component);
  expect(text(view)).toContain('communications.tracking.contactTimeInvalid');expect(nodes(view).find(node=>node.type==='textarea').props.value).toBe('Keep my contact record');
 });
 it('requires a next contact date only for an unfinished task',async()=>{
  savedContact('open');const component=()=>CommunicationContactHistory({followupId:'followup',onChanged:vi.fn(),nextContactHours:72});render(component);await flush();let view=render(component);
  nodes(view).find(node=>node.type==='textarea').props.onChange({target:{value:'Spoke to the contractor'}});const dates=nodes(view).filter(node=>node.type==='input'&&node.props.type==='datetime-local');expect(dates).toHaveLength(2);
  dates[1].props.onChange({target:{value:''}});view=render(component);nodes(view).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();
  expect(text(render(component))).toContain('communications.futureRequired');expect(h.rpc).not.toHaveBeenCalled();
 });
});
describe('staff-reviewed duplicate project flags',()=>{
 it('requires a reason and supports correcting the flag without deleting a project',async()=>{
  h.tables.communication_duplicate_projects=[];const component=()=>ProjectDuplicateFlag({projectId:'project'});render(component);await flush();let view=render(component);
  nodes(view).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();expect(text(render(component))).toContain('communications.tracking.reasonRequired');expect(h.rpc).not.toHaveBeenCalled();
  nodes(render(component)).find(node=>node.type==='textarea').props.onChange({target:{value:'Team confirmed duplicate'}});nodes(render(component)).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();view=render(component);
  expect(h.rpc).toHaveBeenLastCalledWith('admin_mark_duplicate_project',{p_project:'project',p_duplicate:true,p_reason:'Team confirmed duplicate'});
  nodes(view).find(node=>node.type==='button'&&text(node)==='communications.tracking.clearDuplicate').props.onClick();await flush();
  expect(h.rpc).toHaveBeenLastCalledWith('admin_mark_duplicate_project',expect.objectContaining({p_project:'project',p_duplicate:false}));expect(h.update).not.toHaveBeenCalled();
 });
 it('does not apply a previous project’s delayed save to the next project',async()=>{
  h.tables.communication_duplicate_projects=[];let project='old';let finish!:(value:any)=>void;const component=()=>ProjectDuplicateFlag({projectId:project});render(component);await flush();
  nodes(render(component)).find(node=>node.type==='textarea').props.onChange({target:{value:'Old project review'}});h.rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));nodes(render(component)).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  project='new';render(component);await flush();finish({data:null,error:null});await flush();const view=render(component);
  expect(text(view)).toContain('communications.tracking.standard');expect(nodes(view).find(node=>node.type==='textarea').props.value).toBe('');expect(text(view)).not.toContain('communications.tracking.clearDuplicate');
 });
});
