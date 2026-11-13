import { dateFilterValue } from '@/lib/lifecycle/tracking-dates';
/** A date filter uses the displayed local calendar date, including both boundaries. */
export function matchesCalendarRange(value:string|null|undefined,from:string,through:string):boolean {
 if(!from&&!through)return true;if(!value||!Number.isFinite(Date.parse(value)))return false;
 const day=dateFilterValue(new Date(value));return (!from||day>=from)&&(!through||day<=through);
}
export function matchesProjectOrigin(origin:string|null|undefined,selected:string):boolean {return !selected||origin===selected;}
export function onboardingPhase(status:{complete:boolean;steps?:Record<string,boolean>}):'completed'|'in_progress'|'not_started' {
 return status.complete?'completed':Object.values(status.steps??{}).some(Boolean)?'in_progress':'not_started';
}
