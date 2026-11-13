import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({supabase:{rpc:h.rpc}}));
import { communicationDateRange,dateFilterValue,logCommunicationContact,markDuplicateProject,readCommunicationTracking } from '@/lib/supabase/communication-tracking';
beforeEach(()=>{vi.clearAllMocks();h.rpc.mockResolvedValue({data:{rows:[],metrics:{},total:0},error:null});});
describe('communication tracking request boundaries',()=>{
 it('includes the complete final date using the admin’s calendar',()=>{
  const range=communicationDateRange('2026-11-01','2026-11-14');
  expect(range).toEqual({from:new Date(2026,10,1).toISOString(),until:new Date(2026,10,15).toISOString()});
  expect(dateFilterValue(new Date(2026,10,14,23,59))).toBe('2026-11-14');
 });
 it.each([['2026-02-30','2026-03-01'],['2026-11-15','2026-11-14'],['','2026-11-14'],['13/11/2026','2026-11-14']])('refuses invalid or reversed date inputs before a database request',async(from,through)=>{
  await expect(readCommunicationTracking({from,through})).rejects.toThrow('invalid_tracking_dates');expect(h.rpc).not.toHaveBeenCalled();
 });
 it('passes person filters and pagination to the admin-only report RPC',async()=>{
  await readCommunicationTracking({from:'2026-11-01',through:'2026-11-14',journey:'Contractor self-signup',search:' Sam ',state:'awaiting_action',offset:50});
  expect(h.rpc).toHaveBeenCalledWith('admin_communication_tracking',expect.objectContaining({p_journey:'Contractor self-signup',p_search:'Sam',p_state:'awaiting_action',p_offset:50,p_limit:50}));
 });
 it('keeps an unapplied report migration separate from a genuine empty cohort',async()=>{
  h.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});
  await expect(readCommunicationTracking({from:'2026-11-01',through:'2026-11-14'})).rejects.toThrow('communication_tracking_not_installed');
 });
 it('uses the protected RPC for reversible staff-reviewed duplicate flags',async()=>{
  await markDuplicateProject('project',true,'Reviewed duplicate');await markDuplicateProject('project',false,'');
  expect(h.rpc).toHaveBeenNthCalledWith(1,'admin_mark_duplicate_project',{p_project:'project',p_duplicate:true,p_reason:'Reviewed duplicate'});
  expect(h.rpc).toHaveBeenNthCalledWith(2,'admin_mark_duplicate_project',{p_project:'project',p_duplicate:false,p_reason:''});
 });
 it('sends actual contact time separately from the next contact due date',async()=>{
  await logCommunicationContact({id:'followup',kind:'contacted',note:'Completed call',contactedAt:'2026-11-13T12:00:00Z',nextAt:null});
  expect(h.rpc).toHaveBeenCalledWith('admin_log_communication_contact',{p_id:'followup',p_kind:'contacted',p_note:'Completed call',p_contacted_at:'2026-11-13T12:00:00Z',p_next_at:null});
  h.rpc.mockResolvedValue({error:{message:'invalid_contact_time'}});
  await expect(logCommunicationContact({id:'followup',kind:'contacted',note:'Future call',contactedAt:'2099-01-01T12:00:00Z',nextAt:null})).rejects.toEqual({message:'invalid_contact_time'});
 });
});
