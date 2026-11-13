import { describe,expect,it } from 'vitest';
import { matchesCalendarRange,matchesProjectOrigin,onboardingPhase } from './communication-filters';
describe('communication administration filters',()=>{
 it('includes the whole first and last calendar day and composes open boundaries',()=>{
  const late=new Date(2026,10,14,23,59,59).toISOString();
  expect(matchesCalendarRange(late,'2026-11-14','2026-11-14')).toBe(true);
  expect(matchesCalendarRange(late,'','2026-11-13')).toBe(false);
  expect(matchesCalendarRange(late,'2026-11-15','')).toBe(false);
 });
 it('excludes unknown dates only when a date filter has been selected',()=>{
  expect(matchesCalendarRange(null,'','')).toBe(true);
  expect(matchesCalendarRange(null,'2026-11-01','')).toBe(false);
  expect(matchesCalendarRange('invalid','','2026-11-14')).toBe(false);
 });
 it('uses saved creation origin without inferring it from today’s owner role',()=>{
  expect(matchesProjectOrigin('contractor','contractor')).toBe(true);
  expect(matchesProjectOrigin('contractor','client')).toBe(false);
  expect(matchesProjectOrigin(null,'client')).toBe(false);
  expect(matchesProjectOrigin(null,'')).toBe(true);
 });
 it('distinguishes onboarding that has not started, has started and is complete',()=>{
  expect(onboardingPhase({complete:false,steps:{identity:false,agreements:false}})).toBe('not_started');
  expect(onboardingPhase({complete:false,steps:{identity:true,agreements:false}})).toBe('in_progress');
  expect(onboardingPhase({complete:true,steps:{identity:true,agreements:true}})).toBe('completed');
 });
});
