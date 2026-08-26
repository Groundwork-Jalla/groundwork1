import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Upload, X, Plus, Info, AlertTriangle, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useLanguage, type TKey } from '@/lib/i18n';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { isValidEmail } from '@/lib/email/is-valid-email';
import {
  CONTRACTOR_ROLES, credentialTrack, qualifies, submitContractorApplication,
  uploadCredential,
  type ContractorApplicationInput, type ContractorRole,
  type ProjectEntry, type UploadedFile,
} from '@/lib/supabase/contractor-applications';
import {
  clearDraftId, draftId, markDraftSubmitted, saveApplicationDraft,
} from '@/lib/supabase/application-drafts';

// ── Shared field primitives ───────────────────────────────
// Deliberately mirrors the auth form: Label above Input, 1.5 gap, same Input
// component. A form should look like a Groundwork form wherever it appears.

function Field({ label, hint, required, htmlFor, children }: {
  label: string; hint?: string; required?: boolean; htmlFor?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-state-alert">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-brand-mid-grey">{hint}</p>}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5 pt-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-[11px] font-bold text-white tabular-nums">
          {n}
        </span>
        <h3 className="text-sm font-bold text-brand-near-black">{title}</h3>
        <div className="flex-1 h-px bg-brand-border-grey" />
      </div>
      {children}
    </section>
  );
}

function Textarea({ id, value, onChange, rows = 3 }: {
  id?: string; value: string; onChange: (v: string) => void; rows?: number;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex w-full min-w-0 rounded-md border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black resize-y"
    />
  );
}

function Select({ id, value, onChange, children }: {
  id?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex h-10 w-full min-w-0 rounded-md border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black outline-none transition-colors focus-visible:border-brand-near-black"
    >
      {children}
    </select>
  );
}

function YesNo({ label, value, onChange }: {
  label: string; value: boolean | null; onChange: (v: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label>{label}<span className="text-state-alert">*</span></Label>
      <div className="flex gap-2">
        {[true, false].map(v => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
              value === v
                ? 'border-brand-near-black bg-brand-near-black text-white'
                : 'border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-near-black',
            )}
          >
            {v ? t('contractorApply.form.yes') : t('contractorApply.form.no')}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckGroup({ label, options, selected, onToggle, required }: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}{required && <span className="text-state-alert"> *</span>}
      </Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {options.map(o => {
          const on = selected.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onToggle(o.key)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                on ? 'border-brand-near-black bg-brand-off-white text-brand-near-black'
                   : 'border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-near-black',
              )}
            >
              <span className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border',
                on ? 'border-brand-near-black bg-brand-near-black' : 'border-brand-border-grey',
              )}>
                {on && <CheckCircle2 className="size-3 text-white" />}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const emptyProject = (): ProjectEntry => ({
  name: '', location: '', budget: '', role: '', year: '',
  refName: '', refPhone: '', refEmail: '',
});

// ── Main form ─────────────────────────────────────────────

export default function ContractorApplicationForm({ onSuccess }: { onSuccess?: () => void }) {
  const { t, lang } = useLanguage();
  const f = (k: string, p?: Record<string, string | number>) =>
    t(`contractorApply.form.${k}` as TKey, p);

  // Section 1
  const [fullName, setFullName]         = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone]               = useState('');
  const [email, setEmail]               = useState('');
  const [country, setCountry]           = useState(DEFAULT_COUNTRY_CODE);
  const [city, setCity]                 = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  // Section 2
  const [role, setRole]           = useState<ContractorRole | ''>('');
  const [roleOther, setRoleOther] = useState('');
  // Section 3
  const [years, setYears]             = useState('');
  const [operatesAs, setOperatesAs]   = useState('');
  const [teamSize, setTeamSize]       = useState('');
  const [projectTypes, setProjectTypes] = useState<string[]>([]);
  // Section 4
  const [cred, setCred]       = useState<Record<string, string | string[] | boolean>>({});
  const [files, setFiles]     = useState<UploadedFile[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Section 5
  const [projects, setProjects] = useState<ProjectEntry[]>([emptyProject(), emptyProject(), emptyProject()]);
  // Section 6
  const [milestones, setMilestones]     = useState<boolean | null>(null);
  const [verification, setVerification] = useState<boolean | null>(null);
  const [noSidePay, setNoSidePay]       = useState<boolean | null>(null);
  // Section 7
  const [videoUrl, setVideoUrl]             = useState('');
  const [whyJoin, setWhyJoin]               = useState('');
  const [differentiator, setDifferentiator] = useState('');
  const [readyEarly, setReadyEarly]         = useState<boolean | null>(null);
  // Section 8
  const [regions, setRegions]       = useState('');
  const [concurrent, setConcurrent] = useState('');
  // Section 9
  const [agreed, setAgreed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [done, setDone]             = useState(false);

  // ── Draft capture ───────────────────────────────────────
  // This form asks for nineteen things, three past projects and a document upload.
  // Everyone who starts it and stops half way is a contractor we wanted and never hear
  // from again. So what has been typed is written server-side as they go, and the
  // notice rendered under the header is what makes that honest — it is part of the
  // feature, not decoration. See supabase/migrations/043_application_drafts.sql.
  const draftRef = useRef(draftId());
  const [draftSaved, setDraftSaved] = useState(false);

  const track = role ? credentialTrack(role) : null;
  const setC = (k: string, v: string | string[] | boolean) => setCred(p => ({ ...p, [k]: v }));
  const toggleIn = (arr: string[], k: string) =>
    arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k];

  const willDisqualify =
    milestones === false || verification === false || noSidePay === false;

  // Everything the form holds, in one object. Serialised rather than listed as
  // twenty-odd effect dependencies — what the autosave needs to know is "something
  // changed", not which thing. File contents are not included; only their names, since
  // the credential bucket is the place for the files themselves.
  const snapshot = {
    fullName, businessName, phone, email, country, city, portfolioUrl,
    role, roleOther, years, operatesAs, teamSize, projectTypes,
    credentials: cred,
    uploads: files.map(x => x.label), pendingUploads: pending.map(x => x.name),
    projects, milestones, verification, noSidePay,
    videoUrl, whyJoin, differentiator, readyEarly, regions, concurrent, agreed,
  };
  const serialised = JSON.stringify(snapshot);

  // The same conditions handleSubmit enforces, counted rather than checked. Keeping the
  // two lists side by side is what stops the progress figure drifting away from what
  // actually blocks submission — an admin chasing someone shown at 95% should find them
  // one field short, not ten.
  const complete = [
    !!fullName, !!businessName, !!phone, !!email, !!country, !!city, !!role,
    !!years, !!operatesAs, !!whyJoin, !!differentiator, !!regions, !!concurrent,
    projectTypes.length > 0,
    files.length + pending.length > 0,
    // A project only counts once its reference is contactable — see handleSubmit, which
    // enforces the same three conditions. References are verified before anyone is
    // accepted, so an unreachable one makes the project useless as evidence.
    projects.filter(p => p.name.trim() && p.location.trim() && isValidEmail(p.refEmail.trim())).length >= 3,
    milestones !== null, verification !== null, noSidePay !== null,
    readyEarly !== null, agreed,
  ];
  const progressPct = Math.round((100 * complete.filter(Boolean).length) / complete.length);

  useEffect(() => {
    // No contact detail means nothing to follow up on, and it also stops a row being
    // created for every visitor who merely opens the page and reads it.
    if (done || (!email.trim() && !phone.trim())) return;

    // Two seconds after they stop typing, not on every keystroke.
    const timer = setTimeout(() => {
      void saveApplicationDraft(draftRef.current, {
        fullName, email, phone, role: role || undefined,
        payload: snapshot, progressPct,
      }).then(ok => { if (ok) setDraftSaved(true); });
    }, 2_000);
    return () => clearTimeout(timer);
    // `serialised` stands in for every field in `snapshot`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, done]);

  function updateProject(i: number, patch: Partial<ProjectEntry>) {
    setProjects(p => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fullName || !businessName || !phone || !email || !country || !city || !role
      || !years || !operatesAs || !whyJoin || !differentiator
      || !regions || !concurrent || !agreed
      || milestones === null || verification === null || noSidePay === null
      || readyEarly === null) {
      setError(f('errorRequired'));
      return;
    }
    if (!isValidEmail(email)) {
      setError(f('errorEmail'));
      return;
    }
    if (projectTypes.length === 0) {
      setError(f('errorProjectTypes'));
      return;
    }
    // Credentials are what makes an application reviewable — a role's documents are
    // the only evidence behind every other claim on the form. Checked before the
    // upload loop so nobody waits on a transfer only to be told it was needed.
    if (files.length + pending.length === 0) {
      setError(f('errorDocuments'));
      return;
    }
    // Indexes are kept against `projects`, not against a filtered copy, because every
    // number in these messages is a row the applicant has to scroll back to. Saying
    // "project 2" about the second *surviving* row sends them to the wrong card.
    const touched = (p: ProjectEntry) => Object.values(p).some(v => v.trim());
    const isFilled = (p: ProjectEntry) => !!(p.name.trim() && p.location.trim());

    const filled = projects.filter(isFilled);
    if (filled.length < 3) {
      // A row with a reference typed into it but no name or location is dropped by the
      // count, so a bare "add three projects" would be read as "the three I entered
      // didn't count" with nothing to act on. Name the half-finished row instead.
      const partial = projects.findIndex(p => touched(p) && !isFilled(p));
      setError(partial === -1 ? f('errorProjects') : f('errorProjectIncomplete', { n: partial + 1 }));
      return;
    }
    // Separate from the count so the two failures read differently: "you gave us fewer
    // than three projects" and "project 2's reference cannot be reached" are different
    // problems, and one message covering both tells the applicant neither.
    const unreachable = projects.findIndex(p => isFilled(p) && !isValidEmail(p.refEmail.trim()));
    if (unreachable !== -1) {
      setError(f('errorRefEmail', { n: unreachable + 1 }));
      return;
    }

    setSubmitting(true);
    try {
      // Upload credentials first so their storage paths are part of the saved row.
      // A submission id namespaces them; the bucket is private and write-only.
      const submissionId = crypto.randomUUID();
      const uploaded: UploadedFile[] = [...files];
      for (const file of pending) {
        try {
          uploaded.push(await uploadCredential(file, file.name, submissionId));
        } catch {
          // One failed attachment among several must not cost someone their whole
          // application — the rest still arrive and an admin can chase the gap.
        }
      }

      // But documents are mandatory now, so an application with none of them is not
      // reviewable. Losing every upload means the transfer failed, not that they had
      // nothing to send; submitting silently would look like success and produce an
      // application no admin could act on.
      if (uploaded.length === 0) {
        setSubmitting(false);
        setError(f('errorUploadFailed'));
        return;
      }

      const input: ContractorApplicationInput = {
        fullName, businessName, phone, email, country, city, portfolioUrl,
        role: role as ContractorRole, roleOther,
        yearsExperience: years, operatesAs, teamSize, projectTypes,
        credentials: cred, uploads: uploaded,
        projects: filled,
        acceptsMilestones: milestones, acceptsVerification: verification,
        acceptsNoSidePay: noSidePay,
        videoUrl, whyJoin, differentiator, readyForEarly: readyEarly,
        regions, concurrentProjects: concurrent,
        agreedToTerms: agreed,
        lang,
      };

      const applicationId = await submitContractorApplication(input);

      // Ties the draft to the finished application, which is what takes this person off
      // the follow-up list. Fire-and-forget for the same reason as the mail below: they
      // are already through, and a bookkeeping failure must not read as a failed submit.
      void markDraftSubmitted(draftRef.current, applicationId);
      clearDraftId();

      // Sends the applicant's copy AND the alert to the team inbox. Fire-and-forget:
      // the application is already saved and a mail failure must not read as a failed
      // submission. Only the id is sent — the endpoint derives both recipients from the
      // stored row, so this cannot be used to send mail to an arbitrary address.
      void fetch('/api/contractor-application-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
        keepalive: true,
      }).catch(() => { /* logged server-side; the applicant is already through */ });

      setDone(true);
      onSuccess?.();
    } catch {
      setError(f('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success ─────────────────────────────────────────────
  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="text-center py-10 px-4"
      >
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-near-black mb-5">
          <CheckCircle2 className="size-7 text-white" />
        </span>
        <h3 className="font-sans text-xl font-bold text-brand-near-black">{f('successTitle')}</h3>
        <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed max-w-sm mx-auto">
          {f('successBody')}
        </p>
      </motion.div>
    );
  }

  const roleOpts  = CONTRACTOR_ROLES.map(r => ({ key: r, label: f(`role.${r}`) }));
  const typeKeys  = ['residential','multi_family','commercial','renovations','land','legal','infrastructure','other'];
  const legalKeys = ['land_verification','contract_drafting','property_transfer','dispute_resolution','title_review','other'];

  return (
    // noValidate: the browser's own bubbles would otherwise pre-empt handleSubmit for
    // every type="email"/type="url" field here, and they are untranslated and point at a
    // field that is usually scrolled off-screen. This form already writes its own message
    // for each of those cases — errorEmail existed and was unreachable until now.
    <form onSubmit={handleSubmit} noValidate className="space-y-7">
      {/* Header */}
      <div>
        <h2 className="font-sans text-xl font-bold text-brand-near-black leading-snug">{f('title')}</h2>
        <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">{f('subtitle')}</p>
        <p className="text-xs text-brand-mid-grey mt-3">{f('forIntro')}</p>
        <p className="text-xs font-medium text-brand-near-black mt-1 leading-relaxed">{f('forList')}</p>
        <div className="flex items-start gap-2 rounded-xl bg-brand-off-white px-4 py-3 mt-4">
          <Info className="size-4 text-brand-mid-grey mt-0.5 shrink-0" />
          <p className="text-[11px] text-brand-mid-grey leading-relaxed">{f('noGuarantee')}</p>
        </div>
        {/* The disclosure for the autosave above. Shown before any field, not buried at
            the bottom, because it has to be read before it is true of anything typed. */}
        <div className="flex items-start gap-2 mt-3">
          <Save className="size-3.5 text-brand-mid-grey mt-px shrink-0" />
          <p className="text-[11px] text-brand-mid-grey leading-relaxed">
            {f('draftNotice')}
            {draftSaved && (
              <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-brand-near-black">
                <CheckCircle2 className="size-3" />{f('draftSaved')}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 1 — Basic information */}
      <Section n={1} title={f('s1')}>
        <Field label={f('fullName')} required htmlFor="ca-name">
          <Input id="ca-name" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label={f('businessName')} required htmlFor="ca-biz">
          <Input id="ca-biz" required value={businessName} onChange={e => setBusinessName(e.target.value)} autoComplete="organization" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={f('phone')} required htmlFor="ca-phone">
            <Input id="ca-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
          <Field label={f('email')} required htmlFor="ca-email">
            <Input id="ca-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={f('country')} required htmlFor="ca-country">
            <Select id="ca-country" value={country} onChange={setCountry}>
              <option value="">—</option>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={f('city')} required htmlFor="ca-city">
            <Input id="ca-city" value={city} onChange={e => setCity(e.target.value)} />
          </Field>
        </div>
        <Field label={f('portfolio')} hint={f('portfolioHint')} htmlFor="ca-portfolio">
          <Input id="ca-portfolio" type="url" value={portfolioUrl} onChange={e => setPortfolioUrl(e.target.value)} placeholder="https://" />
        </Field>
      </Section>

      {/* 2 — Professional category */}
      <Section n={2} title={f('s2')}>
        <Field label={f('roleQ')} required htmlFor="ca-role">
          <Select id="ca-role" value={role} onChange={v => setRole(v as ContractorRole)}>
            <option value="">{f('rolePlaceholder')}</option>
            {roleOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        </Field>
        {role === 'other' && (
          <Field label={f('roleOther')} htmlFor="ca-role-other">
            <Input id="ca-role-other" value={roleOther} onChange={e => setRoleOther(e.target.value)} />
          </Field>
        )}
      </Section>

      {/* 3 — Experience & operations */}
      <Section n={3} title={f('s3')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={f('yearsQ')} required htmlFor="ca-years">
            <Select id="ca-years" value={years} onChange={setYears}>
              <option value="">—</option>
              {['under1','y1_3','y3_5','y5_10','y10'].map(k => (
                <option key={k} value={k}>{f(`years.${k}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={f('operatesQ')} required htmlFor="ca-operates">
            <Select id="ca-operates" value={operatesAs} onChange={setOperatesAs}>
              <option value="">—</option>
              {['registered','independent','small_team','larger_firm'].map(k => (
                <option key={k} value={k}>{f(`operates.${k}`)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={f('teamSize')} hint={f('optional')} htmlFor="ca-team">
          <Input id="ca-team" value={teamSize} onChange={e => setTeamSize(e.target.value)} inputMode="numeric" />
        </Field>
        <CheckGroup
          label={f('projectTypesQ')}
          required
          options={typeKeys.map(k => ({ key: k, label: f(`projectType.${k}`) }))}
          selected={projectTypes}
          onToggle={k => setProjectTypes(p => toggleIn(p, k))}
        />
      </Section>

      {/* 4 — Credentials (dynamic by role) */}
      {track && (
        <Section n={4} title={f('s4')}>
          <div className="rounded-xl bg-brand-off-white px-4 py-3">
            <p className="text-[11px] font-semibold text-brand-near-black mb-1">
              {f('uploadsTitle')}
              <span className="text-state-alert"> *</span>
              <span className="ml-1.5 font-medium text-brand-mid-grey">{f('uploadsRequired')}</span>
            </p>
            <p className="text-[11px] text-brand-mid-grey leading-relaxed">
              {track === 'contractor' ? f('upContractor')
                : track === 'lawyer'  ? f('upLawyer')
                : track === 'technical' ? f('upTechnical')
                : f('upTrade')}
            </p>
            {/* The input has always accepted several files and repeated picks accumulate,
                but nothing said so — the plurality was only implied by "documents",
                "Choose files" and "max 10 MB each". */}
            <p className="text-[11px] text-brand-mid-grey leading-relaxed mt-1.5">
              {f('uploadMultiple')}
            </p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={e => {
                const picked = Array.from(e.target.files ?? []);
                setPending(p => [...p, ...picked]);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs font-medium text-brand-near-black hover:border-brand-near-black transition-colors"
            >
              <Upload className="size-3.5" /> {f('uploadCta')}
            </button>
            <p className="text-[10px] text-brand-mid-grey mt-1.5">
              {f('uploadHint')}
              {/* `uploadedCount` was already translated in both dictionaries and wired to
                  nothing. It demonstrates the multi-file behaviour rather than only
                  asserting it. */}
              {pending.length > 0 && <> · {f('uploadedCount', { n: pending.length })}</>}
            </p>

            {pending.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {pending.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-brand-border-grey bg-white px-3 py-1.5">
                    <span className="flex-1 truncate text-[11px] text-brand-near-black">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setPending(p => p.filter((_, x) => x !== i))}
                      className="text-brand-mid-grey hover:text-brand-near-black shrink-0"
                      aria-label={f('removeFile')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {track === 'contractor' && (
            <>
              <Field label={f('avgProjectQ')} htmlFor="ca-avg">
                <Select id="ca-avg" value={(cred.avgProject as string) ?? ''} onChange={v => setC('avgProject', v)}>
                  <option value="">—</option>
                  {['under20','k20_50','k50_100','over100'].map(k => (
                    <option key={k} value={f(`avgProject.${k}`)}>{f(`avgProject.${k}`)}</option>
                  ))}
                </Select>
              </Field>
              <YesNo label={f('diasporaQ')} value={(cred.diaspora as boolean) ?? null} onChange={v => setC('diaspora', v)} />
              <Field label={f('paymentStructureQ')} htmlFor="ca-pay">
                <Textarea id="ca-pay" value={(cred.paymentStructure as string) ?? ''} onChange={v => setC('paymentStructure', v)} />
              </Field>
            </>
          )}

          {track === 'lawyer' && (
            <>
              <CheckGroup
                label={f('legalServicesQ')}
                options={legalKeys.map(k => ({ key: k, label: f(`legalService.${k}`) }))}
                selected={(cred.legalServices as string[]) ?? []}
                onToggle={k => setC('legalServices', toggleIn((cred.legalServices as string[]) ?? [], k))}
              />
              <YesNo label={f('diasporaPropertyQ')} value={(cred.diasporaProperty as boolean) ?? null} onChange={v => setC('diasporaProperty', v)} />
            </>
          )}

          {track === 'technical' && (
            <>
              <Field label={f('servicesQ')} htmlFor="ca-services">
                <Textarea id="ca-services" value={(cred.services as string) ?? ''} onChange={v => setC('services', v)} />
              </Field>
              <Field label={f('softwareQ')} hint={f('optional')} htmlFor="ca-software">
                <Input id="ca-software" value={(cred.software as string) ?? ''} onChange={e => setC('software', e.target.value)} />
              </Field>
            </>
          )}

          {track === 'trade' && (
            <>
              <Field label={f('tradeProjectsQ')} htmlFor="ca-trade">
                <Textarea id="ca-trade" value={(cred.tradeProjects as string) ?? ''} onChange={v => setC('tradeProjects', v)} />
              </Field>
              <Field label={f('workStyleQ')} htmlFor="ca-workstyle">
                <Select id="ca-workstyle" value={(cred.workStyle as string) ?? ''} onChange={v => setC('workStyle', v)}>
                  <option value="">—</option>
                  {['independently','under','both'].map(k => (
                    <option key={k} value={f(`workStyle.${k}`)}>{f(`workStyle.${k}`)}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </Section>
      )}

      {/* 5 — Project history */}
      <Section n={5} title={f('s5')}>
        <p className="text-xs text-brand-mid-grey">{f('projectsIntro')}</p>
        {projects.map((p, i) => (
          <div key={i} className="rounded-xl border border-brand-border-grey p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-brand-near-black">{f('projectN', { n: i + 1 })}</p>
              {projects.length > 3 && (
                <button
                  type="button"
                  onClick={() => setProjects(ps => ps.filter((_, x) => x !== i))}
                  className="text-[11px] text-brand-mid-grey hover:text-brand-near-black underline underline-offset-2"
                >
                  {f('removeProject')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={f('projName')} required><Input value={p.name} onChange={e => updateProject(i, { name: e.target.value })} /></Field>
              <Field label={f('projLocation')} required><Input value={p.location} onChange={e => updateProject(i, { location: e.target.value })} /></Field>
              <Field label={f('projBudget')}><Input value={p.budget} onChange={e => updateProject(i, { budget: e.target.value })} /></Field>
              <Field label={f('projRole')}><Input value={p.role} onChange={e => updateProject(i, { role: e.target.value })} /></Field>
              <Field label={f('projYear')}><Input value={p.year} onChange={e => updateProject(i, { year: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <p className="text-[11px] font-semibold text-brand-mid-grey pt-1">{f('refTitle', { n: i + 1 })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={f('refName')}><Input value={p.refName} onChange={e => updateProject(i, { refName: e.target.value })} /></Field>
              <Field label={f('refPhone')}><Input value={p.refPhone} onChange={e => updateProject(i, { refPhone: e.target.value })} type="tel" /></Field>
              {/* Required, unlike name and phone: references are verified before anyone is
                  accepted, and an address is the one contact detail we can actually use
                  from here. It was optional and was arriving blank. The asterisk is the
                  only marker — no `required` attribute, matching projName/projLocation, so
                  the message stays ours and stays translated instead of a native bubble. */}
              <Field label={f('refEmail')} required><Input value={p.refEmail} onChange={e => updateProject(i, { refEmail: e.target.value })} type="email" /></Field>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setProjects(p => [...p, emptyProject()])}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-near-black hover:underline underline-offset-4"
        >
          <Plus className="size-3.5" /> {f('addProject')}
        </button>
      </Section>

      {/* 6 — Professional standards */}
      <Section n={6} title={f('s6')}>
        <YesNo label={f('milestonesQ')}   value={milestones}   onChange={setMilestones} />
        <YesNo label={f('verificationQ')} value={verification} onChange={setVerification} />
        <YesNo label={f('noSidePayQ')}    value={noSidePay}    onChange={setNoSidePay} />
        {willDisqualify && (
          <div className="flex items-start gap-2.5 rounded-xl border border-state-held/30 bg-brand-off-white px-4 py-3">
            <AlertTriangle className="size-4 text-state-held mt-0.5 shrink-0" />
            <p className="text-[11px] text-state-held leading-relaxed">{f('disqualifyWarn')}</p>
          </div>
        )}
      </Section>

      {/* 7 — Future alignment */}
      <Section n={7} title={f('s7')}>
        <p className="text-xs text-brand-mid-grey leading-relaxed">{f('videoIntro')}</p>
        <Field label={f('videoUrl')} hint={f('videoHint')} htmlFor="ca-video">
          <Input id="ca-video" type="url" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label={f('whyJoinQ')} required htmlFor="ca-why">
          <Textarea id="ca-why" rows={4} value={whyJoin} onChange={setWhyJoin} />
        </Field>
        <Field label={f('differentiatorQ')} required htmlFor="ca-diff">
          <Textarea id="ca-diff" rows={4} value={differentiator} onChange={setDifferentiator} />
        </Field>
        <YesNo label={f('readyQ')} value={readyEarly} onChange={setReadyEarly} />
      </Section>

      {/* 8 — Regional capacity */}
      <Section n={8} title={f('s8')}>
        <Field label={f('regionsQ')} required htmlFor="ca-regions">
          <Textarea id="ca-regions" rows={2} value={regions} onChange={setRegions} />
        </Field>
        <Field label={f('concurrentQ')} required htmlFor="ca-concurrent">
          <Select id="ca-concurrent" value={concurrent} onChange={setConcurrent}>
            <option value="">—</option>
            {['one','two_three','four_five','five_plus'].map(k => (
              <option key={k} value={k}>{f(`concurrent.${k}`)}</option>
            ))}
          </Select>
        </Field>
      </Section>

      {/* 9 — Final agreement */}
      <Section n={9} title={f('s9')}>
        <div className="rounded-xl bg-brand-off-white px-4 py-3">
          <p className="text-xs font-semibold text-brand-near-black mb-2">{f('agreeIntro')}</p>
          <ul className="space-y-1.5">
            {['agree1','agree2','agree3','agree4'].map(k => (
              <li key={k} className="flex items-start gap-2 text-[11px] text-brand-mid-grey leading-relaxed">
                <span className="mt-1.5 size-1 rounded-full bg-brand-mid-grey shrink-0" />
                {f(k)}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={() => setAgreed(a => !a)}
          className="flex items-start gap-2.5 text-left w-full"
        >
          <span className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
            agreed ? 'border-brand-near-black bg-brand-near-black' : 'border-brand-border-grey',
          )}>
            {agreed && <CheckCircle2 className="size-3 text-white" />}
          </span>
          <span className="text-xs text-brand-near-black">
            {f('agreeCheckbox')}<span className="text-state-alert">*</span>
          </span>
        </button>
      </Section>

      {/* Submit */}
      <div className="pt-2 space-y-3">
        {error && (
          <p className="text-xs text-state-alert bg-brand-off-white rounded-lg px-3 py-2">{error}</p>
        )}
        <Button type="submit" disabled={submitting} className="w-full h-auto py-3.5 font-semibold">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? f('submitting') : f('submit')}
        </Button>
        <p className="text-[11px] text-brand-mid-grey text-center leading-relaxed">{f('reviewNote')}</p>
      </div>
    </form>
  );
}
