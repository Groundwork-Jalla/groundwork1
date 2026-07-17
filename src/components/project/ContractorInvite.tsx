import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, UserPlus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchInvites,
  inviteContractor,
  revokeInvite,
} from '@/lib/supabase/invites';
import type { ContractorInviteRow } from '@/types/project';

interface ContractorInviteProps {
  projectId: string;
  userId: string;
  projectName: string;
  projectTier: string;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type StatusBadgeProps = { status: ContractorInviteRow['status'] };

function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<ContractorInviteRow['status'], string> = {
    pending: 'text-amber-600 bg-amber-50',
    accepted: 'text-green-700 bg-green-50',
    rejected: 'text-brand-mid-grey bg-brand-light-grey',
  };
  const labels: Record<ContractorInviteRow['status'], string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        styles[status],
      )}
    >
      {labels[status]}
      {status === 'accepted' && (
        <span aria-hidden="true" className="text-green-600">
          ✓
        </span>
      )}
    </span>
  );
}

function InviteSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3"
        >
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-44 animate-pulse rounded bg-brand-light-grey" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-brand-light-grey" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded-full bg-brand-light-grey" />
        </div>
      ))}
    </div>
  );
}

export function ContractorInvite({ projectId, userId, projectName, projectTier }: ContractorInviteProps) {
  const { user } = useAuth();
  const inviterName = user?.user_metadata?.full_name ?? user?.email ?? 'Project Owner';

  const [invites, setInvites] = useState<ContractorInviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [emailWarning, setEmailWarning] = useState('');

  // Revoke modal state
  const [revokeTarget, setRevokeTarget] = useState<ContractorInviteRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInvites(projectId)
      .then((rows) => {
        if (!cancelled) setInvites(rows);
      })
      .catch(() => {
        // silently fail — list stays empty
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function handleToggleForm() {
    setShowForm((prev) => !prev);
    setEmail('');
    setEmailError('');
    setSubmitError('');
    setEmailWarning('');
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailError('');
    setSubmitError('');

    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    // Optimistic insert
    const optimistic: ContractorInviteRow = {
      id: `optimistic-${Date.now()}`,
      project_id: projectId,
      invited_by: userId,
      email: trimmed.toLowerCase(),
      role: 'contractor',
      status: 'pending',
      accepted_at: null,
      created_at: new Date().toISOString(),
      token: '',
      contractor_user_id: null,
    };

    setInvites((prev) => [optimistic, ...prev]);
    setSubmitting(true);

    try {
      const { invite, emailSent } = await inviteContractor(projectId, userId, trimmed, projectName, inviterName);
      setInvites((prev) =>
        prev.map((inv) => (inv.id === optimistic.id ? invite : inv)),
      );
      setEmail('');
      setShowForm(false);
      if (!emailSent) {
        setEmailWarning(
          `Invite created, but the notification email to ${trimmed} couldn't be sent. Share this project's invite link with them directly.`,
        );
      }
    } catch (err) {
      // Roll back optimistic insert
      setInvites((prev) => prev.filter((inv) => inv.id !== optimistic.id));
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to send invite. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeInvite(revokeTarget.id);
      setInvites((prev) => prev.filter((inv) => inv.id !== revokeTarget.id));
      setRevokeTarget(null);
    } catch {
      // Keep modal open; parent can retry
    } finally {
      setRevoking(false);
    }
  }

  const isStarterAtLimit = (projectTier === 'self_verify' || projectTier === 'starter') && invites.filter(
    (inv) => inv.status === 'pending' || inv.status === 'accepted',
  ).length >= 1;

  return (
    <section className="w-full font-sans">
      {/* Section header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-sm font-medium text-brand-near-black">
          Contractor Access
        </h2>
        {isStarterAtLimit ? (
          <span className="text-xs text-brand-mid-grey">
            1 contractor limit on Self Verify
          </span>
        ) : (
          <Button
            type="button"
            variant={showForm ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleForm}
            className="shrink-0"
          >
            {showForm ? 'Cancel' : 'Invite Contractor'}
          </Button>
        )}
      </div>

      {/* Email delivery warning */}
      <AnimatePresence>
        {emailWarning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-800 leading-relaxed">{emailWarning}</p>
              </div>
              <button
                type="button"
                onClick={() => setEmailWarning('')}
                className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Starter limit notice */}
      {isStarterAtLimit && (
        <p className="text-xs text-brand-mid-grey mb-4 leading-relaxed">
          Self Verify plan allows 1 contractor per project.{' '}
          <span className="text-brand-near-black">Upgrade to Jalla Verify for unlimited contractors.</span>
        </p>
      )}

      {/* Invite form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            key="invite-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <form
              onSubmit={handleSubmit}
              noValidate
              className="mb-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-4 flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="contractor-email"
                  className="text-xs font-medium text-brand-near-black"
                >
                  Email address
                </label>
                <input
                  id="contractor-email"
                  type="email"
                  autoComplete="off"
                  placeholder="contractor@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError('');
                  }}
                  disabled={submitting}
                  className={cn(
                    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey',
                    'outline-none focus:ring-2 focus:ring-brand-near-black/20 transition-shadow',
                    emailError
                      ? 'border-red-400 focus:ring-red-200'
                      : 'border-brand-border-grey',
                    submitting && 'opacity-60 cursor-not-allowed',
                  )}
                />
                {emailError && (
                  <p className="text-xs text-red-500 mt-0.5">{emailError}</p>
                )}
              </div>

              {submitError && (
                <p className="text-xs text-red-500">{submitError}</p>
              )}

              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="self-end"
              >
                {submitting ? 'Sending…' : 'Send Invite'}
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite list */}
      {loading ? (
        <InviteSkeleton />
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={28} strokeWidth={1.5} />}
          title="No contractors invited"
          description="Invite a contractor to give them scoped access to upload evidence and message on this project."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {invites.map((invite) => (
              <motion.li
                key={invite.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex items-center justify-between gap-3 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-sm font-medium text-brand-near-black truncate"
                    title={invite.email}
                  >
                    {invite.email}
                  </span>
                  <span className="text-xs text-brand-mid-grey">
                    Sent {formatDate(invite.created_at)}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={invite.status} />
                  {invite.status === 'pending' && (
                    <button
                      type="button"
                      aria-label={`Revoke invite for ${invite.email}`}
                      onClick={() => setRevokeTarget(invite)}
                      className={cn(
                        'flex items-center justify-center rounded-full p-1 text-brand-mid-grey',
                        'hover:bg-brand-light-grey hover:text-brand-near-black transition-colors',
                      )}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {/* Revoke confirm modal */}
      <ConfirmModal
        open={revokeTarget !== null}
        title="Remove contractor invite?"
        description={`Remove invite for ${revokeTarget?.email ?? ''}? They will no longer be able to accept.`}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        loading={revoking}
        onConfirm={handleRevoke}
        onCancel={() => {
          if (!revoking) setRevokeTarget(null);
        }}
      />
    </section>
  );
}

export default ContractorInvite;
