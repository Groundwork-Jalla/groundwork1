import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WizardProvider, useWizard, type OnBehalfOf } from '@/contexts/WizardContext';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import Step1Country        from '@/components/wizard/steps/Step1Country';
import Step2ProjectType    from '@/components/wizard/steps/Step2ProjectType';
import Step3BuildingType   from '@/components/wizard/steps/Step3BuildingType';
import Step4Floors         from '@/components/wizard/steps/Step4Floors';
import Step5Rooms          from '@/components/wizard/steps/Step5Rooms';
import Step6BoysQuarters   from '@/components/wizard/steps/Step6BoysQuarters';
import Step7RoofType       from '@/components/wizard/steps/Step7RoofType';
import Step8Details        from '@/components/wizard/steps/Step8Details';
import Step9Summary        from '@/components/wizard/steps/Step9Summary';
import Step11ConfirmBudget from '@/components/wizard/steps/Step11ConfirmBudget';

// =========================================================
// /admin/projects/new — create a Jalla Management project for a client
//
// Jalla Management is the tier where Jalla runs the build. Until now the only way a
// project could exist was for the client to create it themselves — eleven wizard steps,
// on their own account, on the free plan — which is the opposite of what "managed"
// means, and left the tier guard's own comment ("an administrator setting up a
// negotiated contract") describing something nobody could do.
//
// Two screens in one route. First the admin picks WHOSE project this is; then the
// ordinary wizard runs with that person as the owner and `jalla_management` as the tier.
// The project belongs to the client — their dashboard, their row-level access — and
// `projects.created_by` records which admin set it up (migration 082).
//
// The plan-selection step is skipped: the plan is decided by the fact that an admin is
// here, and showing a client-facing pricing screen to a member of staff would only invite
// them to pick the wrong thing.
// =========================================================

/** The client wizard's eleven steps, less the plan picker — the plan is already decided. */
const STEPS: React.ComponentType[] = [
  Step1Country, Step2ProjectType, Step3BuildingType, Step4Floors, Step5Rooms,
  Step6BoysQuarters, Step7RoofType, Step8Details, Step9Summary, Step11ConfirmBudget,
];

export function ManagedWizard() {
  const { step, direction, goTo } = useWizard();

  // Step 10 in the shared numbering is the plan picker. Skip it in the direction of
  // travel rather than renumbering every step's `goTo`, which BuildingPreview hard-codes.
  // Direction matters: a plain "if 10 then 11" traps Back — leaving 11 lands on 10, which
  // bounces straight to 11 again, and the admin can never return to the summary.
  useEffect(() => {
    if (step === 10) goTo(direction === 'back' ? 9 : 11);
  }, [step, direction, goTo]);

  // Render the destination during the skip frame, so nothing flashes blank.
  const Component = step <= 9 ? STEPS[step - 1]
    : direction === 'back' && step === 10 ? Step9Summary
    : Step11ConfirmBudget;
  return <Component />;
}

export default function AdminNewProject() {
  const t = useT();
  const navigate = useNavigate();
  const { isAdmin, adminChecked } = useAuth();
  const [params] = useSearchParams();

  const [users, setUsers]     = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [chosen, setChosen]   = useState<OnBehalfOf | null>(null);

  useEffect(() => {
    if (adminChecked && !isAdmin) navigate('/admin', { replace: true });
  }, [adminChecked, isAdmin, navigate]);

  useEffect(() => {
    let alive = true;
    listAdminUsers()
      .then(u => { if (alive) setUsers(u); })
      .catch(() => { if (alive) setError(t('admin.newProject.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  // `?for=<userId>` lets /admin/users deep-link straight into the wizard for one person.
  useEffect(() => {
    const id = params.get('for');
    if (!id || chosen || users.length === 0) return;
    const u = users.find(x => x.id === id);
    if (u) setChosen({ userId: u.id, label: u.fullName || u.email, tier: 'jalla_management' });
  }, [params, users, chosen]);

  const clients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      // Staff do not get managed builds created for them.
      .filter(u => !u.roles.includes('admin'))
      .filter(u => !q || u.email.toLowerCase().includes(q) || u.fullName.toLowerCase().includes(q))
      .slice(0, 40);
  }, [users, query]);

  if (!adminChecked) return null;

  if (chosen) {
    return (
      <WizardProvider onBehalfOf={chosen}>
        <ManagedWizard />
      </WizardProvider>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <Link to="/admin/projects" className="inline-flex items-center gap-1 text-sm text-brand-mid-grey hover:text-brand-near-black">
        <ArrowLeft className="size-3.5" /> {t('admin.newProject.back')}
      </Link>

      <header className="mt-4 mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.newProject.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.newProject.subtitle')}</p>
      </header>

      <div className="relative mb-4 w-full sm:w-96">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
          placeholder={t('admin.newProject.search')} aria-label={t('admin.newProject.search')}
          className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
        />
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm">{error}</p>
      ) : clients.length === 0 ? (
        <p className="py-8 text-sm text-brand-mid-grey">{t('admin.newProject.none')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map(u => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => setChosen({ userId: u.id, label: u.fullName || u.email, tier: 'jalla_management' })}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border border-brand-border-grey bg-white p-4 text-left',
                  'transition-colors hover:border-brand-near-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black/30',
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-off-white">
                  <UserRound className="size-4 text-brand-mid-grey" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-brand-near-black">{u.fullName || u.email}</span>
                  <span className="block truncate text-xs text-brand-mid-grey">{u.email}</span>
                  <span className="mt-1 block text-[11px] text-brand-mid-grey">
                    {t('admin.newProject.projectCount', { n: u.projectCount })}
                    {u.tier ? ` · ${u.tier.replace('_', ' ')}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
