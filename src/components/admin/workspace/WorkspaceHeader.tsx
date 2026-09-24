import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ExternalLink, ShieldCheck, MessageCircle, MessagesSquare, Loader2 } from 'lucide-react';
import { openClientWhatsApp } from '@/lib/supabase/project-whatsapp';
import { ensureProjectConversation } from '@/lib/supabase/conversations';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { inboxHref } from '@/lib/admin/whatsapp-shortcut';
import type { Workspace } from '@/lib/admin/workspace';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { AssignVerifierModal } from '@/components/admin/team/AssignVerifierModal';
import { useDomainLabels } from '@/lib/domain-labels';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The workspace header (05 §5): who this project is and where it stands, in one band.
//
//   ← Projects
//   Name · client · plan · location
//   status · stage n of N · tracking since · last activity · current-stage lifecycle
//   quick actions
//
// Every fact is read off the assembled Workspace. The lifecycle badge receives
// `currentStage.lifecycle` as computed by the loader — this file computes nothing about
// a stage. No raw id is ever shown: a person with no readable account is "Unknown
// account", a stage with no translation is its stored name.
//
// Quick actions are the existing RPCs only (05 §5): Assign verifier (086, the extracted
// modal) and the client view (an existing page). Assign contractor arrives with the Team
// tab, whose extraction it belongs to; nothing new is invented here.
//
// ── WhatsApp means "message this client", not "a chat for this project" ─────────────
// A WhatsApp conversation belongs to the PERSON: GHL gives one thread per contact, and
// `conversations.ghl_conversation_id` is UNIQUE, so a client with two projects has one
// chat reached from either. The button resolves it server-side and navigates into the
// Inbox; it never writes `conversations.project_id`, so clicking from one project cannot
// move the thread away from another. Linking a thread to a project stays the separate,
// explicit act it already was.
// =========================================================

const STATUS_DOT: Record<string, string> = {
  active:    'bg-state-active',
  on_hold:   'bg-state-held',
  completed: 'bg-state-complete',
  archived:  'bg-state-locked',
};

export function WorkspaceHeader({ ws, onNotice }: { ws: Workspace; onNotice: (text: string) => void }) {
  const t = useT();
  const labels = useDomainLabels();
  const { stageLabel } = useStageLabels();
  const [assignVerifier, setAssignVerifier] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [jallaBusy, setJallaBusy] = useState(false);
  const navigate = useNavigate();

  /**
   * Resolve the client's one WhatsApp thread and go to it. Every refusal names itself —
   * no phone, a CRM that would not make the contact, a provider that would not open the
   * thread — because "nothing happened" on a button like this is indistinguishable from
   * a bug. Nothing is created unless the provider actually answered.
   */
  /**
   * This project's native thread, opened WITHOUT leaving the project.
   *
   * The Conversations tab is already here and already renders this exact thread, so
   * sending the admin to the Inbox would cost them the stage, the budget and the team
   * they were looking at in order to read a message about them. WhatsApp goes to the
   * Inbox because its thread belongs to the person and spans every project; this one is
   * the project's own.
   *
   * `ensure_project_conversation` returns the existing thread or creates it under an
   * advisory lock, so there is no picker to show and no way to end up with two.
   */
  async function jalla() {
    setJallaBusy(true);
    try {
      const id = await ensureProjectConversation(p.id);
      navigate(workspaceHref(p.id, { tab: 'conversations', conversationId: id }));
    } catch (err) {
      onNotice(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setJallaBusy(false);
    }
  }

  async function whatsapp() {
    setWaBusy(true);
    try {
      const r = await openClientWhatsApp(p.id);
      if (r.ok) { navigate(inboxHref(r.conversationId)); return; }
      onNotice(t(`admin.workspace.header.whatsappFail.${r.reason}` as TKey));
    } catch {
      onNotice(t('admin.workspace.header.whatsappFail.error'));
    } finally {
      setWaBusy(false);
    }
  }
  const [verifierAvailable, setVerifierAvailable] = useState(ws.available.verifiers);

  const p = ws.project;
  const owner = ws.team.owner;
  const ownerLabel = owner ? (owner.name || owner.email) : t('admin.workspace.header.unknownAccount');
  const location = [p.city?.trim(), p.country ? labels.country(p.country) : ''].filter(Boolean).join(', ');
  const statusKey = `admin.workspace.header.status.${p.status}` as TKey;
  const statusLabel = t(statusKey) === statusKey ? p.status : t(statusKey);
  const lastActivity = ws.activity[0]?.createdAt ?? null;
  const current = ws.currentStage;

  return (
    <header className="border-b border-brand-border-grey bg-white px-5 py-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:px-6 2xl:px-8">
      <Link
        to="/admin/projects?status=not_archived"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
      >
        <ArrowLeft className="size-3.5" />
        {t('admin.workspace.back')}
      </Link>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* ── Identity ─────────────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-brand-near-black dark:text-white sm:text-2xl">
            {p.name}
          </h1>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-brand-mid-grey">
            <Fact label={t('admin.workspace.header.client')} value={ownerLabel} title={owner?.email} />
            <Fact label={t('admin.workspace.header.plan')} value={labels.tier(p.tier)} />
            {location && <Fact label={t('admin.workspace.header.location')} value={location} />}
          </dl>

          {/* ── Standing ─────────────────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-brand-near-black dark:text-white">
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[p.status] ?? 'bg-state-locked')} aria-hidden="true" />
              {statusLabel}
            </span>
            <span className="tabular-nums text-brand-mid-grey">
              {t('admin.workspace.header.stageOf', { n: p.current_stage, total: ws.stages.length })}
              {current && <span className="text-brand-near-black dark:text-white"> · {stageLabel(current.stage)}</span>}
            </span>
            <span className="text-brand-mid-grey">
              {p.tracking_started_at
                ? t('admin.workspace.header.trackingSince', { date: formatDate(p.tracking_started_at) })
                : t('admin.workspace.header.notTracking')}
            </span>
            <span className="text-brand-mid-grey">
              {lastActivity
                ? t('admin.workspace.header.lastActivity', { when: formatRelative(lastActivity) })
                : t('admin.workspace.header.noActivity')}
            </span>
            {/* The current stage's derived lifecycle — rendered, not recomputed. */}
            {current && <StageLifecycleBadge lifecycle={current.lifecycle} />}
          </div>
        </div>

        {/* ── Quick actions: existing RPCs and pages only ───────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {verifierAvailable && (
            <button
              type="button"
              onClick={() => setAssignVerifier(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-medium text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40"
            >
              <ShieldCheck className="size-3.5" />
              {t('admin.verifier.assign')}
            </button>
          )}
          <button
            type="button"
            onClick={jalla}
            disabled={jallaBusy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-medium text-brand-near-black transition-colors hover:border-brand-near-black disabled:opacity-60 dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40"
          >
            {jallaBusy ? <Loader2 className="size-3.5 animate-spin" /> : <MessagesSquare className="size-3.5" />}
            {t('admin.jalla.message')}
          </button>
          {/* WhatsApp keeps its colour here as everywhere else in Groundwork. */}
          <button
            type="button"
            onClick={whatsapp}
            disabled={waBusy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#25d366]/40 px-3 py-2 text-xs font-medium text-[#1a8d45] transition-colors hover:border-[#25d366] disabled:opacity-60 dark:text-[#25d366]"
          >
            {waBusy ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
            {t('admin.workspace.header.whatsapp')}
          </button>
          <a
            href={`/projects/${p.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-medium text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40"
          >
            <ExternalLink className="size-3.5" />
            {t('admin.workspace.header.openClient')}
          </a>
        </div>
      </div>

      {assignVerifier && (
        <AssignVerifierModal
          project={{ id: p.id, name: p.name }}
          onClose={() => setAssignVerifier(false)}
          onAssigned={notice => { setAssignVerifier(false); onNotice(notice); }}
          onUnavailable={() => { setVerifierAvailable(false); setAssignVerifier(false); }}
        />
      )}
    </header>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-brand-muted-grey">{label}</dt>
      <dd className="font-medium text-brand-near-black dark:text-white" title={title}>{value}</dd>
    </div>
  );
}
