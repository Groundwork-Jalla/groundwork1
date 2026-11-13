import { supabase } from './client';
import { communicationDateRange } from '@/lib/lifecycle/tracking-dates';
export { dateFilterValue,communicationDateRange } from '@/lib/lifecycle/tracking-dates';
export interface CommunicationRatio {completed:number;total:number;percent:number|null;}
export const COMMUNICATION_RATIOS=['signupToOnboarding','onboardingToProject','projectToInvitation','invitationAcceptance','linkClaims','humanRecovery','duplicateProjects'] as const;
export const TRACKING_STATES=['active','awaiting_action','action_complete','sequence_complete','exited','suppressed'] as const;
export type TrackingState=typeof TRACKING_STATES[number];
export interface CommunicationTrackingRow {
 id:string;email:string;phone:string|null;name:string|null;role:string|null;journey:string;sequenceKey:string;action:string;
 state:TrackingState;enteredAt:string;completedAt:string|null;projectId:string|null;projectName:string|null;entrySource:string|null;
 accountId:string|null;threadId:string|null;nextEmailAt:string|null;nextEmailCode:string|null;
 lastEmail:{code:string;subject:string;sentAt:string;status:string}|null;
 followup:{id:string;kind:string;status:string;ownerId:string|null;ownerName:string|null;dueAt:string|null;contactStatus:string;attempts:number;lastContactedAt:string|null}|null;
}
export interface CommunicationTrackingReport {
 from:string;until:string;asOf:string;offset:number;limit:number;total:number;rows:CommunicationTrackingRow[];
 metrics:Record<typeof COMMUNICATION_RATIOS[number],CommunicationRatio>&{
  medianConnectionHours:number|null;knownConnectionTimes:number;historicalUnknownConnectionTimes:number;
  invitationsWithoutDeliveryProof:number;knownSignupEvents:number;unclassifiedSignupEvents:number;
 };
 recovery:({sequence_key:string;step_code:string;subject:string}&CommunicationRatio)[];
 projects:{id:string;name:string;origin:'client'|'contractor'|null;created_at:string;duplicate:boolean;reason:string|null;connected:boolean}[];
}
export async function readCommunicationTracking(input:{from:string;through:string;search?:string;journey?:string;state?:string;offset?:number}):Promise<CommunicationTrackingReport> {
 const range=communicationDateRange(input.from,input.through);
 const {data,error}=await supabase.rpc('admin_communication_tracking',{p_from:range.from,p_until:range.until,
  p_search:input.search?.trim()??'',p_journey:input.journey??'',p_state:input.state??'',p_offset:input.offset??0,p_limit:50});
 if(error){if(['PGRST202','PGRST205','42P01','42883'].includes(error.code))throw new Error('communication_tracking_not_installed');throw new Error('communication_tracking_unavailable');}
 if(!data)throw new Error('communication_tracking_unavailable');return data as CommunicationTrackingReport;
}
export async function markDuplicateProject(project:string,duplicate:boolean,reason:string) {
 const {error}=await supabase.rpc('admin_mark_duplicate_project',{p_project:project,p_duplicate:duplicate,p_reason:reason});
 if(error)throw new Error('duplicate_project_save_failed');
}
export async function logCommunicationContact(input:{id:string;kind:'contacted'|'awaiting_reply';note:string;contactedAt:string;nextAt:string|null}) {
 const {error}=await supabase.rpc('admin_log_communication_contact',{p_id:input.id,p_kind:input.kind,p_note:input.note,p_contacted_at:input.contactedAt,p_next_at:input.nextAt});
 if(error)throw error;
}
