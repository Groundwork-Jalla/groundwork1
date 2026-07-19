import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, Building2, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getInviteByToken, acceptInvite } from '@/lib/supabase/invites';
import type { InviteDetails } from '@/lib/supabase/invites';

export default function InvitePage() {
  const { token }    = useParams<{ token: string }>();
  const navigate     = useNavigate();
  const { user }     = useAuth();

  const [invite,    setInvite]    = useState<InviteDetails | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [invalid,   setInvalid]   = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }

    getInviteByToken(token)
      .then((data) => {
        if (!data) { setInvalid(true); return; }
        setInvite(data);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAcceptNow() {
    if (!token) return;
    setAccepting(true);
    setAcceptErr(null);
    try {
      const projectId = await acceptInvite(token);
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setAcceptErr(err instanceof Error ? err.message : 'Failed to accept invite.');
      setAccepting(false);
    }
  }

  // Store token in localStorage so callback.tsx can process it
  // even if the user opens the confirmation email in a different tab.
  function storeToken() {
    if (token) localStorage.setItem('pendingInvite', token);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  if (invalid || !invite) {
    return (
      <div className="w-full text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-light-grey">
          <UserPlus className="size-5 text-brand-mid-grey" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black mb-2">
          Invite not found
        </h1>
        <p className="text-sm text-brand-mid-grey mb-6 leading-relaxed">
          This invite link is invalid or has already been used.
        </p>
        <Link
          to="/"
          className="text-sm font-medium text-brand-near-black underline underline-offset-4"
        >
          Go to Groundwork
        </Link>
      </div>
    );
  }

  if (invite.status === 'accepted') {
    return (
      <div className="w-full text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-50">
          <UserPlus className="size-5 text-green-600" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black mb-2">
          Invite already accepted
        </h1>
        <p className="text-sm text-brand-mid-grey mb-6 leading-relaxed">
          This invite has already been used. Log in to access your project.
        </p>
        <Link
          to="/auth/login"
          className="inline-flex items-center justify-center rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-3 hover:bg-black transition-colors"
        >
          Log in
        </Link>
      </div>
    );
  }

  const signupUrl = `/auth/signup?invite=${encodeURIComponent(token ?? '')}&email=${encodeURIComponent(invite.invite_email)}`;
  const loginUrl  = `/auth/login?invite=${encodeURIComponent(token ?? '')}`;

  return (
    <div className="w-full">
      {/* Project badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-brand-border-grey bg-brand-off-white px-3 py-1.5 mb-6">
        <Building2 className="size-3.5 text-brand-mid-grey shrink-0" />
        <span className="text-xs font-medium text-brand-near-black truncate max-w-50">
          {invite.project_name}
        </span>
      </div>

      <h1 className="font-sans text-3xl font-bold text-brand-near-black leading-tight mb-2">
        You've been invited
      </h1>
      <p className="text-sm text-brand-mid-grey mb-1">
        <span className="text-brand-near-black font-medium">{invite.inviter_name}</span> invited you to collaborate on{' '}
        <span className="text-brand-near-black font-medium">{invite.project_name}</span>.
      </p>
      <p className="text-xs text-brand-mid-grey mb-6">
        Invite sent to <span className="text-brand-near-black">{invite.invite_email}</span>
      </p>

      <p className="text-xs text-brand-mid-grey mb-6 leading-relaxed">
        As a contractor, you'll be able to upload progress evidence and message the project owner
        directly from the project dashboard.
      </p>

      {/* CTA — branch on auth state */}
      {user ? (
        <>
          <p className="text-xs text-brand-mid-grey text-center mb-3">
            Logged in as <span className="text-brand-near-black font-medium">{user.email}</span>
          </p>
          <button
            type="button"
            onClick={handleAcceptNow}
            disabled={accepting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3.5 hover:bg-black transition-colors disabled:opacity-60"
          >
            {accepting && <Loader2 className="size-4 animate-spin" />}
            {accepting ? 'Accepting…' : 'Accept Invite'}
          </button>
          {acceptErr && (
            <p className="mt-3 text-xs text-center text-red-600">{acceptErr}</p>
          )}
        </>
      ) : (
        <>
          <Link
            to={signupUrl}
            onClick={storeToken}
            className="block w-full text-center rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3.5 hover:bg-black transition-colors mb-3"
          >
            Create account
          </Link>
          <Link
            to={loginUrl}
            onClick={storeToken}
            className="block w-full text-center rounded-xl border border-brand-border-grey text-sm font-medium text-brand-near-black py-3.5 hover:bg-brand-off-white transition-colors"
          >
            I already have an account
          </Link>
        </>
      )}
    </div>
  );
}
