import { useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  updateApplication, validateApplicationEdit,
  type ApplicationDetail, type ApplicationEdit, type ApplicationEditProblem,
} from '@/lib/supabase/admin-applications';
import { CONTRACTOR_ROLES, type ProjectEntry } from '@/lib/contractor/application-types';
import { YEARS_KEYS, OPERATES_KEYS, PROJECT_TYPE_KEYS, CONCURRENT_KEYS } from '@/lib/contractor/application-options';
import { COUNTRIES } from '@/lib/countries';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Edit a contractor application in place.
//
// The same sections as the read-only page, each field replaced by the control the
// applicant had: the closed lists offer exactly the keys the public form offers (one
// shared module), so an admin cannot type a value the CRM payload and the emails will
// not recognise. Free text stays free text. The applicant's uploaded files and their
// consent to the terms are not here on purpose — see ApplicationEdit.
//
// Credentials are whatever the role's track asked for at the time, stored as a loose
// record; they are edited by key, with the control chosen by the stored value's type,
// rather than re-implementing the four tracks here.
// =========================================================

interface Props {
  app: ApplicationDetail;
  onCancel: () => void;
  onSaved: (fresh: ApplicationDetail) => void;
}

const EMPTY_PROJECT: ProjectEntry = {
  name: '', location: '', budget: '', role: '', year: '', refName: '', refPhone: '', refEmail: '',
};

function toEdit(a: ApplicationDetail): ApplicationEdit {
  return {
    fullName: a.fullName, businessName: a.businessName, email: a.email, phone: a.phone,
    country: a.country, city: a.city, portfolioUrl: a.portfolioUrl, lang: a.lang,
    role: a.role, roleOther: a.roleOther,
    yearsExperience: a.yearsExperience, operatesAs: a.operatesAs, teamSize: a.teamSize,
    projectTypes: [...a.projectTypes],
    credentials: { ...a.credentials },
    projects: a.projects.map(p => ({ ...p })),
    acceptsMilestones: a.acceptsMilestones, acceptsVerification: a.acceptsVerification,
    acceptsNoSidePay: a.acceptsNoSidePay,
    videoUrl: a.videoUrl, whyJoin: a.whyJoin, differentiator: a.differentiator,
    readyForEarly: a.readyForEarly, regions: a.regions, concurrentProjects: a.concurrentProjects,
  };
}

export function ApplicationEditor({ app, onCancel, onSaved }: Props) {
  const t = useT();
  const [e, setE] = useState<ApplicationEdit>(() => toEdit(app));
  const [problem, setProblem] = useState<ApplicationEditProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ApplicationEdit>(k: K, v: ApplicationEdit[K]) =>
    setE(prev => ({ ...prev, [k]: v }));
  const f = (k: string) => t(`contractorApply.form.${k}` as TKey);
  const bad = (k: ApplicationEditProblem) => problem === k;

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    const p = validateApplicationEdit(e);
    setProblem(p);
    if (p) { setError(t('admin.apps.edit.invalid')); return; }

    setSaving(true);
    try {
      onSaved(await updateApplication(app.id, e));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.startsWith('invalid:') ? t('admin.apps.edit.invalid') : t('admin.apps.edit.failed'));
      setSaving(false);
    }
  }

  const bar = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit" disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-near-black/90 disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        {saving ? t('admin.apps.edit.saving') : t('admin.apps.edit.save')}
      </button>
      <button
        type="button" onClick={onCancel} disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3.5 py-2 text-xs font-medium text-brand-near-black hover:bg-brand-off-white disabled:opacity-50"
      >
        <X className="size-3.5" /> {t('admin.apps.edit.cancel')}
      </button>
      {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
    </div>
  );

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      {bar}

      <Section title={t('admin.apps.sBasic')}>
        <Grid>
          <Text label={t('admin.apps.fName')}     value={e.fullName}            onChange={v => set('fullName', v)}     invalid={bad('fullName')} />
          <Text label={t('admin.apps.fBusiness')} value={e.businessName ?? ''}  onChange={v => set('businessName', v)} />
          <Text label={t('admin.apps.fEmail')}    value={e.email} type="email"  onChange={v => set('email', v)}        invalid={bad('email')} />
          <Text label={t('admin.apps.fPhone')}    value={e.phone} type="tel"    onChange={v => set('phone', v)}        invalid={bad('phone')} />
          <Choice label={f('country')} value={e.country} onChange={v => set('country', v)} invalid={bad('country')}
                  options={COUNTRIES.map(c => ({ key: c.code, label: c.name }))} />
          <Text label={f('city')}     value={e.city}                 onChange={v => set('city', v)}         invalid={bad('city')} />
          <Text label={t('admin.apps.fPortfolio')} value={e.portfolioUrl ?? ''} type="url" onChange={v => set('portfolioUrl', v)} />
          <Choice label={t('admin.apps.fSubmittedIn')} value={e.lang} onChange={v => set('lang', v === 'fr' ? 'fr' : 'en')}
                  options={[{ key: 'en', label: 'English' }, { key: 'fr', label: 'Français' }]} />
        </Grid>
      </Section>

      <Section title={t('admin.apps.sCategory')}>
        <Grid>
          <Choice label={t('admin.apps.fRole')} value={e.role} onChange={v => set('role', v)} invalid={bad('role')}
                  options={CONTRACTOR_ROLES.map(r => ({ key: r, label: f(`role.${r}`) }))} />
          {e.role === 'other' && (
            <Text label={t('admin.apps.fRoleOther')} value={e.roleOther ?? ''} onChange={v => set('roleOther', v)} invalid={bad('roleOther')} />
          )}
        </Grid>
      </Section>

      <Section title={t('admin.apps.sExperience')}>
        <Grid>
          <Choice label={t('admin.apps.fYears')} value={e.yearsExperience} onChange={v => set('yearsExperience', v)} invalid={bad('yearsExperience')}
                  options={YEARS_KEYS.map(k => ({ key: k, label: f(`years.${k}`) }))} />
          <Choice label={t('admin.apps.fOperatesAs')} value={e.operatesAs} onChange={v => set('operatesAs', v)} invalid={bad('operatesAs')}
                  options={OPERATES_KEYS.map(k => ({ key: k, label: f(`operates.${k}`) }))} />
          <Text label={t('admin.apps.fTeamSize')} value={e.teamSize ?? ''} onChange={v => set('teamSize', v)} />
        </Grid>
        <Checks label={t('admin.apps.fProjectTypes')} invalid={bad('projectTypes')}
                options={PROJECT_TYPE_KEYS.map(k => ({ key: k, label: f(`projectType.${k}`) }))}
                selected={e.projectTypes}
                onToggle={k => set('projectTypes', e.projectTypes.includes(k) ? e.projectTypes.filter(x => x !== k) : [...e.projectTypes, k])} />
      </Section>

      <Section title={t('admin.apps.sCredentials')}>
        {Object.keys(e.credentials).length === 0
          ? <p className="py-2 text-sm text-brand-mid-grey">{t('admin.apps.edit.noCredentials')}</p>
          : (
            <Grid>
              {Object.entries(e.credentials).map(([k, v]) => (
                <CredentialField key={k} name={k} value={v}
                                 onChange={nv => set('credentials', { ...e.credentials, [k]: nv })} />
              ))}
            </Grid>
          )}
        <p className="mt-2 text-xs text-brand-mid-grey">{t('admin.apps.edit.uploadsNote')}</p>
      </Section>

      <Section title={t('admin.apps.sHistory')}>
        <div className="flex flex-col gap-4">
          {e.projects.map((p, i) => (
            <div key={i} className="rounded-lg border border-brand-border-grey px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                  {t('admin.apps.project', { n: i + 1 })}
                </p>
                <button type="button" onClick={() => set('projects', e.projects.filter((_, j) => j !== i))}
                        aria-label={t('admin.apps.edit.removeProject')}
                        className="inline-flex size-7 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-brand-off-white hover:text-state-alert">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Grid>
                {(['name', 'location', 'budget', 'role', 'year', 'refName', 'refPhone', 'refEmail'] as const).map(k => (
                  <Text key={k} label={t(`admin.apps.edit.p_${k}` as TKey)} value={p[k]}
                        onChange={v => set('projects', e.projects.map((q, j) => (j === i ? { ...q, [k]: v } : q)))} />
                ))}
              </Grid>
            </div>
          ))}
          <button type="button" onClick={() => set('projects', [...e.projects, { ...EMPTY_PROJECT }])}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:bg-brand-off-white">
            <Plus className="size-3.5" /> {t('admin.apps.edit.addProject')}
          </button>
        </div>
      </Section>

      <Section title={t('admin.apps.sStandards')}>
        <Grid>
          <Toggle label={t('admin.apps.fMilestones')}   value={e.acceptsMilestones}   onChange={v => set('acceptsMilestones', v)} />
          <Toggle label={t('admin.apps.fVerification')} value={e.acceptsVerification} onChange={v => set('acceptsVerification', v)} />
          <Toggle label={t('admin.apps.fNoSidePay')}    value={e.acceptsNoSidePay}    onChange={v => set('acceptsNoSidePay', v)} />
        </Grid>
      </Section>

      <Section title={t('admin.apps.sAlignment')}>
        <Long label={t('admin.apps.fWhyJoin')}   value={e.whyJoin}        onChange={v => set('whyJoin', v)}        invalid={bad('whyJoin')} />
        <Long label={t('admin.apps.fDifferent')} value={e.differentiator} onChange={v => set('differentiator', v)} invalid={bad('differentiator')} />
        <Grid>
          <Toggle label={t('admin.apps.fReadyEarly')} value={e.readyForEarly} onChange={v => set('readyForEarly', v)} />
          <Text label={t('admin.apps.fVideo')} value={e.videoUrl ?? ''} type="url" onChange={v => set('videoUrl', v)} />
        </Grid>
      </Section>

      <Section title={t('admin.apps.sCapacity')}>
        <Long label={t('admin.apps.fRegions')} value={e.regions} rows={2} onChange={v => set('regions', v)} invalid={bad('regions')} />
        <Grid>
          <Choice label={t('admin.apps.fConcurrent')} value={e.concurrentProjects} onChange={v => set('concurrentProjects', v)} invalid={bad('concurrentProjects')}
                  options={CONCURRENT_KEYS.map(k => ({ key: k, label: f(`concurrent.${k}`) }))} />
        </Grid>
      </Section>

      {bar}
    </form>
  );
}

// ── Primitives ─────────────────────────────────────────────────────────────────────

const inputCls = (invalid?: boolean) => cn(
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20',
  invalid ? 'border-state-alert' : 'border-brand-border-grey',
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-brand-border-grey bg-white">
      <h2 className="border-b border-brand-off-white px-5 py-3 text-sm font-semibold text-brand-near-black">{title}</h2>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">{children}</div>;
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{children}</span>;
}

function Text({ label, value, onChange, type = 'text', invalid }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; invalid?: boolean;
}) {
  return (
    <label className="block py-1">
      <Lbl>{label}</Lbl>
      <input type={type} value={value} onChange={ev => onChange(ev.target.value)} aria-invalid={invalid || undefined} className={inputCls(invalid)} />
    </label>
  );
}

function Long({ label, value, onChange, rows = 4, invalid }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; invalid?: boolean;
}) {
  return (
    <label className="block py-1">
      <Lbl>{label}</Lbl>
      <textarea rows={rows} value={value} onChange={ev => onChange(ev.target.value)} aria-invalid={invalid || undefined} className={inputCls(invalid)} />
    </label>
  );
}

function Choice({ label, value, onChange, options, invalid }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[]; invalid?: boolean;
}) {
  // A stored value the list no longer carries is still shown, so saving does not
  // silently change what the applicant said.
  const known = options.some(o => o.key === value);
  return (
    <label className="block py-1">
      <Lbl>{label}</Lbl>
      <select value={value} onChange={ev => onChange(ev.target.value)} aria-invalid={invalid || undefined} className={inputCls(invalid)}>
        <option value="">—</option>
        {!known && value && <option value={value}>{value}</option>}
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className="py-1">
      <Lbl>{label}</Lbl>
      <div className="flex gap-2">
        {[true, false].map(v => (
          <button key={String(v)} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
                  className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium',
                    value === v ? 'border-brand-near-black bg-brand-near-black text-white' : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white')}>
            {v ? t('admin.apps.yes') : t('admin.apps.no')}
          </button>
        ))}
      </div>
    </div>
  );
}

function Checks({ label, options, selected, onToggle, invalid }: {
  label: string; options: { key: string; label: string }[]; selected: string[];
  onToggle: (k: string) => void; invalid?: boolean;
}) {
  return (
    <fieldset className="py-1">
      <legend className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{label}</legend>
      <div className={cn('flex flex-wrap gap-2', invalid && 'rounded-lg ring-1 ring-state-alert p-1')}>
        {options.map(o => {
          const on = selected.includes(o.key);
          return (
            <label key={o.key} className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium',
              on ? 'border-brand-near-black bg-brand-near-black text-white' : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white')}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(o.key)} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One stored credential answer, edited with the control its type implies. */
function CredentialField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  const label = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  if (typeof value === 'boolean') return <Toggle label={label} value={value} onChange={onChange} />;
  if (Array.isArray(value)) {
    return <Text label={`${label} (comma-separated)`} value={value.map(String).join(', ')}
                 onChange={v => onChange(v.split(',').map(s => s.trim()).filter(Boolean))} />;
  }
  const str = value == null ? '' : String(value);
  return str.length > 60
    ? <Long label={label} value={str} onChange={onChange} />
    : <Text label={label} value={str} onChange={onChange} />;
}
