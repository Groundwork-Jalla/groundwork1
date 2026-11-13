import type { Step } from '../../../shared/lifecycle-copy.js';

export const ACTIVATION_JOURNEYS = [
  {id:'contractorSignup',name:'Contractor self-signup',sequences:['cs_signup','cs_onboarded','cs_project','cs_client_pending','cs_connected']},
  {id:'contractorInvited',name:'Contractor invited by a client',sequences:['ci_invited','ci_onboarding','ci_connected_existing','ci_connected_new']},
  {id:'clientSignup',name:'Client self-signup',sequences:['cl_signup','cl_project','cl_support','cl_contractor_pending','cl_connected']},
  {id:'clientInvited',name:'Client invited by a contractor',sequences:['iv_invited','iv_connected']},
] as const;
export type JourneyId=typeof ACTIVATION_JOURNEYS[number]['id'];
export interface JourneySequence {
  key:string;name:string;journey:string;audience:string;enabled:boolean;
  awaiting_action:string;followup_after_days:number|null;
}
export interface JourneyStep extends Step {id:string;sequence_key:string;code:string;cta_label_en:string;cta_label_fr:string;}
export function journeyPreviewContext(sequence:JourneySequence,lang:'en'|'fr') {
  const contractor=sequence.audience==='contractor';
  return {
    person:{email:contractor?'contractor@example.test':'client@example.test',fullName:contractor?'Alex Kamga':'Sam Obi'},
    context:{recipient_role:contractor?'contractor':'client',project_id:'example-project',
      project_name:lang==='fr'?'Projet exemple':'Example project',client_name:'Sam Obi',contractor_name:'Alex Kamga',
      invite_path:sequence.key.startsWith('iv_')?'/share/example-invitation':'/invite/example-invitation'},
  };
}
