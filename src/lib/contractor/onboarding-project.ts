import { contractorProjectReturn } from '@/lib/auth/project-invitation';
import type { OnboardingStatus } from '@/lib/supabase/contractor-onboarding';

export function hasOnboardingProject(status: OnboardingStatus): boolean {
  return (status.existingProjectCount ?? 0) > 0;
}

/** The database selects the project relationship; a URL never grants an assignment. */
export function onboardingProjectDestination(status: OnboardingStatus, requested?: string | null): string {
  const invited = contractorProjectReturn(requested ?? null);
  if (invited) return invited;
  const path = status.existingProjectPath;
  if (hasOnboardingProject(status) && path && (path === '/work/projects'
    || /^\/(?:work\/)?projects\/[a-zA-Z0-9_-]+$/.test(path))) return path;
  return '/work';
}
