import { describe, expect, it } from 'vitest';
import { hasOnboardingProject, onboardingProjectDestination } from './onboarding-project';
import type { OnboardingStatus } from '@/lib/supabase/contractor-onboarding';

const status=(patch:Partial<OnboardingStatus>={}):OnboardingStatus=>({steps:{agreements:true,identity:true,professional:true,payout:true,emergency:true,documents:false},
 specialty:null,specialtyOther:null,needsLicence:false,businessStatus:null,needsBusinessDoc:false,emergencyCount:1,clientIntent:null,complete:true,...patch});
describe('returning to an existing project after contractor setup',()=>{
 it('keeps an account with no confirmed project on the ordinary setup path',()=>{
  expect(hasOnboardingProject(status())).toBe(false);
  expect(onboardingProjectDestination(status({existingProjectCount:0,existingProjectPath:'/work/projects/project'}))).toBe('/work');
 });
 it.each(['/work/projects/project','/projects/project','/work/projects'])('uses the saved project relationship %s',path=>{
  expect(hasOnboardingProject(status({existingProjectCount:1}))).toBe(true);
  expect(onboardingProjectDestination(status({existingProjectCount:1,existingProjectPath:path}))).toBe(path);
 });
 it('preserves the specific invited project and its requested action',()=>{
  expect(onboardingProjectDestination(status({existingProjectCount:3,existingProjectPath:'/work/projects'}),'/work/projects/invited?tab=work#stage-payment-1'))
   .toBe('/work/projects/invited?tab=work#stage-payment-1');
 });
 it.each(['//outside.test','https://outside.test','/admin','/work/onboarding','/work/projects/../admin','/projects/evil?redirect=//outside.test'])('refuses an unsafe saved project destination %s',path=>{
  expect(onboardingProjectDestination(status({existingProjectCount:1,existingProjectPath:path}))).toBe('/work');
 });
});
