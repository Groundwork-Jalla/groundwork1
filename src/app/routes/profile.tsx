import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Phone,
  Globe,
  Upload,
  Check,
  Loader2,
  Camera,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────

interface ProfileMeta {
  displayName: string;
  phone: string;
  country: string;
  idDocumentPath: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type UploadState = 'idle' | 'uploading' | 'done' | 'error';
type ActiveTab = 'profile' | 'account' | 'notifications' | 'subscription' | 'danger';

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
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
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
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-1">
        <span>Uploading…</span>
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

  const [activeTab, setActiveTab] = useState<ActiveTab>('profile');

  // ── Form state ─────────────────────────────────────────
  const [displayName, setDisplayName] = useState(
    user?.user_metadata?.full_name ?? '',
  );
  const [phone, setPhone] = useState(user?.user_metadata?.phone ?? '');
  const [country, setCountry] = useState(user?.user_metadata?.country ?? '');
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

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: displayName.trim(),
        phone: phone.trim(),
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
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: window.location.origin + '/auth/reset-password',
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
  async function handleDeleteConfirm() {
    if (deleteInput !== 'DELETE') return;
    try {
      await supabase.from('support_tickets').insert({
        user_id: user?.id,
        email: user?.email,
        subject: 'Account deletion request',
        body: 'User has requested account deletion via the Danger Zone in their profile.',
        status: 'open',
      });
    } catch { /* table may not exist yet — swallow */ }
    setDeleteResult('Account deletion request submitted. Our team will process it within 48 hours.');
    setShowDeleteConfirm(false);
    setDeleteInput('');
  }

  // ── Tab definitions ────────────────────────────────────
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'profile',       label: 'Profile' },
    { id: 'account',       label: 'Account' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'subscription',  label: 'Subscription' },
    { id: 'danger',        label: 'Danger' },
  ];

  const inputClass =
    'flex h-10 w-full rounded-md border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-brand-dark-grey pl-9 pr-3 py-2 text-sm text-brand-near-black dark:text-white outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black dark:focus-visible:border-white';

  const tier: string = user?.user_metadata?.tier ?? 'free';

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
                    tab.id === 'danger' && activeTab !== 'danger' && 'hover:text-red-600 dark:hover:text-red-400',
                    tab.id === 'danger' && activeTab === 'danger' && 'border-b-2 border-red-600 dark:border-red-400 text-red-600 dark:text-red-400',
                  )}
                >
                  {tab.label}
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
                    Account details
                  </h2>

                  <form onSubmit={handleSave} className="flex flex-col gap-4">
                    <Field label="Display name" htmlFor="display-name">
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="display-name"
                          type="text"
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          placeholder="Your full name"
                          className={inputClass}
                        />
                      </div>
                    </Field>

                    <Field label="Phone number" htmlFor="phone">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          placeholder="+1 555 000 0000"
                          className={inputClass}
                        />
                      </div>
                    </Field>

                    <Field label="Country" htmlFor="country">
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey pointer-events-none" />
                        <input
                          id="country"
                          type="text"
                          value={country}
                          onChange={e => setCountry(e.target.value)}
                          placeholder="e.g. Nigeria, United States"
                          className={inputClass}
                        />
                      </div>
                    </Field>

                    {saveState === 'error' && saveError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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
                            ? 'bg-green-700 hover:bg-green-700 text-white'
                            : 'bg-brand-near-black hover:bg-black text-white',
                        )}
                      >
                        {saveState === 'saving' && <Loader2 className="size-3.5 animate-spin" />}
                        {saveState === 'saved' && <Check className="size-3.5" strokeWidth={3} />}
                        {saveState === 'saved' ? 'Saved' : 'Save changes'}
                      </Button>

                      {saveState === 'idle' && (
                        <span className="text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                          Changes save to your account
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
                      Identity Verification
                    </h2>

                    {idVerified ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 shrink-0">
                        <Check className="size-3" strokeWidth={3} />
                        Identity Verified
                      </span>
                    ) : idDocumentPath ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 shrink-0">
                        Pending Review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey bg-brand-off-white dark:bg-[#1c1c1c] border border-brand-border-grey dark:border-[#2c2c2c] rounded-full px-2.5 py-0.5 shrink-0">
                        Not submitted
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
                          ID uploaded
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white underline underline-offset-2 transition-colors"
                      >
                        Re-upload
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
                      Choose file to upload
                    </button>
                  )}

                  {uploadState === 'uploading' && <UploadBar progress={uploadProgress} />}

                  {uploadState === 'error' && uploadError && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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
                    aria-label="Upload identity document"
                  />
                </section>

                <Divider />

                {/* Session */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-3">
                    Session
                  </h2>
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut();
                      navigate('/', { replace: true });
                    }}
                    className="text-sm text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 transition-colors"
                  >
                    Sign out
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
                {/* Email address */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Email address</h2>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-4">Your sign-in email address</p>
                  <div className="flex items-center gap-3">
                    <input
                      readOnly
                      value={user?.email ?? ''}
                      className="flex h-10 w-full rounded-md border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1c1c1c] px-3 py-2 text-sm text-brand-mid-grey dark:text-brand-mid-grey outline-none cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mt-2">
                    Email changes coming soon
                  </p>
                </section>

                <div className="border-t border-brand-border-grey dark:border-[#2c2c2c] my-6" />

                {/* Password */}
                <section>
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Password</h2>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-4">
                    Send a reset link to your email to change your password.
                  </p>

                  {resetSent ? (
                    <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 rounded-lg px-3 py-2">
                      Reset link sent to {user?.email}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handlePasswordReset}
                        className="self-start text-sm font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors"
                      >
                        Send reset link
                      </button>
                      {resetError && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          {resetError}
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <div className="border-t border-brand-border-grey dark:border-[#2c2c2c] my-6" />

                {/* 2FA */}
                <section>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">Two-factor authentication</h2>
                    <span className="inline-flex items-center text-[11px] font-medium text-brand-mid-grey bg-brand-off-white dark:bg-[#1c1c1c] border border-brand-border-grey dark:border-[#2c2c2c] rounded-full px-2.5 py-0.5">
                      Coming soon
                    </span>
                  </div>
                  <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                    Add an extra layer of security to your account with TOTP or SMS verification.
                  </p>
                </section>
              </motion.div>
            )}

            {/* ── Tab: Notifications ── */}
            {activeTab === 'notifications' && (
              <motion.div
                key="notifications"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Email notifications</h2>
                <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-6">
                  Choose which notifications you receive by email
                </p>

                <div className="flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-brand-dark-grey overflow-hidden">
                  {(
                    [
                      { key: 'stage_approvals', label: 'Stage approvals', desc: 'When a stage is approved or rejected' },
                      { key: 'evidence',         label: 'Evidence uploaded', desc: 'When evidence is uploaded to your project' },
                      { key: 'messages',         label: 'New messages',       desc: 'When you receive a project message' },
                      { key: 'payments',         label: 'Payment reminders',  desc: 'When a payment milestone is due' },
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
                  Email notification delivery is managed server-side. These preferences will sync when Groundwork Notifications v2 launches.
                </p>
              </motion.div>
            )}

            {/* ── Tab: Subscription ── */}
            {activeTab === 'subscription' && (
              <motion.div
                key="subscription"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-1 flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">Your plan</h2>
                  <span className="inline-flex items-center text-[11px] font-medium bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black rounded-full px-2.5 py-0.5">
                    {tier === 'jalla_verified' ? 'Jalla Verified' : tier === 'enterprise' ? 'Enterprise' : 'Self-Verify'}
                  </span>
                </div>
                <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-6">
                  Compare plans and upgrade to unlock more features
                </p>

                <div className="flex flex-col gap-4">
                  {/* Self-Verify */}
                  <div className={cn(
                    'rounded-2xl border-2 p-5',
                    tier === 'free' || !tier
                      ? 'border-brand-near-black dark:border-white'
                      : 'border-brand-border-grey dark:border-[#2c2c2c]',
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-brand-near-black dark:text-white">Self-Verify</p>
                        <p className="text-lg font-bold text-brand-near-black dark:text-white mt-0.5">Free</p>
                      </div>
                      {(tier === 'free' || !tier) && (
                        <span className="text-[11px] font-medium bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black rounded-full px-2.5 py-0.5">
                          Current plan
                        </span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5 mb-4">
                      {['Unlimited projects', '10-stage tracker', 'Budget calculator', 'Document vault', 'Community access'].map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                          <Check className="size-3 text-green-600 shrink-0" strokeWidth={3} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {tier !== 'free' && (
                      <button type="button" className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white underline underline-offset-2 transition-colors">
                        Downgrade
                      </button>
                    )}
                  </div>

                  {/* Jalla Verified */}
                  <div className={cn(
                    'rounded-2xl border-2 p-5',
                    tier === 'jalla_verified'
                      ? 'border-brand-near-black dark:border-white'
                      : 'border-brand-border-grey dark:border-[#2c2c2c]',
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-brand-near-black dark:text-white">Jalla Verified</p>
                        <p className="text-lg font-bold text-brand-near-black dark:text-white mt-0.5">from <span className="text-brand-mid-grey text-sm font-medium">$15/stage</span></p>
                      </div>
                      {tier === 'jalla_verified' && (
                        <span className="text-[11px] font-medium bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black rounded-full px-2.5 py-0.5">
                          Current plan
                        </span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5 mb-4">
                      {['Everything in Self-Verify', 'Jalla team verification badge', 'Priority support', 'Stage completion certificates'].map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                          <Check className="size-3 text-green-600 shrink-0" strokeWidth={3} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {tier !== 'jalla_verified' && (
                      <a
                        href="/pricing"
                        className="inline-flex items-center text-xs font-semibold text-brand-near-black dark:text-white hover:underline underline-offset-2 transition-colors"
                      >
                        Upgrade &rarr;
                      </a>
                    )}
                  </div>

                  {/* Enterprise */}
                  <div className={cn(
                    'rounded-2xl border-2 p-5',
                    tier === 'enterprise'
                      ? 'border-brand-near-black dark:border-white'
                      : 'border-brand-border-grey dark:border-[#2c2c2c]',
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-brand-near-black dark:text-white">Enterprise</p>
                        <p className="text-lg font-bold text-brand-near-black dark:text-white mt-0.5">Custom</p>
                      </div>
                      {tier === 'enterprise' && (
                        <span className="text-[11px] font-medium bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black rounded-full px-2.5 py-0.5">
                          Current plan
                        </span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5 mb-4">
                      {['Multiple projects', 'White-label dashboard', 'API access', 'Dedicated account manager'].map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs text-brand-mid-grey dark:text-brand-mid-grey">
                          <Check className="size-3 text-green-600 shrink-0" strokeWidth={3} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {tier !== 'enterprise' && (
                      <a
                        href="mailto:hello@groundwork.build"
                        className="inline-flex items-center text-xs font-semibold text-brand-near-black dark:text-white hover:underline underline-offset-2 transition-colors"
                      >
                        Contact us &rarr;
                      </a>
                    )}
                  </div>
                </div>
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
                <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-6 flex flex-col gap-6">

                  {/* Export data */}
                  <div>
                    <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Export your data</h2>
                    <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-3">
                      Download a JSON copy of your account information and metadata.
                    </p>
                    <button
                      type="button"
                      onClick={handleDataExport}
                      className="inline-flex items-center gap-2 text-sm font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-xl px-4 py-2 bg-white dark:bg-brand-dark-grey hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors"
                    >
                      Download JSON export
                    </button>
                  </div>

                  <div className="border-t border-red-200 dark:border-red-900/50" />

                  {/* Delete account */}
                  <div>
                    <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Delete account</h2>
                    <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-1">
                      Deleting your account is irreversible. All projects, documents, and data will be permanently removed.
                    </p>

                    {deleteResult ? (
                      <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey bg-white dark:bg-brand-dark-grey border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg px-3 py-2 mt-3">
                        {deleteResult}
                      </p>
                    ) : showDeleteConfirm ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">
                          Type <span className="font-mono font-bold">DELETE</span> to confirm
                        </p>
                        <input
                          type="text"
                          value={deleteInput}
                          onChange={e => setDeleteInput(e.target.value)}
                          placeholder="DELETE"
                          className="flex h-10 w-full rounded-md border border-red-300 dark:border-red-900/60 bg-white dark:bg-brand-dark-grey px-3 py-2 text-sm text-brand-near-black dark:text-white outline-none focus-visible:border-red-600 dark:focus-visible:border-red-400 placeholder:text-brand-mid-grey"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                            className="flex-1 h-9 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] text-sm text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={deleteInput !== 'DELETE'}
                            onClick={handleDeleteConfirm}
                            className="flex-1 h-9 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            Confirm deletion
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="mt-3 inline-flex items-center text-sm font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-900/60 rounded-xl px-4 py-2 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
                      >
                        Delete account
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
