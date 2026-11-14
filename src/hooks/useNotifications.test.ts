import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], callbacks: [] as any[], deps: [] as any[], effects: [] as { i:number;run:()=>any }[], cleanups: [] as any[], si:0,ri:0,ci:0,ei:0,
  rows:vi.fn(),count:vi.fn(),read:vi.fn(),all:vi.fn(),channel:vi.fn(),remove:vi.fn(),changes:[] as (()=>void)[],focus:vi.fn() }));
vi.mock('react', () => ({
  useState:(initial:any)=>{const i=h.si++;if(!(i in h.state))h.state[i]=initial;return[h.state[i],(value:any)=>{h.state[i]=typeof value==='function'?value(h.state[i]):value;}];},
  useRef:(initial:any)=>h.refs[h.ri++]??(h.refs[h.ri-1]={current:initial}),
  useCallback:(fn:any,deps:any[])=>{const i=h.ci++;if(!h.callbacks[i]||deps.some((v,k)=>v!==h.callbacks[i].deps[k]))h.callbacks[i]={fn,deps};return h.callbacks[i].fn;},
  useEffect:(run:()=>any,deps:any[])=>{const i=h.ei++;if(!h.deps[i]||deps.some((v,k)=>v!==h.deps[i][k])){h.deps[i]=deps;h.effects.push({i,run});}},
}));
vi.mock('@/lib/supabase/notifications',()=>({fetchNotifications:h.rows,fetchUnreadNotificationCount:h.count,markNotificationRead:h.read,markAllNotificationsRead:h.all}));
vi.mock('@/lib/supabase/client',()=>({supabase:{channel:h.channel,removeChannel:h.remove}}));
import { useNotifications } from './useNotifications';
const row=(id:string,read_at:string|null=null)=>({id,user_id:'first',read_at});
function render(user='first',limit=20){h.si=h.ri=h.ci=h.ei=0;const result=useNotifications(user,limit);for(const{i,run}of h.effects.splice(0)){h.cleanups[i]?.();h.cleanups[i]=run();}return result;}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();h.state=[];h.refs=[];h.callbacks=[];h.deps=[];h.effects=[];h.cleanups=[];h.changes=[];
  h.rows.mockResolvedValue([row('one')]);h.count.mockResolvedValue(28);h.read.mockResolvedValue(undefined);h.all.mockResolvedValue(undefined);
  const channel:any={on:vi.fn((_event,filter,callback)=>{h.changes.push(callback);return channel;}),subscribe:vi.fn(()=>channel)};h.channel.mockReturnValue(channel);
  vi.stubGlobal('window',{addEventListener:h.focus,removeEventListener:vi.fn()});
  vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()});
});
afterEach(()=>{for(const cleanup of h.cleanups)cleanup?.();h.cleanups=[];vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

describe('the notification bell uses the authenticated recipient feed',()=>{
  it('counts all unread notifications rather than only the first page',async()=>{
    render();await flush();expect(render()).toMatchObject({loaded:true,rows:[row('one')],unread:28,failed:false});
    expect(h.rows).toHaveBeenCalledWith('first',20);
  });
  it('hides another account’s notifications immediately and ignores its late response',async()=>{
    let finish!:(rows:any)=>void;h.rows.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    render();h.rows.mockResolvedValue([row('second-account')]);expect(render('second').rows).toEqual([]);await flush();
    finish([row('old-account')]);await flush();expect(render('second').rows.map(n=>n.id)).toEqual(['second-account']);expect(h.remove).toHaveBeenCalledTimes(1);
  });
  it('keeps a newer realtime result when the initial request finishes last',async()=>{
    let finish!:(rows:any)=>void;h.rows.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render();
    h.rows.mockResolvedValue([row('newest')]);h.changes[0]();await flush();finish([row('stale')]);await flush();expect(render().rows.map(n=>n.id)).toEqual(['newest']);
  });
  it('reflects read updates from another notification surface',async()=>{
    render();await flush();h.rows.mockResolvedValue([row('one','2026-11-14T00:00:00Z')]);h.count.mockResolvedValue(0);h.changes[0]();await flush();
    expect(render()).toMatchObject({unread:0,rows:[row('one','2026-11-14T00:00:00Z')]});
    expect(h.channel.mock.results[0].value.on).toHaveBeenCalledWith('postgres_changes',expect.objectContaining({event:'*',filter:'user_id=eq.first'}),expect.any(Function));
  });
  it('does not silently clear unread status when saving fails',async()=>{
    render();await flush();h.read.mockRejectedValueOnce(Error('offline'));await expect(render().markRead('one')).rejects.toThrow('offline');
    expect(render().rows[0].read_at).toBeNull();h.all.mockRejectedValueOnce(Error('offline'));await expect(render().markAllRead()).rejects.toThrow('offline');expect(render().unread).toBe(28);
  });
  it('refreshes on focus and visible polling after a missed realtime event',async()=>{
    render();await flush();h.rows.mockResolvedValue([row('caught-up')]);const focus=h.focus.mock.calls.find(([event])=>event==='focus')![1];focus();await flush();expect(render().rows[0].id).toBe('caught-up');
    const count=h.rows.mock.calls.length;await vi.advanceTimersByTimeAsync(30000);expect(h.rows.mock.calls.length).toBeGreaterThan(count);
    (document as any).visibilityState='hidden';const hidden=h.rows.mock.calls.length;await vi.advanceTimersByTimeAsync(30000);expect(h.rows).toHaveBeenCalledTimes(hidden);
  });
  it('reports fetch failures and can retry without showing a false empty success',async()=>{
    h.rows.mockRejectedValueOnce(Error('offline'));render();await flush();expect(render()).toMatchObject({loaded:true,failed:true});
    h.rows.mockResolvedValue([row('recovered')]);await render().refresh();expect(render()).toMatchObject({failed:false,rows:[row('recovered')]});
  });
});
