import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Phone,
  Globe,
  Upload,
  Check,
  Loader2,
  Camera,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { loadClientContact, saveClientPhone, syncPhoneToCrm } from '@/lib/supabase/client-contact';
import { supabase } from '@/lib/supabase/client';
import { createSupportTicket } from '@/lib/supabase/support';
import { Button } from '@/components/ui/button';
import { hasPassword, requestEmailChange } from '@/lib/auth/account-security';
import { cn } from '@/lib/utils';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';
import { fetchAssignedProjects } from '@/lib/supabase/contractor-work';
import { useT, type TKey } from '@/lib/i18n';
import { fetchProjects } from '@/lib/supabase/projects';
import { fetchTeam, type TeamMember } from '@/lib/supabase/invites';
import { TwoFactorSection } from '@/components/profile/TwoFactorSection';

// ── Types ─────────────────────────────────────────────────

interface ProfileMeta {
  displayName: string;
  phone: string;
  country: string;
  idDocumentPath: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type UploadState = 'idle' | 'uploading' | 'done' | 'error';
type ActiveTab = 'profile' | 'account' | 'team' | 'notifications' | 'danger';

interface NotifPrefs {
  stage_approvals: boolean;
  evidence: boolean;
  messages: boolean;
  payments: boolean;
  announcements: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  stage_approvals: true,
  evidence: true,
  messages: true,
  payments: true,
  announcements: true,
};

// ── Completion meter ──────────────────────────────────────

interface CompletionItem {
  label: string;
  filled: boolean;
}

function calcCompletion(meta: ProfileMeta): { pct: number; items: CompletionItem[] } {
  const items: CompletionItem[] = [
    { label: 'Display name',       filled: !!meta.displayName.trim() },
    { label: 'Phone number',        filled: !!meta.phone.trim() },
    { label: 'Country',             filled: !!meta.country.trim() },
    { label: 'Identity document',   filled: !!meta.idDocumentPath },
  ];
  const filled = items.filter(i => i.filled).length;
  return { pct: filled * 25, items };
}

function CompletionMeter({ meta }: { meta: ProfileMeta }) {
  const { pct, items } = calcCompletion(meta);
  const [displayPct, setDisplayPct] = useState(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setDisplayPct(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <div className="mb-8">
      {/* Bar */}
      <div className="h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#2c2c2c] overflow-hidden mb-3">
        <motion.div
          className="h-full rounded-full bg-brand-near-black dark:bg-white"
          initial={{ width: 0 }}
          animate={{ width: `${displayPct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>

      {/* Label */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-brand-near-black dark:text-white">
          Profile {pct}% complete
        </span>
        {pct === 100 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-state-complete bg-brand-off-white border border-state-complete/30 rounded-full px-2.5 py-0.5">
            <Check className="size-3" />
            Complete
          </span>
        )}
      </div>

      {/* Checklist */}
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li key={item.label} className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-full border',
                item.filled
                  ? 'bg-brand-near-black dark:bg-white border-brand-near-black dark:border-white'
                  : 'bg-white dark:bg-brand-dark-grey border-brand-border-grey dark:border-[#2c2c2c]',
              )}
            >
              {item.filled && <Check className="size-2.5 text-white dark:text-brand-near-black" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                'text-sm',
                item.filled ? 'text-brand-near-black dark:text-white' : 'text-brand-mid-grey dark:text-brand-mid-grey',
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Section divider ───────────────────────────────────────

function Divider() {
  return <div className="border-t border-brand-border-grey dark:border-[#2c2c2c] my-8" />;
}

// ── Field wrapper ─────────────────────────────────────────

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey uppercase tracking-wide"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Upload progress bar ───────────────────────────────────

function UploadBar({ progress }: { progress: number }) {
  const t = useT();
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-1">
        <span>{t('common.uploading')}</span>
        <span className="tabular-nums">{Math.round(progress)}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-brand-light-grey dark:bg-[#2c2c2c] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-brand-near-black dark:bg-white"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}

// ── Toggle Switch ─────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black dark:focus-visible:ring-white',
        checked
          ? 'bg-brand-near-black dark:bg-white'
          : 'bg-brand-light-grey dark:bg-[#333]',
      )}
    >
      <motion.span
        className={cn(
          'absolute top-0.5 size-5 rounded-full shadow-sm',
          checked ? 'bg-white dark:bg-brand-near-black' : 'bg-white dark:bg-brand-mid-grey',
        )}
        animate={{ x: checked ? 18 : 2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const t = useT();

  // `?tab=account` from the dashboard's security warning lands on the right tab.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    requestedTab && ['profile', 'account', 'team', 'notifications', 'danger'].includes(requestedTab)
      ? (requestedTab as ActiveTab) : 'profile',
  );
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  // ── Form state ─────────────────────────────────────────
  const [displayName, setDisplayName] = useState(
    user?.user_metadata?.full_name ?? '',
  );
  /**
   * The number lives in `profiles.phone`. It used to be saved only into
   * `user_metadata`, where nothing could read it — so a value found there and nowhere
   * else is offered as the starting value rather than discarded, and becomes canonical
   * the moment this form is saved.
   */
  const [phone, setPhone] = useState('');
  const [phoneLegacy, setPhoneLegacy] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [country, setCountry] = useState(user?.user_metadata?.country ?? DEFAULT_COUNTRY_CODE);
  const [idDocumentPath, setIdDocumentPath] = useState(
    user?.user_metadata?.id_document_path ?? '',
  );
  const idVerified: boolean = !!user?.user_metadata?.id_verified;

  // ── Save state ─────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Upload state ───────────────────────────────────────
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Account tab state ──────────────────────────────────
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');

  // ── Email change ───────────────────────────────────────
  // Editing is a request, not a write: Supabase confirms the new address by link before
  // anything moves. `pendingEmail` is what the account is waiting to become.
  const [newEmail, setNewEmail]           = useState('');
  const [emailState, setEmailState]       = useState<'idle' | 'saving' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError]       = useState('');
  const pendingEmail = (user as { new_email?: string } | null)?.new_email ?? null;
  const passwordExists = hasPassword(user);

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    const next = newEmail.trim().toLowerCase();
    if (!next || next === (user?.email ?? '').toLowerCase()) return;
    setEmailState('saving'); setEmailError('');
    try {
      await requestEmailChange(next);
      setEmailState('sent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setEmailError(msg === 'invalid_email' ? t('profile.emailInvalid') : msg || t('profile.emailFailed'));
      setEmailState('error');
    }
  }

  // ── Notifications tab state ────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(() => {
    try {
      const raw = localStorage.getItem('gw_notif_prefs');
      return raw ? { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) } : DEFAULT_NOTIF_PREFS;
    } catch {
      return DEFAULT_NOTIF_PREFS;
    }
  });

  // ── Danger tab state ───────────────────────────────────
  const [deleteInput, setDeleteInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  // Derived meta for completion meter (tracks live form state)
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    loadClientContact(user.id, user.user_metadata)
      .then(c => {
        if (!alive) return;
        setPhone(c.phone ?? c.legacyPhone ?? '');
        setPhoneLegacy(!c.phone && !!c.legacyPhone);
      })
      .catch(() => { /* the form still works; it just starts empty */ });
    return () => { alive = false; };
  }, [user?.id, user?.user_metadata]);

  const liveMeta: ProfileMeta = { displayName, phone, country, idDocumentPath };

  // ── Cleanup timers ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Persist notif prefs ────────────────────────────────
  useEffect(() => {
    localStorage.setItem('gw_notif_prefs', JSON.stringify(notifPrefs));
  }, [notifPrefs]);

  // ── Save profile ───────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const prev = { displayName, phone, country };
    setSaveState('saving');
    setSaveError('');

    // `profiles.phone` is the canonical field — normalised here, at the write, so what is
    // stored is what a provider can actually send to. A number that cannot be messaged is
    // refused rather than stored looking valid.
    let canonicalPhone: string | null = null;
    if (user?.id) {
      const saved = await saveClientPhone(user.id, phone, country.trim() || null)
        .catch(() => ({ ok: false, problem: 'invalid' } as const));
      if (!saved.ok) {
        setPhoneError(t('profile.phoneInvalid'));
        setSaveState('error');
        return;
      }
      canonicalPhone = saved.phone;
      setPhone(canonicalPhone ?? '');
      setPhoneLegacy(false);
      setPhoneError('');
    }

    // Kept aligned because other account UI still reads it — a copy, never the source.
    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: displayName.trim(),
        phone: canonicalPhone ?? '',
        country: country.trim(),
      },
    });

    if (error) {
      setDisplayName(prev.displayName);
      setPhone(prev.phone);
      setCountry(prev.country);
      setSaveError(error.message);
      setSaveState('error');
      return;
    }

    setSaveState('saved');
    // The CRM contact has to carry the number for WhatsApp to reach it. Fire-and-forget:
    // a CRM that is down must never stop a client recording their own phone number, and
    // the value is already stored by this point.
    if (canonicalPhone) void syncPhoneToCrm();
    savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
  }

  // ── ID upload ──────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File exceeds 5 MB. Please choose a smaller file.');
      return;
    }

    setUploadState('uploading');
    setUploadError('');
    setUploadProgress(0);

    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) { clearInterval(interval); return 90; }
        return prev + 6;
      });
    }, 100);

    const ext = file.name.split('.').pop() ?? 'bin';
    const storagePath = `${user.id}/id_${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('id-documents')
      .upload(storagePath, file, { upsert: true });

    clearInterval(interval);

    if (uploadErr) {
      setUploadProgress(0);
      setUploadState('error');
      setUploadError(uploadErr.message);
      return;
    }

    setUploadProgress(100);

    const { error: metaErr } = await supabase.auth.updateUser({
      data: { id_document_path: storagePath },
    });

    if (metaErr) {
      setUploadState('error');
      setUploadError(metaErr.message);
      return;
    }

    setIdDocumentPath(storagePath);
    setUploadState('done');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Password reset ─────────────────────────────────────
  async function handlePasswordReset() {
    if (!user?.email) return;
    setResetError('');
    // `/auth/callback?flow=recovery`, NOT `/auth/reset-password`.
    //
    // This pointed at the request form — the page whose only job is to ask for an email
    // and send a link. So following the link from here consumed the single-use token and
    // landed the person back on "enter your email address", with no way to set a
    // password and no indication anything had happened. Changing your password from the
    // profile was impossible.
    //
    // `flow=recovery` is what tells /auth/callback this is a reset rather than a sign-in;
    // Supabase's PKCE reply carries no `type` of its own. See reset-password.tsx.
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/callback?flow=recovery`,
    });
    if (error) { setResetError(error.message); return; }
    setResetSent(true);
  }

  // ── Data export ────────────────────────────────────────
  function handleDataExport() {
    const payload = {
      user: {
        id: user?.id,
        email: user?.email,
        metadata: user?.user_metadata,
        createdAt: user?.created_at,
      },
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'groundwork-data-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Account deletion request ───────────────────────────
  /**
   * The word the screen is actually asking for.
   *
   * This was compared against the literal 'DELETE' while the prompt beside it rendered
   * `profile.deleteConfirmWord` — fine for as long as the two happened to be the same
   * string, and a locked door the moment the French one became SUPPRIMER. Compared
   * case-insensitively and trimmed, because the demand here is intent, not typing.
   */
  const deleteWord = t('profile.deleteConfirmWord');
  const deleteConfirmed =
    deleteInput.trim().toLocaleUpperCase() === deleteWord.toLocaleUpperCase();

  async function handleDeleteConfirm() {
    if (!deleteConfirmed) return;
    if (!user?.id || !user?.email) { setDeleteResult(t('profile.deleteFailed')); return; }

    // The swallow that was here promised "our team will process it within 48 hours" while
    // discarding the request — a data-rights ask answered with a sentence and a dropped
    // write. If the request does not land, the person has to be told, because the only
    // thing worse than a failed deletion request is one the sender believes succeeded.
    try {
      await createSupportTicket({
        userId:  user.id,
        kind:    'account_deletion',
        email:   user.email,
        subject: 'Account deletion request',
        message: 'User requested account deletion from the Close account section of their profile.',
      });
    } catch {
      setDeleteResult(t('profile.deleteFailed'));
      return;
    }
    setDeleteResult(t('profile.deleteSubmitted'));
    setShowDeleteConfirm(false);
    setDeleteInput('');
  }

  useEffect(() => {
    if (activeTab !== 'team' || !user || team.length > 0) return;
    setTeamLoading(true);
    fetchProjects(user.id)
      .then(ps => fetchTeam(ps.map(p => p.id)))
      .then(setTeam)
      .catch(() => {})
      .finally(() => setTeamLoading(false));
  }, [activeTab, user, team.length]);

  // ── Tab definitions ────────────────────────────────────
  const tabs: { id: ActiveTab; labelKey: TKey }[] = [
    { id: 'profile',       labelKey: 'profile.tabs.profile'       },
    { id: 'account',       labelKey: 'profile.tabs.account'       },
    { id: 'team',          labelKey: 'profile.tabs.team'          },
    { id: 'notifications', labelKey: 'profile.tabs.notifications' },
    { id: 'danger',        labelKey: 'profile.tabs.danger'        },
  ];

  const inputClass =
    'flex h-10 w-full rounded-md border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-brand-dark-grey pl-9 pr-3 py-2 text-sm text-brand-near-black dark:text-white outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black dark:focus-visible:border-white';

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="bg-brand-off-white dark:bg-[#111] min-h-full">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >

          {/* Avatar + name header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-light-grey dark:bg-[#2c2c2c] text-lg font-bold text-brand-near-black dark:text-white select-none">
              {displayName.trim()
                ? displayName.trim().split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('')
                : <User className="size-6 text-brand-mid-grey" />}
            </div>
            <div>
              <p className="text-base font-bold text-brand-near-black dark:text-white leading-snug">
                {displayName.trim() || 'Your profile'}
              </p>
              <p className="text-sm text-brand-mid-grey dark:text-brand-mid-grey mt-0.5">
                {user?.email}
              </p>
              <ContractorBadges />
            </div>
          </div>

          {/* ── Tab nav ── */}
          <div className="overflow-x-auto mb-8">
            <div className="flex gap-1 border-b border-brand-border-grey dark:border-[#2c2c2c] pb-0 min-w-max">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-4 py-2.5 text-sm whitespace-nowrap transition-colors -mb-px',
                    activeTab === tab.id
                      ? 'border-b-2 border-brand-near-black dark:border-white text-brand-near-black dark:text-white font-semibold'
                      : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
                    tab.id === 'danger' && activeTab !== 'danger' && 'hover:text-state-alert dark:hover:text-state-alert',
                    tab.id === 'danger' && activeTab === 'danger' && 'border-b-2 border-state-alert dark:border-state-alert text-state-alert dark:text-state-alert',
                  )}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab: Profile ── */}
          <AnimatePresence mode="wait">
            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {/* Completion meter */}
                <CompletionMeter meta={liveMeta} />

                <Divider />

                {/* Profile form */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-5">
                    {t('profile.accountDetails')}
                  </h2>

                  <form onSubmit={handleSave} className="flex flex-col gap-4">
                    <Field label={t('fields.displayName')} htmlFor="display-name">
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="display-name"
                          type="text"
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          placeholder={t('profile.yourFullName')}
                          className={inputClass}
                        />
                      </div>
                    </Field>

                    <Field label={t('fields.phoneNumber')} htmlFor="phone">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          placeholder={t('fields.phonePlaceholder')}
                          className={inputClass}
                          aria-describedby="phone-help"
                          aria-invalid={!!phoneError}
                        />
                      </div>
                      <p id="phone-help" className="mt-1 text-[11px] leading-relaxed text-brand-mid-grey">
                        {t('profile.phoneHelp')}
                      </p>
                      {/* Not "verified": nobody has proved they own this number. */}
                      {phoneLegacy && (
                        <p className="mt-1 text-[11px] font-medium text-state-held">{t('profile.phoneLegacy')}</p>
                      )}
                      {phoneError && (
                        <p role="alert" className="mt-1 text-[11px] font-medium text-state-alert">{phoneError}</p>
                      )}
                    </Field>

                    <Field label={t('fields.country')} htmlFor="country">
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="country"
                          type="text"
                          value={country}
                          onChange={e => setCountry(e.target.value)}
                          placeholder={t('fields.countryPlaceholder')}
                          className={inputClass}
                        />
                      </div>
                    </Field>

                    {saveState === 'error' && saveError && (
                      <p className="text-xs text-state-alert bg-brand-off-white border border-state-alert/30 rounded-lg px-3 py-2">
                        {saveError}
                      </p>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        type="submit"
                        disabled={saveState === 'saving'}
                        className={cn(
                          'flex items-center gap-2 rounded-xl text-sm font-semibold px-5 py-2.5 h-auto transition-all',
                          saveState === 'saved'
                            ? 'bg-state-complete hover:bg-state-complete text-white'
                            : 'bg-brand-near-black hover:bg-black text-white',
                        )}
                      >
                        {saveState === 'saving' && <Loader2 className="size-3.5 animate-spin" />}
                        {saveState === 'saved' && <Check className="size-3.5" strokeWidth={3} />}
                        {saveState === 'saved' ? 'Saved' : 'Save changes'}
                      </Button>

                      {saveState === 'idle' && (
                        <span className="text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                          {t('profile.changesSave')}
                        </span>
                      )}
                    </div>
                  </form>
                </section>

                <Divider />

                {/* ID verification section */}
                <section>
                  <div className="flex items-start justify-between gap-4 mb-1">
                    <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
                      {t('profile.identityTitle')}
                    </h2>

                    {idVerified ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-state-complete bg-brand-off-white border border-state-complete/30 rounded-full px-2.5 py-0.5 shrink-0">
                        <Check className="size-3" strokeWidth={3} />
                        {t('profile.identityVerified')}
                      </span>
                    ) : idDocumentPath ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-state-held bg-brand-off-white border border-state-held/30 rounded-full px-2.5 py-0.5 shrink-0">
                        {t('profile.identityPending')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey bg-brand-off-white dark:bg-[#1c1c1c] border border-brand-border-grey dark:border-[#2c2c2c] rounded-full px-2.5 py-0.5 shrink-0">
                        {t('profile.identityNone')}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-brand-mid-grey dark:text-brand-mid-grey mb-5">
                    Upload a government-issued ID — passport, national ID, or driver's licence. Max 5 MB.
                  </p>

                  {idDocumentPath && uploadState !== 'uploading' && (
                    <div className="flex items-center justify-between rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1c1c1c] px-4 py-3 mb-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-near-black dark:bg-white">
                          <Check className="size-3.5 text-white dark:text-brand-near-black" strokeWidth={3} />
                        </span>
                        <span className="text-sm font-medium text-brand-near-black dark:text-white">
                          {t('profile.idUploaded')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white underline underline-offset-2 transition-colors"
                      >
                        {t('profile.reupload')}
                      </button>
                    </div>
                  )}

                  {!idDocumentPath && uploadState !== 'uploading' && uploadState !== 'done' && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1c1c1c] px-4 py-5 text-sm font-medium text-brand-mid-grey hover:border-brand-near-black dark:hover:border-white hover:text-brand-near-black dark:hover:text-white hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-all group"
                    >
                      <Camera className="size-4 group-hover:scale-105 transition-transform" />
                      {t('profile.chooseFile')}
                    </button>
                  )}

                  {uploadState === 'uploading' && <UploadBar progress={uploadProgress} />}

                  {uploadState === 'error' && uploadError && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-xs text-state-alert bg-brand-off-white border border-state-alert/30 rounded-lg px-3 py-2">
                        {uploadError}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadState('idle');
                          setUploadError('');
                          fileInputRef.current?.click();
                        }}
                        className="self-start text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white underline underline-offset-2 transition-colors"
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="sr-only"
                    aria-label={t('profile.uploadIdDocument')}
                  />
                </section>

                <Divider />

                {/* Session */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-3">
                    {t('profile.session')}
                  </h2>
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut();
                      navigate('/', { replace: true });
                    }}
                    className="text-sm text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 transition-colors"
                  >
                    {t('profile.signOut')}
                  </button>
                </section>
              </motion.div>
            )}

            {/* ── Tab: Account ── */}
            {activeTab === 'account' && (
              <motion.div
                key="account"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col"
              >
                {/* Email address — the sign-in identity, so it changes by confirmed link,
                    never by a plain save. */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('profile.emailAddress')}</h2>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-4">{t('profile.emailSubtitle')}</p>

                  <p className="text-xs text-brand-mid-grey mb-1">{t('profile.emailCurrent')}</p>
                  <p className="text-sm text-brand-near-black dark:text-white mb-4">{user?.email}</p>

                  {emailState === 'sent' ? (
                    <p role="status" className="text-xs text-state-complete bg-brand-off-white dark:bg-state-complete/30 border border-state-complete/30 rounded-lg px-3 py-2">
                      {t('profile.emailSent', { email: newEmail.trim().toLowerCase() })}
                    </p>
                  ) : (
                    <form onSubmit={handleEmailChange} className="flex flex-col gap-2">
                      {pendingEmail && pendingEmail !== user?.email && (
                        <p className="text-xs text-state-held bg-brand-off-white border border-state-held/30 rounded-lg px-3 py-2">
                          {t('profile.emailPending', { email: pendingEmail })}
                        </p>
                      )}
                      <Field label={t('profile.emailNew')} htmlFor="new-email">
                        <input
                          id="new-email" type="email" autoComplete="email"
                          value={newEmail} onChange={e => setNewEmail(e.target.value)}
                          placeholder={t('profile.emailNewPlaceholder')}
                          className={inputClass}
                        />
                      </Field>
                      {emailState === 'error' && emailError && (
                        <p className="text-xs text-state-alert bg-brand-off-white border border-state-alert/30 rounded-lg px-3 py-2">
                          {emailError}
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={emailState === 'saving' || !newEmail.trim() || newEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase()}
                        className="self-start text-sm font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors disabled:opacity-40"
                      >
                        {emailState === 'saving' ? t('profile.emailSaving') : t('profile.emailUpdate')}
                      </button>
                      <p className="text-xs text-brand-mid-grey">{t('profile.emailHow')}</p>
                    </form>
                  )}
                </section>

                <div className="border-t border-brand-border-grey dark:border-[#2c2c2c] my-6" />

                {/* Password */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('profile.password')}</h2>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-4">
                    {t(passwordExists ? 'profile.passwordBody' : 'profile.passwordNoneBody')}
                  </p>

                  {!passwordExists ? (
                    // Signed in with Google: the session is live, so a password can be set
                    // directly — no reset link, no waiting on an inbox.
                    <Link
                      to="/auth/new-password?reason=google"
                      className="inline-flex self-start items-center rounded-xl bg-brand-near-black px-4 py-2 text-sm font-semibold text-white hover:bg-black transition-colors"
                    >
                      {t('profile.setPassword')}
                    </Link>
                  ) : resetSent ? (
                    <p className="text-xs text-state-complete dark:text-state-complete bg-brand-off-white dark:bg-state-complete/30 border border-state-complete/30 dark:border-state-complete/50 rounded-lg px-3 py-2">
                      Reset link sent to {user?.email}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handlePasswordReset}
                        className="self-start text-sm font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors"
                      >
                        {t('profile.sendResetLink')}
                      </button>
                      {resetError && (
                        <p className="text-xs text-state-alert bg-brand-off-white border border-state-alert/30 rounded-lg px-3 py-2">
                          {resetError}
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <div className="border-t border-brand-border-grey dark:border-[#2c2c2c] my-6" />

                {/* 2FA — TOTP via Supabase MFA. Was a "Coming soon" badge. */}
                <TwoFactorSection />
              </motion.div>
            )}

            {/* ── Tab: Notifications ── */}
            {activeTab === 'team' && (
              <motion.div
                key="team"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col"
              >
                <section>
                  <h2 className="mb-1 text-sm font-semibold text-brand-near-black dark:text-white">{t('profile.team.title')}</h2>
                  <p className="mb-4 text-xs text-brand-mid-grey">{t('profile.team.subtitle')}</p>

                  {teamLoading ? (
                    <div className="flex flex-col gap-2">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="h-14 animate-pulse rounded-xl bg-brand-light-grey dark:bg-[#252525]" />
                      ))}
                    </div>
                  ) : team.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-brand-border-grey px-5 py-10 text-center dark:border-[#2c2c2c]">
                      <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('profile.team.emptyTitle')}</p>
                      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-mid-grey">{t('profile.team.emptyBody')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {team.map(m => (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 rounded-xl border border-brand-border-grey bg-white p-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-off-white text-[11px] font-bold text-brand-near-black dark:bg-[#252525] dark:text-white">
                            {m.email.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-brand-near-black dark:text-white">{m.email}</p>
                            <p className="truncate text-xs text-brand-mid-grey">
                              {m.project_name || t('profile.team.unknownProject')}
                            </p>
                          </div>
                          <span className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            m.status === 'accepted'
                              ? 'bg-state-complete/10 text-state-complete'
                              : m.status === 'pending'
                                ? 'bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]'
                                : 'bg-brand-off-white text-brand-border-grey dark:bg-[#252525]',
                          )}>
                            {m.status === 'accepted'
                              ? t('profile.team.statusActive')
                              : m.status === 'pending'
                                ? t('profile.team.statusInvited')
                                : t('profile.team.statusDeclined')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {activeTab === 'notifications' && (
              <motion.div
                key="notifications"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('profile.emailNotifications')}</h2>
                <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-6">
                  {t('profile.notificationsBody')}
                </p>

                <div className="flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-brand-dark-grey overflow-hidden">
                  {                  (
                    [
                      { key: 'stage_approvals', label: 'Stage approvals', desc: 'When a stage is approved or rejected' },
                      { key: 'evidence',         label: 'Evidence uploaded', desc: 'When evidence is uploaded to your project' },
                      { key: 'messages',         label: 'New messages',       desc: 'When you receive a project message' },
                      { key: 'announcements',    label: 'Groundwork announcements', desc: 'Product updates and new features' },
                    ] as const
                  ).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div>
                        <p className="text-sm font-medium text-brand-near-black dark:text-white">{label}</p>
                        <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mt-0.5">{desc}</p>
                      </div>
                      <ToggleSwitch
                        checked={notifPrefs[key]}
                        onChange={v => setNotifPrefs(prev => ({ ...prev, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-brand-mid-grey dark:text-brand-mid-grey mt-4 leading-relaxed">
                  {t('profile.notificationsServerSide')}
                </p>
              </motion.div>
            )}

            {/* ── Tab: Danger ── */}
            {activeTab === 'danger' && (
              <motion.div
                key="danger"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <div className="rounded-2xl border border-state-alert/30 dark:border-state-alert/50 bg-brand-off-white dark:bg-state-alert/20 p-6 flex flex-col gap-6">

                  {/* Export data */}
                  <div>
                    <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('profile.exportTitle')}</h2>
                    <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-3">
                      {t('profile.exportBody')}
                    </p>
                    <button
                      type="button"
                      onClick={handleDataExport}
                      className="inline-flex items-center gap-2 text-sm font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 bg-white dark:bg-brand-dark-grey hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors"
                    >
                      {t('profile.exportButton')}
                    </button>
                  </div>

                  <div className="border-t border-state-alert/30 dark:border-state-alert/50" />

                  {/* Delete account */}
                  <div>
                    <h2 className="text-sm font-semibold text-state-alert dark:text-state-alert mb-1">{t('profile.deleteTitle')}</h2>
                    <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-1">
                      {t('profile.deleteBody')}
                    </p>

                    {deleteResult ? (
                      <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey bg-white dark:bg-brand-dark-grey border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg px-3 py-2 mt-3">
                        {deleteResult}
                      </p>
                    ) : showDeleteConfirm ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-xs font-medium text-state-alert dark:text-state-alert">
                          {t('profile.deleteTypePrefix')} <span className="font-mono font-bold">{t('profile.deleteConfirmWord')}</span>
                        </p>
                        <input
                          type="text"
                          value={deleteInput}
                          onChange={e => setDeleteInput(e.target.value)}
                          placeholder={t('profile.deleteConfirmWord')}
                          className="flex h-10 w-full rounded-md border border-state-alert/30 dark:border-state-alert/60 bg-white dark:bg-brand-dark-grey px-3 py-2 text-sm text-brand-near-black dark:text-white outline-none focus-visible:border-state-alert dark:focus-visible:border-state-alert placeholder:text-brand-mid-grey"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                            className="flex-1 h-9 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] text-sm text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            type="button"
                            disabled={!deleteConfirmed}
                            onClick={handleDeleteConfirm}
                            className="flex-1 h-9 rounded-lg bg-state-alert text-sm font-semibold text-white hover:bg-state-alert transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            {t('profile.confirmDeletion')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="mt-3 inline-flex items-center text-sm font-medium text-state-alert dark:text-state-alert border border-state-alert/30 dark:border-state-alert/60 rounded-xl px-4 py-2 hover:bg-brand-off-white dark:hover:bg-state-alert/40 transition-colors"
                      >
                        {t('profile.deleteTitle')}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      </div>
    </div>
  );
}

/**
 * What a contractor's account actually says about them, beside their name.
 *
 * Part of the approved Profile screen (29 Oct 2026). Every badge is a fact read from
 * the database: verified only when onboarding reports complete, and the build count
 * is the number of projects this account can actually see. A read that fails shows
 * no badge rather than a hopeful one — claiming "verified" on a guess is the one
 * mistake this row must never make.
 *
 * Renders nothing for a non-contractor: `contractor_onboarding_status` is theirs.
 */
function ContractorBadges() {
  const t = useT();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [builds, setBuilds] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await onboardingAvailable())) return;
        const status = await fetchOnboardingStatus();
        if (alive) setVerified(status.complete);
      } catch { /* not a contractor, or the read was refused */ }
    })();
    void fetchAssignedProjects()
      .then(rows => { if (alive) setBuilds(rows.length); })
      .catch(() => { /* leave it unsaid */ });
    return () => { alive = false; };
  }, []);

  if (verified === null && builds === null) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {verified === true && (
        <span className="inline-flex items-center gap-1 rounded-full border border-state-complete/35 px-2.5 py-0.5 text-[11px] font-semibold text-state-complete">
          <ShieldCheck className="size-3" aria-hidden />
          {t('profile.verifiedContractor')}
        </span>
      )}
      {builds !== null && builds > 0 && (
        <span className="inline-flex items-center rounded-full border border-brand-border-grey px-2.5 py-0.5 text-[11px] font-medium text-brand-mid-grey dark:border-[#2c2c2c]">
          {t('profile.liveBuilds', { n: builds })}
        </span>
      )}
    </div>
  );
}
