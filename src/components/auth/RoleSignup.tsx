import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { Loader2, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { isPasswordAcceptable } from '@/lib/auth/password-policy';
import { normalisePhone, isE164 } from '@/lib/phone';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { rememberEmailRequest } from '@/lib/auth/last-email-request';
import { signupMetadata, CONTRACTOR_APPLY_PATH } from '@/lib/auth/signup-account';
import { getClaimPreview, rememberClaim, rememberContractorRegistration } from '@/lib/supabase/contractor-claim';
import { getVerifierInvitePreview, rememberVerifierClaim } from '@/lib/supabase/verifier-claim';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// The one front door for a contractor, and the one for a verifier.
//
// ── Why this is not /auth/signup ─────────────────────────────────────────────────────
// It used to be. An approved contractor was sent to `/auth/signup?email=…`, which greets
// them with a client's heading and an account-type radio they have already answered — so
// people who had just been accepted read it as the wrong page and stopped. This says
// "Sign up as a contractor" in the heading and on the button, and nothing else.
//
// ── Two kinds of contractor, one page ───────────────────────────────────────────────
// An APPLICANT arrives with a token from their acceptance email: the page greets them by
// name and the claim links their application and their published directory listing to the
// new account (100). A PARTNER — somebody Jalla already knows, who brings their own
// clients — has no application to accept and so no token to mail. They open this page
// bare and sign up; `register_contractor_account` grants the role (106).
//
// So for a contractor a missing token is a different person, not a refusal. For a
// VERIFIER it is still a refusal: their decision releases a stage payment, so that role is
// never self-served. `openWithoutInvite` below is the whole difference.
//
// What a partner does NOT get by signing up: any project (086 gates that on an accepted
// invite), a listing in the client-facing directory (033 is admin-write-only), or the
// ability to create a project. 106's header carries the rule that follows from this —
// a partner's client-onboarding must never be gated on the bare contractor role.
//
// ── Why the claim happens later ──────────────────────────────────────────────────────
// Sign-up ends on "check your email", and the session is established in a DIFFERENT tab
// by /auth/callback — which cannot see this page's URL. So the token is parked before
// they leave and the callback finishes the claim. They never press anything twice.
// =========================================================

export type SignupRole = 'contractor' | 'verifier';

interface Preview {
  fullName: string;
  email: string;
  claimed: boolean;
}

/**
 * Everything that differs between the two doors, in one place.
 *
 * Typed as one shape rather than left as a union of two: narrowing on
 * `cfg.openWithoutInvite` otherwise reduces `cfg` to `never` inside the refusal branch,
 * and the fields that branch reads disappear.
 */
interface DoorConfig {
  preview: (token: string) => Promise<Preview | null>;
  remember: (token: string) => void;
  heading: TKey;
  intro: TKey;
  submit: TKey;
  noToken: TKey;
  noTokenHref: string | null;
  noTokenCta: TKey | null;
  openWithoutInvite: boolean;
  openIntro: TKey | null;
}

const CONFIG: Record<SignupRole, DoorConfig> = {
  contractor: {
    preview: (token: string): Promise<Preview | null> => getClaimPreview(token),
    remember: rememberClaim,
    heading:  'auth.roleSignup.contractorHeading',
    intro:    'auth.roleSignup.contractorIntro',
    submit:   'auth.roleSignup.contractorSubmit',
    noToken:  'auth.roleSignup.contractorNoToken',
    /** An applicant with no token has somewhere to go: the application itself. */
    noTokenHref: CONTRACTOR_APPLY_PATH,
    noTokenCta:  'auth.roleSignup.contractorNoTokenCta',
    /** A partner may sign up with nothing in the query (106). */
    openWithoutInvite: true,
    openIntro: 'auth.roleSignup.contractorOpenIntro',
  },
  verifier: {
    preview: (token: string): Promise<Preview | null> =>
      getVerifierInvitePreview(token).then(p => (p ? { ...p } : null)),
    remember: rememberVerifierClaim,
    heading:  'auth.roleSignup.verifierHeading',
    intro:    'auth.roleSignup.verifierIntro',
    submit:   'auth.roleSignup.verifierSubmit',
    noToken:  'auth.roleSignup.verifierNoToken',
    // No public application exists for verifiers, and inventing a link to one would be a
    // dead end. They are invited after an interview, so the honest answer is to say so.
    noTokenHref: null,
    noTokenCta:  null,
    // No open version of this page. A verifier is invited after an interview.
    openWithoutInvite: false,
    openIntro: null,
  },
};

export default function RoleSignup({ role }: { role: SignupRole }) {
  const cfg = CONFIG[role];
  const t = useT();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') ?? '';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(true);

  const [fullName,        setFullName]        = useState('');
  const [email,           setEmail]           = useState('');
  const [phone,           setPhone]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error,           setError]           = useState<string | null>(null);
  const [submitting,      setSubmitting]      = useState(false);
  const [submitted,       setSubmitted]       = useState(false);

  // Who the link is for. Both previews are granted to anon precisely so this page can
  // name them before they have an account — a page that cannot reads as a phishing link.
  useEffect(() => {
    if (!token) { setChecking(false); return; }
    let alive = true;
    cfg.preview(token)
      .then(p => {
        if (!alive) return;
        setPreview(p);
        if (p) { setFullName(p.fullName); setEmail(p.email); }
      })
      .catch(() => { if (alive) setPreview(null); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [token, cfg]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) { setError(t('admin.provision.errName')); return; }
    if (!isPasswordAcceptable(password)) { setError(t('auth.password.errRequirements')); return; }
    if (password !== confirmPassword)    { setError(t('auth.password.errMismatch')); return; }

    // Normalised here, where the typed value still is: `handle_new_user` (102) stores a
    // number only when it is already E.164 and drops anything else silently, so a number
    // that cannot be placed is refused now rather than believed to be on file.
    const canonicalPhone = normalisePhone(phone, DEFAULT_COUNTRY_CODE);
    if (!isE164(canonicalPhone)) { setError(t('auth.signup.phoneInvalid')); return; }

    // Parked BEFORE signUp: the confirmation lands in another tab, and /auth/callback is
    // what turns this account into a contractor or a verifier.
    //
    // An invitation is claimed; a partner with none is registered. Both happen in the
    // callback, so neither is something this page's success depends on.
    if (preview) cfg.remember(token);
    else if (cfg.openWithoutInvite) rememberContractorRegistration();

    setSubmitting(true);
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: signupMetadata(fullName.trim(), canonicalPhone),
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);

    if (signUpErr) {
      setError(signUpErr.message && signUpErr.message !== '{}'
        ? signUpErr.message
        : t('auth.signup.errGeneric'));
      return;
    }

    // Instant sign-in path (email confirmation disabled on the project).
    if (data.session) { window.location.href = '/auth/callback'; return; }

    rememberEmailRequest('signup', email.trim());
    setSubmitted(true);
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  // ── No token, a bad one, or a withdrawn one ──
  // For a verifier this is the end of the road. For a contractor it is a partner arriving
  // at the bare URL, so the form is shown below instead.
  //
  // Deliberately the same screen for all three cases: distinguishing them would turn this
  // page into a way to test whether a token is real.
  if (!preview && !cfg.openWithoutInvite) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t(cfg.heading)}</h1>
        <p className="mt-3 text-sm leading-relaxed text-brand-mid-grey">{t(cfg.noToken)}</p>
        {cfg.noTokenHref && cfg.noTokenCta && (
          <Link
            to={cfg.noTokenHref}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white"
          >
            {t(cfg.noTokenCta)}
          </Link>
        )}
        <p className="mt-6 text-sm text-brand-mid-grey">
          {t('auth.roleSignup.haveAccount')}{' '}
          <Link to="/auth/login" className="text-brand-near-black underline underline-offset-4">
            {t('auth.login.submit')}
          </Link>
        </p>
      </div>
    );
  }

  // ── Already spent ──
  // The account exists; the thing to do is sign in, not make a second one.
  if (preview?.claimed) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t('auth.roleSignup.claimedTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-brand-mid-grey">{t('auth.roleSignup.claimedBody')}</p>
        <Link
          to="/auth/login"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t('auth.login.submit')}
        </Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
          <Mail className="size-5 text-brand-near-black" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t('auth.signup.checkEmailTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-brand-mid-grey">
          {t('auth.roleSignup.checkEmailBody', { email: email.trim() })}
        </p>
      </motion.div>
    );
  }

  return (
    <div>
      <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t(cfg.heading)}</h1>
      <p className="mt-2 text-sm leading-relaxed text-brand-mid-grey">
        {preview
          ? t(cfg.intro, { name: preview.fullName.trim().split(' ')[0] || preview.fullName })
          : t(cfg.openIntro ?? cfg.intro)}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">{t('auth.signup.fullName')}</Label>
          <Input id="fullName" autoComplete="name" value={fullName}
            onChange={e => setFullName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.signup.email')}</Label>
          <Input id="email" type="email" autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)} />
          {/* Editable on purpose: 100's rule — somebody who signs up with a different
              address than we wrote to is still the person who opened our mail. */}
          <p className="text-xs text-brand-mid-grey">{t('auth.roleSignup.emailHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">{t('auth.signup.phone')}</Label>
          <Input id="phone" type="tel" autoComplete="tel" value={phone}
            onChange={e => setPhone(e.target.value)} />
          <p className="text-xs text-brand-mid-grey">{t('auth.signup.phoneHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.signup.password')}</Label>
          <Input id="password" type="password" autoComplete="new-password" value={password}
            onChange={e => setPassword(e.target.value)} />
          <PasswordStrength password={password} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('auth.signup.confirmPassword')}</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)} />
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting
            ? <><Loader2 className="mr-2 size-4 animate-spin" />{t('auth.signup.submitting')}</>
            : t(cfg.submit)}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-brand-mid-grey">
        {t('auth.roleSignup.haveAccount')}{' '}
        <Link to="/auth/login" className="text-brand-near-black underline underline-offset-4">
          {t('auth.login.submit')}
        </Link>
      </p>
    </div>
  );
}
