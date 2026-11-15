import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({state:[] as any[],refs:[] as any[],memos:[] as any[],deps:[] as any[],effects:[] as Array<()=>any>,si:0,ri:0,mi:0,ei:0,
 status:vi.fn(),record:vi.fn(),intent:vi.fn(),navigate:vi.fn(),funnel:vi.fn(),lifecycle:vi.fn(),search:'',t:(key:string)=>key}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(value:any)=>{const i=h.si++;if(!(i in h.state))h.state[i]=typeof value==='function'?value():value;return[h.state[i],(next:any)=>{h.state[i]=typeof next==='function'?next(h.state[i]):next;}];},
 useRef:(value:any)=>h.refs[h.ri++]??(h.refs[h.ri-1]={current:value}),
 useCallback:(fn:any,deps:any[])=>{const i=h.mi++;if(!h.memos[i]||deps.some((v,j)=>!Object.is(v,h.memos[i].deps[j])))h.memos[i]={fn,deps};return h.memos[i].fn;},
 useEffect:(effect:()=>any,deps:any[])=>{const i=h.ei++;if(!h.deps[i]||deps.some((v,j)=>!Object.is(v,h.deps[i][j]))){h.deps[i]=deps;h.effects.push(effect);}},
}));
vi.mock('react-router',()=>({Link:'link',Navigate:'navigate',useNavigate:()=>h.navigate,useSearchParams:()=>[new URLSearchParams(h.search)]}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'account'}})}));
vi.mock('@/lib/i18n',()=>({useT:()=>h.t}));
vi.mock('@/lib/supabase/contractor-onboarding',()=>({fetchOnboardingStatus:h.status,fetchOnboardingRecord:h.record,setClientIntent:h.intent,
 SIGNABLE_AGREEMENTS:['terms_of_service'],acceptAgreement:vi.fn(),saveSpecialty:vi.fn(),saveEmergencyContacts:vi.fn(),saveIdentity:vi.fn()}));
vi.mock('@/lib/supabase/partner-application',()=>({setPartnerInterest:vi.fn()}));
vi.mock('@/lib/analytics/funnel',()=>({trackFunnel:h.funnel}));
vi.mock('@/lib/analytics/lifecycle',()=>({trackLifecycle:h.lifecycle}));
vi.mock('@/lib/contractor/emergency-contact-draft',()=>({clearEmergencyContactDraft:vi.fn(),readEmergencyContactDraft:()=>null,saveEmergencyContactDraft:vi.fn()}));
vi.mock('@/components/contractor/AgreementReader',()=>({AgreementReader:'agreement-reader'}));
vi.mock('@/components/contractor/PayoutDialog',()=>({PayoutDialog:'payout-dialog'}));
vi.mock('@/components/ui/button',()=>({Button:'button'}));
import ContractorOnboarding from '@/app/routes/work/onboarding';
const complete={steps:{agreements:true,identity:true,professional:true,payout:true,emergency:true,documents:false},complete:true,clientIntent:null,
 existingProjectCount:1,existingProjectPath:'/work/projects/existing'};
function render(){h.si=h.ri=h.mi=h.ei=0;const tree=ContractorOnboarding();for(const effect of h.effects.splice(0))effect();return tree;}
function nodes(tree:any):any[]{return Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];}
const text=(tree:any):string=>Array.isArray(tree)?tree.map(text).join(' '):typeof tree==='string'?tree:tree?.props?text(tree.props.children):'';
async function load(){render();await Promise.resolve();await Promise.resolve();render();return render();}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
beforeEach(()=>{vi.clearAllMocks();h.state=[];h.refs=[];h.memos=[];h.deps=[];h.effects=[];h.search='';h.status.mockResolvedValue(complete);h.record.mockResolvedValue({contacts:[]});h.intent.mockResolvedValue({...complete,clientIntent:'existing_project'});});
describe('existing projects at the end of contractor onboarding',()=>{
 it('finishes after the five required panels with access to the existing project',async()=>{
  const tree=await load();expect(text(tree)).toContain('contractorOnboarding.existingTitle');
  expect(text(tree)).toContain('contractorOnboarding.existingCta');expect(nodes(tree).some(n=>n.type?.name==='AllDone')).toBe(false);
  const progress=nodes(tree).find(n=>n.type?.name==='Progress');expect(progress.props.order).toHaveLength(5);expect(progress.props.index).toBe(4);
 });
 it('records existing-project completion once and opens that project',async()=>{
  const tree=await load();const button=nodes(tree).find(n=>n.type==='button');button.props.onClick();button.props.onClick();await flush();
  expect(h.intent).toHaveBeenCalledExactlyOnceWith('existing_project');expect(h.funnel).toHaveBeenCalledWith('contractor_onboarding','completed');
  expect(h.lifecycle).toHaveBeenCalledExactlyOnceWith('contractor_onboarding_completed');expect(h.lifecycle).not.toHaveBeenCalledWith('no_active_project_selected');
  expect(h.navigate).toHaveBeenCalledExactlyOnceWith('/work/projects/existing',{replace:true});
 });
 it('keeps the specific invited project after the form',async()=>{
  h.search='redirect='+encodeURIComponent('/work/projects/invited?tab=work');const tree=await load();nodes(tree).find(n=>n.type==='button').props.onClick();await flush();
  expect(h.navigate).toHaveBeenCalledWith('/work/projects/invited?tab=work',{replace:true});
 });
 it('keeps the first-project choice for a new contractor without a project',async()=>{
  h.status.mockResolvedValue({...complete,existingProjectCount:0,existingProjectPath:null});const tree=await load();
  expect(nodes(tree).find(n=>n.type?.name==='Progress').props.order).toHaveLength(6);expect(nodes(tree).some(n=>n.type?.name==='AllDone')).toBe(true);
 });
 it('does not bypass an unfinished required form for an existing project owner',async()=>{
  h.status.mockResolvedValue({...complete,complete:false,steps:{...complete.steps,emergency:false}});const tree=await load();
  expect(text(tree)).not.toContain('contractorOnboarding.existingTitle');expect(h.intent).not.toHaveBeenCalled();
 });
 it('stays on the completion screen and allows retry if saving fails',async()=>{
  h.intent.mockRejectedValueOnce(new Error('network unavailable'));const tree=await load();nodes(tree).find(n=>n.type==='button').props.onClick();await flush();
  expect(text(render())).toContain('contractorOnboarding.err.generic');expect(h.navigate).not.toHaveBeenCalled();expect(h.lifecycle).not.toHaveBeenCalled();
 });
 it('returns an already completed contractor directly to the existing project',async()=>{
  h.status.mockResolvedValue({...complete,clientIntent:'existing_project'});const tree=await load();expect(tree.props.to).toBe('/work/projects/existing');
 });
});
