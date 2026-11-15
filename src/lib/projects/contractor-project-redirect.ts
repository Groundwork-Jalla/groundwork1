import type { ProjectTeamAccess } from '@/lib/supabase/project-team';

/** Correct old client-view links only after the saved assignment has been read. */
export function contractorProjectRedirect(projectId:string,access:Pick<ProjectTeamAccess,'assignedContractor'|'primaryClient'>|null,search='',hash=''):string|null {
  if(!access?.assignedContractor||access.primaryClient)return null;
  const params=new URLSearchParams(search);
  const tabs:Record<string,string>={overview:'work',stages:'work',costing:'money',timeline:'work',team:'people'};
  const tab=params.get('tab');if(tab&&tabs[tab])params.set('tab',tabs[tab]);
  return `/work/projects/${encodeURIComponent(projectId)}${params.size?`?${params}`:''}${hash.startsWith('#')?hash:''}`;
}
