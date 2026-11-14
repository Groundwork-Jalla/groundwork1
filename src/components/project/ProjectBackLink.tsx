import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { projectListForRole, type AccountRole } from '@/lib/auth/account-role';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** An explicit document navigation also works when a project screen cannot finish its SPA transition. */
export function ProjectBackLink({ to, label, fallbackRole = 'client', className }: {
  to?: string; label?: string; fallbackRole?: AccountRole; className?: string;
}) {
  const { accountRole } = useAuth();
  const t = useT();
  const text = label ?? t('projectLinks.backToProjects');
  return <Link to={to ?? projectListForRole(accountRole ?? fallbackRole)} reloadDocument aria-label={text}
    className={cn('inline-flex min-h-11 w-fit shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-[#252525] dark:hover:text-white', className)}>
    <ArrowLeft className="size-4" aria-hidden="true" />
    <span>{text}</span>
  </Link>;
}
