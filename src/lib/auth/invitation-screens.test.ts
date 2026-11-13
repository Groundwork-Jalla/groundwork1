import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[], effects: [] as { i:number;run:()=>any }[],
  si:0,ri:0,ei:0,search:'',token:'invitation-token',user:null as any,navigate:vi.fn(),contractorPreview:vi.fn(),viewerPreview:vi.fn(),complete:vi.fn(),remember:vi.fn() }));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:any)=>{const i=h.si++;if(!(i in h.state))h.state[i]=typeof initial==='function'?initial():initial;return[h.state[i],(value:any)=>{h.state[i]=typeof value==='function'?value(h.state[i]):value;}];},
  useRef:(initial:any)=>{const i=h.ri++;return h.refs[i]??(h.refs[i]={current:initial});},
  useEffect:(run:()=>any,deps:any[])=>{const i=h.ei++;if(!h.deps[i]||deps.some((value,k)=>!Object.is(value,h.deps[i][k]))){h.deps[i]=deps;h.effects.push({i,run});}},useCallback:(fn:any)=>fn,
}));
vi.mock('react-router',()=>({Link:'link',useNavigate:()=>h.navigate,useParams:()=>({token:h.token}),useSearchParams:()=>[new URLSearchParams(h.search),vi.fn()]}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:h.user,session:h.user?{user:h.user}:null,loading:false,signOut:async()=>{h.user=null;}})}));
vi.mock('@/lib/i18n',()=>({useT:()=> (key:string)=>key,detectLang:()=> 'en',useLanguage:()=>({lang:'en'})}));
vi.mock('framer-motion',()=>({motion:{div:'div'}}));
vi.mock('@/components/auth/RoleSignup',()=>({default:'role-signup'}));
vi.mock('@/components/ui/PhoneField',()=>({PhoneField:'phone-field'}));
vi.mock('@/lib/supabase/client',()=>({supabase:{auth:{}}}));
vi.mock('@/lib/supabase/invites',()=>({getInviteByToken:h.contractorPreview}));
vi.mock('@/lib/supabase/project-viewers',()=>({getViewerInvitePreview:h.viewerPreview,rememberShare:h.remember}));
vi.mock('@/lib/auth/complete-project-invitation',()=>({completeProjectInvitation:h.complete}));

import Signup from '@/app/routes/auth/signup';
import InvitePage from '@/app/routes/invite';
import ShareInvite from '@/app/routes/share';
import {readProjectInvitation,rememberProjectInvitation} from './project-invitation';

function nodes(value:any):any[]{return Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children)]:[];}
function text(value:any):string{return Array.isArray(value)?value.map(text).join(' '):value?.props?text(value.props.children):typeof value==='string'?value:'';}
function render(component:()=>any){h.si=h.ri=h.ei=0;const result=nodes(component());for(const{i,run}of h.effects.splice(0)){h.cleanups[i]?.();h.cleanups[i]=run();}return result;}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function unmount(){for(const cleanup of h.cleanups)cleanup?.();h.cleanups=[];}
const clientPreview={projectName:'A home',invitedByName:'Builder',accepted:false,isClient:true,isShareLink:true};
beforeEach(()=>{
  vi.clearAllMocks();h.state=[];h.refs=[];h.deps=[];h.cleanups=[];h.effects=[];h.search='';h.token='invitation-token';h.user=null;
  const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
  vi.stubGlobal('window',{location:{href:'unchanged'}});
  h.contractorPreview.mockResolvedValue({status:'pending',project_name:'A home',inviter_name:'Client',is_share_link:true});
  h.viewerPreview.mockResolvedValue(clientPreview);h.complete.mockResolvedValue('/projects/the-project');
});
afterEach(()=>{unmount();vi.unstubAllGlobals();});

describe('new or existing accounts keep the same invitation through signup and login',()=>{
  it.each(['share','invite'])('the signup Log in link carries %s even when local storage is blocked',kind=>{
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');}});h.search=`?${kind}=invitation-token`;
    const link=render(Signup).find(node=>node.type==='link'&&text(node)==='auth.signup.logIn');
    expect(new URL(link.props.to,'https://test.invalid').searchParams.get(kind)).toBe('invitation-token');
  });
  it('retains a safe project tab when switching from signup to login',()=>{
    h.search='?redirect='+encodeURIComponent('/projects/p?tab=team');
    const link=render(Signup).find(node=>node.type==='link'&&text(node)==='auth.signup.logIn');
    expect(new URL(link.props.to,'https://test.invalid').searchParams.get('redirect')).toBe('/projects/p?tab=team');
  });
  it.each([true,false])('client=%s: unsigned invitees get signup/login links with the original token',async isClient=>{
    h.viewerPreview.mockResolvedValue({...clientPreview,isClient});render(ShareInvite);await flush();
    const links=render(ShareInvite).filter(node=>node.type==='link');
    expect(links.map(node=>node.props.to)).toEqual(['/auth/signup?share=invitation-token','/auth/login?share=invitation-token']);
    expect(text(render(ShareInvite))).toContain(isClient?'share.clientAccess':'projectLinks.observerAccess');
  });
});

describe.each([['contractor',InvitePage],['viewer',ShareInvite]] as const)('%s invitation recovery', (kind,Page)=>{
  it('offers retry for a connection failure without discarding the pending invitation',async()=>{
    rememberProjectInvitation({kind,token:h.token});const preview=kind==='viewer'?h.viewerPreview:h.contractorPreview;
    preview.mockRejectedValueOnce(Error('offline'));render(Page);await flush();
    const failed=render(Page);expect(text(failed)).toContain('invite.loadFailed');expect(readProjectInvitation()?.token).toBe(h.token);
    failed.find(node=>node.type==='button'&&text(node)==='common.retry')!.props.onClick();
    render(Page);await flush();expect(text(render(Page))).not.toContain('invite.loadFailed');
  });
  it('never redirects an abandoned screen after a delayed membership response',async()=>{
    h.user={id:'claimant',email:'claimant@test.example'};let finish!:(path:string)=>void;
    h.complete.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render(Page);await flush();
    const button=render(Page).find(node=>typeof node.props.onClick==='function'&&['accept','handleAcceptNow'].includes(node.props.onClick.name))!;
    const pending=button.props.onClick();unmount();finish('/projects/the-project');await pending;
    expect(window.location.href).toBe('unchanged');
  });
  it('blocks repeat acceptance while the first claim is pending',async()=>{
    h.user={id:'claimant',email:'claimant@test.example'};let finish!:(path:string)=>void;
    h.complete.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render(Page);await flush();
    const button=render(Page).find(node=>typeof node.props.onClick==='function'&&['accept','handleAcceptNow'].includes(node.props.onClick.name))!;
    const pending=button.props.onClick();await button.props.onClick();expect(h.complete).toHaveBeenCalledOnce();
    finish(kind==='viewer'?'/projects/the-project':'/work/projects/the-project');await pending;
    expect(window.location.href).toBe(kind==='viewer'?'/projects/the-project':'/work/projects/the-project');
  });
});
