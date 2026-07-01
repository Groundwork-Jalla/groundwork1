import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
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
    // Animate on mount
    const raf = requestAnimationFrame(() => setDisplayPct(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <div className="mb-8">
      {/* Bar */}
      <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden mb-3">
        <motion.div
          className="h-full rounded-full bg-brand-near-black"
          initial={{ width: 0 }}
          animate={{ width: `${displayPct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>

      {/* Label */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-brand-near-black">
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
                  ? 'bg-brand-near-black border-brand-near-black'
                  : 'bg-white border-brand-border-grey',
              )}
            >
              {item.filled && <Check className="size-2.5 text-white" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                'text-sm',
                item.filled ? 'text-brand-near-black' : 'text-brand-mid-grey',
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
  return <div className="border-t border-brand-border-grey my-8" />;
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
        className="text-xs font-medium text-brand-mid-grey uppercase tracking-wide"
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
      <div className="flex items-center justify-between text-xs text-brand-mid-grey mb-1">
        <span>Uploading…</span>
        <span className="tabular-nums">{Math.round(progress)}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-brand-light-grey overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-brand-near-black"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

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

  // Derived meta for completion meter (tracks live form state)
  const liveMeta: ProfileMeta = { displayName, phone, country, idDocumentPath };

  // ── Cleanup timers ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Save profile ───────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // Optimistic snapshot for reverting
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
      // Revert
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

    // Fake progress: 0→90% over 1.5s
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
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

    // Complete the bar then save path
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

    // Reset input so user can re-upload the same filename
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <nav className="border-b border-brand-border-grey px-4 sm:px-6 py-3 flex items-center gap-3">
        <Link
          to="/dashboard"
          className="flex items-center justify-center size-8 rounded-lg hover:bg-brand-light-grey transition-colors text-brand-mid-grey hover:text-brand-near-black"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-sans text-base font-semibold text-brand-near-black">
          Profile
        </h1>
      </nav>

      {/* Page body */}
      <div className="max-w-[560px] mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >

          {/* Avatar + name header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-light-grey text-lg font-bold text-brand-near-black select-none">
              {displayName.trim()
                ? displayName.trim().split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('')
                : <User className="size-6 text-brand-mid-grey" />}
            </div>
            <div>
              <p className="text-base font-bold text-brand-near-black leading-snug">
                {displayName.trim() || 'Your profile'}
              </p>
              <p className="text-sm text-brand-mid-grey mt-0.5">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Completion meter */}
          <CompletionMeter meta={liveMeta} />

          <Divider />

          {/* ── Profile form ── */}
          <section>
            <h2 className="text-sm font-semibold text-brand-near-black mb-5">
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
                    className="flex h-10 w-full rounded-md border border-brand-border-grey bg-white pl-9 pr-3 py-2 text-sm text-brand-near-black outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black"
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
                    className="flex h-10 w-full rounded-md border border-brand-border-grey bg-white pl-9 pr-3 py-2 text-sm text-brand-near-black outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black"
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
                    className="flex h-10 w-full rounded-md border border-brand-border-grey bg-white pl-9 pr-3 py-2 text-sm text-brand-near-black outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black"
                  />
                </div>
              </Field>

              {/* Error */}
              {saveState === 'error' && saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {saveError}
                </p>
              )}

              {/* Save button */}
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
                  <span className="text-xs text-brand-mid-grey">
                    Changes save to your account
                  </span>
                )}
              </div>
            </form>
          </section>

          <Divider />

          {/* ── ID verification section ── */}
          <section>
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="text-sm font-semibold text-brand-near-black">
                Identity Verification
              </h2>

              {/* Verification status badge */}
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
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey bg-brand-off-white border border-brand-border-grey rounded-full px-2.5 py-0.5 shrink-0">
                  Not submitted
                </span>
              )}
            </div>

            <p className="text-sm text-brand-mid-grey mb-5">
              Upload a government-issued ID — passport, national ID, or driver's licence. Max 5 MB.
            </p>

            {/* Already uploaded state */}
            {idDocumentPath && uploadState !== 'uploading' && (
              <div className="flex items-center justify-between rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-near-black">
                    <Check className="size-3.5 text-white" strokeWidth={3} />
                  </span>
                  <span className="text-sm font-medium text-brand-near-black">
                    ID uploaded
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black underline underline-offset-2 transition-colors"
                >
                  Re-upload
                </button>
              </div>
            )}

            {/* Upload button (shown when no doc, or always for re-upload) */}
            {!idDocumentPath && uploadState !== 'uploading' && uploadState !== 'done' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-dashed border-brand-border-grey bg-brand-off-white px-4 py-5 text-sm font-medium text-brand-mid-grey hover:border-brand-near-black hover:text-brand-near-black hover:bg-brand-light-grey transition-all group"
              >
                <Camera className="size-4 group-hover:scale-105 transition-transform" />
                Choose file to upload
              </button>
            )}

            {/* Upload in progress */}
            {uploadState === 'uploading' && (
              <UploadBar progress={uploadProgress} />
            )}

            {/* Upload error */}
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
                  className="self-start text-xs font-medium text-brand-mid-grey hover:text-brand-near-black underline underline-offset-2 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Hidden file input */}
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

          {/* ── Danger zone / sign out ── */}
          <section>
            <h2 className="text-sm font-semibold text-brand-near-black mb-3">
              Session
            </h2>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate('/', { replace: true });
              }}
              className="text-sm text-brand-mid-grey hover:text-brand-near-black border border-brand-border-grey rounded-xl px-4 py-2 transition-colors"
            >
              Sign out
            </button>
          </section>

        </motion.div>
      </div>
    </div>
  );
}
