import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { resolveNotificationDestination } from '@/lib/notification-destination';
import { useT } from '@/lib/i18n';
import { ProjectBackLink } from './ProjectBackLink';

/** A public enquiry can be opened from any project workspace. Resolve its actual membership. */
export function ProjectReturnLink({ projectId, className }: { projectId: string | null; className?: string }) {
  const { user, accountRole } = useAuth(); const t = useT();
  const scope = `${user?.id ?? ''}:${projectId ?? ''}:${accountRole ?? ''}`;
  const [destination, setDestination] = useState<{ scope: string; path: string } | null>(null);
  useEffect(() => {
    let alive = true;
    if (projectId && user) void resolveNotificationDestination({ project_id: projectId }).then(path => {
      if (alive && path) setDestination({ scope, path });
    }).catch(() => { /* The projects list remains available if membership cannot be read. */ });
    return () => { alive = false; };
  }, [scope]);
  const path = destination?.scope === scope ? destination.path : undefined;
  return <ProjectBackLink to={projectId ? path : '/'} className={className}
    label={path ? t('jallaManagement.backToProject') : !projectId ? t('jallaManagement.backHome') : undefined} />;
}
