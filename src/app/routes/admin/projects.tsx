import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2, ExternalLink, Search, UserPlus, Trash2, Plus, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ownerLookup } from '@/lib/supabase/admin-users';
import { deleteProjectAsAdmin } from '@/lib/supabase/admin-projects';
import { AssignVerifierModal } from '@/components/admin/team/AssignVerifierModal';
import { isMissingTable } from '@/lib/errors';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { errorMessage } from '@/lib/errors';
import { useDomainLabels } from '@/lib/domain-labels';
import { projectHealth, type ActivityStamps, type HealthBand } from '@/lib/admin/health';
import { matchesStatusFilter, parseHealthFilter, parseStatusFilter } from '@/lib/admin/project-filters';
import { FilterBanner } from '@/components/admin/FilterBanner';
import { useT, type TKey } from '@/lib/i18n';

interface AdminProject {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  tier: string;
  status: string;
  currentStage: number;
  country: string;
  createdAt: string;
  /**
   * The derived band, from `projectHealth()` — the SAME call the Overview counts with,
   * so "at risk" cannot mean two things. Null until the health inputs are loaded, which
   * only happens when a `health` filter asks for them.
   */
  health: HealthBand | null;
}

/** Filter labels, in the admin's own words. Health bands reuse the Overview's wording. */
const HEALTH_LABEL: Record<HealthBand, TKey> = {
  at_risk:   'admin.healthCard.atRisk',
  attention: 'admin.healthCard.attention',
  on_track:  'admin.healthCard.onTrack',
  planning:  'admin.healthCard.planning',
  done:      'admin.healthCard.completed',
  archived:  'admin.filter.archived',
};

/** Tier values that hold a free-plan slot. `starter` is the pre-008 name. */
function isFreeTier(tier: string): boolean {
  return tier === 'self_verify' || tier === 'starter';
}

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-brand-off-white text-state-active',
  on_hold:   'bg-brand-off-white text-state-held',
  completed: 'bg-brand-off-white text-brand-mid-grey',
  archived:  'bg-brand-off-white text-brand-mid-grey',
};

export default function AdminProjects() {
  const t = useT();
  const labels = useDomainLabels();
  const [assignTarget, setAssignTarget] = useState<AdminProject | null>(null);
  const [assignEmail,  setAssignEmail]  = useState('');
  const [assigning,    setAssigning]    = useState(false);
  const [assignError,  setAssignError]  = useState<string | null>(null);
  const [assignDone,   setAssignDone]   = useState<string | null>(null);

  /**
   * Puts a contractor on a client's project.
   *
   * Goes through the admin_assign_contractor RPC rather than writing the table
   * directly: contractor_invites is scoped to the project owner by RLS, and an
   * admin is not the owner. The RPC re-checks is_admin() server-side and writes an
   * audit row, so this cannot be driven from the console by a signed-in client.
   */
  async function handleAssign() {
    if (!assignTarget || !assignEmail.trim()) return;
    setAssigning(true);
    setAssignError(null);
    const { error } = await supabase.rpc('admin_assign_contractor', {
      p_project_id: assignTarget.id,
      p_email: assignEmail.trim(),
    });
    setAssigning(false);
    if (error) { setAssignError(error.message); return; }
    setAssignDone(`${assignEmail.trim()} → ${assignTarget.name}`);
    setAssignTarget(null);
  }
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading]   = useState(true);

  // ── Filters, from the URL ─────────────────────────────────────────────────────────
  // The Overview links here with the metric's own condition attached; the search box and
  // the filters share one source of truth so a link, a typed URL and a bookmark all
  // produce the same list.
  const [params, setParams] = useSearchParams();
  const query        = params.get('q') ?? '';
  const statusFilter = parseStatusFilter(params.get('status'));
  const healthFilter = parseHealthFilter(params.get('health'));

  const setQuery = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set('q', next); else p.delete('q');
    setParams(p, { replace: true });
  };
  const clearFilters = () => {
    const p = new URLSearchParams(params);
    p.delete('status'); p.delete('health');
    setParams(p, { replace: true });
  };

  // ── Verifier assignment (086) ──
  const [verTarget,     setVerTarget]     = useState<AdminProject | null>(null);
  const [verNotice,     setVerNotice]     = useState<string | null>(null);
  // False once a call has told us 086 is not applied; the action then hides itself.
  const [verAvailable,  setVerAvailable]  = useState(true);

  const [delTarget, setDelTarget] = useState<AdminProject | null>(null);
  const [deleting,  setDeleting]  = useState(false);
  const [delError,  setDelError]  = useState<string | null>(null);
  const [delNotice, setDelNotice] = useState<string | null>(null);

  /**
   * Delete one project. The only route to it — owners lost DELETE in migration 053, and
   * the only other thing that destroys a project is deleting the whole account.
   *
   * Storage is cleaned up inside `deleteProjectAsAdmin`, after the row is gone. A file
   * it could not remove is reported rather than swallowed: the project really is
   * deleted, and pretending the cleanup was complete would send someone looking for
   * bytes that are still being billed.
   */
  async function handleDelete() {
    if (!delTarget) return;
    setDeleting(true); setDelError(null);
    try {
      const summary = await deleteProjectAsAdmin(delTarget.id);
      setProjects(prev => prev.filter(p => p.id !== delTarget.id));
      setDelNotice(summary.filesOrphaned > 0
        ? t('admin.del.projectOrphaned', { name: summary.name, count: summary.filesOrphaned })
        : t('admin.del.projectDeleted', {
            name:      summary.name,
            stages:    summary.stages,
            documents: summary.documents,
            messages:  summary.messages,
            files:     summary.filesRemoved,
          }));
      setDelTarget(null);
    } catch (err) {
      // The guards live in the database, so its messages are the authoritative ones.
      const msg = errorMessage(err, '');
      setDelError(
        msg.includes('not_found') ? t('admin.del.projectNotFound')
        : t('admin.del.failed'),
      );
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        // `profiles!inner(...)` used to be embedded here. PostgREST cannot infer that
        // relationship — projects.user_id references auth.users, not profiles — so the
        // request 400'd and this page always read "0 total". Owners are resolved
        // separately now, which also keeps a project visible when its owner has no
        // profile row (the `!inner` would have dropped it even if the join worked).
        // Health is derived, never stored, so filtering by it means computing it — which
        // needs the stage rows and the activity stamps. Both are loaded here rather than
        // only when `?health=` is present: the column is worth showing either way, and
        // two extra reads over a fleet this size cost less than a filter that is
        // sometimes available and sometimes not.
        const [{ data }, owners, stagesRes, activityRes] = await Promise.all([
          supabase
            .from('projects')
            .select('id, name, user_id, tier, status, current_stage, country, created_at, tracking_started_at, updated_at')
            .order('created_at', { ascending: false }),
          ownerLookup(),
          supabase.from('project_stages')
            .select('project_id, stage_number, name, stage_key, status, payment_status, planned_end, completed_at'),
          supabase.rpc('admin_project_activity'),
        ]);

        const stagesBy = new Map<string, Record<string, unknown>[]>();
        for (const row of (stagesRes.data ?? []) as Record<string, unknown>[]) {
          const id = row.project_id as string;
          stagesBy.set(id, [...(stagesBy.get(id) ?? []), row]);
        }
        // Fail-soft, exactly as the Overview is: without 084 the stamps are empty and
        // `projectHealth` leans on `updated_at`. It never guesses.
        const stampsBy = new Map<string, ActivityStamps>();
        if (!activityRes.error) {
          for (const r of (activityRes.data ?? []) as Record<string, unknown>[]) {
            stampsBy.set(r.project_id as string, {
              lastEvidenceAt: (r.last_evidence_at as string | null) ?? null,
              lastReviewAt:   (r.last_review_at   as string | null) ?? null,
              lastMessageAt:  (r.last_message_at  as string | null) ?? null,
              lastAuditAt:    (r.last_audit_at    as string | null) ?? null,
            });
          }
        }
        const now = new Date();

        setProjects((data ?? []).map((p: Record<string, unknown>) => {
          const profile = owners.get(p.user_id as string);
          return {
            id:           p.id as string,
            name:         p.name as string,
            ownerEmail:   profile?.email ?? '',
            ownerName:    profile?.name ?? '',
            tier:         p.tier as string,
            status:       p.status as string,
            currentStage: p.current_stage as number,
            country:      p.country as string,
            createdAt:    p.created_at as string,
            health: projectHealth(
              p as unknown as Parameters<typeof projectHealth>[0],
              (stagesBy.get(p.id as string) ?? []) as unknown as Parameters<typeof projectHealth>[1],
              stampsBy.get(p.id as string) ?? {},
              now,
            ).band,
          };
        }));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filters compose: the URL's condition first, then whatever is typed in the box.
  const inFilter = useMemo(
    () => projects.filter(p =>
      (!statusFilter || matchesStatusFilter(p.status, statusFilter)) &&
      (!healthFilter || p.health === healthFilter)),
    [projects, statusFilter, healthFilter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inFilter;
    return inFilter.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.ownerEmail.toLowerCase().includes(q) ||
      p.ownerName.toLowerCase().includes(q));
  }, [inFilter, query]);

  const filterLabel = healthFilter
    ? t(HEALTH_LABEL[healthFilter])
    : statusFilter
      ? t(`admin.filter.status.${statusFilter}` as TKey)
      : '';

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.allProjects')}</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.filter.total', { n: projects.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/projects/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-near-black px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-rich-black"
          >
            <Plus className="size-4" /> {t('admin.newProject.button')}
          </Link>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey" />
          <input
            type="text"
            placeholder={t('admin.searchProjects')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-brand-border-grey rounded-xl outline-none focus:ring-2 focus:ring-brand-near-black/20 bg-white w-56"
          />
        </div>
        </div>
      </div>

      {filterLabel && !loading && (
        <FilterBanner label={filterLabel} shown={inFilter.length} total={projects.length} onClear={clearFilters} />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-border-grey overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border-grey bg-brand-off-white">
              <tr>
                {['Project', 'Owner', 'Tier', 'Status', 'Stage', 'Created', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-brand-off-white transition-colors">
                  <td className="px-4 py-3 font-medium text-brand-near-black max-w-[200px] truncate">{p.name}</td>
                  <td className="px-4 py-3 text-brand-mid-grey max-w-[160px] truncate">
                    <span title={p.ownerEmail}>{p.ownerName || p.ownerEmail}</span>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey">{labels.tier(p.tier)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[p.status] ?? ''}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey tabular-nums">{p.currentStage} / 10</td>
                  <td className="px-4 py-3 text-brand-mid-grey text-xs">
                    {new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setAssignTarget(p); setAssignEmail(''); setAssignError(null); }}
                        className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
                        title={t('admin.assignContractor')}
                      >
                        <UserPlus className="size-4" />
                      </button>
                      {verAvailable && (
                        <button
                          type="button"
                          onClick={() => setVerTarget(p)}
                          className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
                          title={t('admin.verifier.assign')}
                          aria-label={`${t('admin.verifier.assign')} ${p.name}`}
                        >
                          <ShieldCheck className="size-4" />
                        </button>
                      )}
                      <Link
                        to={`/projects/${p.id}`}
                        target="_blank"
                        className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
                        title={t('admin.viewProject')}
                      >
                        <ExternalLink className="size-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => { setDelTarget(p); setDelError(null); }}
                        className="text-brand-mid-grey transition-colors hover:text-state-alert"
                        title={t('admin.del.deleteProject')}
                        aria-label={`${t('admin.del.deleteProject')} ${p.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-brand-mid-grey">
                    {t('admin.noProjectsMatch', { query: query || filterLabel })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {assignDone && (
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-near-black">
          {t('admin.assignedNotice', { detail: assignDone })}
        </p>
      )}

      {verNotice && (
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-near-black">
          {verNotice}
        </p>
      )}
      {!verAvailable && (
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-mid-grey">
          {t('admin.verifier.notAvailable')}
        </p>
      )}

      {verTarget && (
        <AssignVerifierModal
          project={verTarget}
          onClose={() => setVerTarget(null)}
          onAssigned={notice => { setVerNotice(notice); setVerTarget(null); }}
          onUnavailable={() => { setVerAvailable(false); setVerTarget(null); }}
        />
      )}

      {delNotice && (
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-near-black">
          {delNotice}
        </p>
      )}

      {/*
        The consequence is spelled out per project rather than as a generic warning: the
        free-plan half is the part nobody expects, and it only applies to a free-tier
        project. See migration 069 — this genuinely does hand the owner a slot back.
      */}
      <ConfirmDelete
        open={!!delTarget}
        subject={delTarget?.name ?? ''}
        consequence={delTarget ? [
          t('admin.del.projectConsequence'),
          isFreeTier(delTarget.tier)
            ? t('admin.del.projectFreesSlot', {
                plan:  labels.tier(delTarget.tier),
                owner: delTarget.ownerName || delTarget.ownerEmail,
              })
            : '',
        ].filter(Boolean).join(' ') : undefined}
        busy={deleting}
        error={delError}
        onConfirm={handleDelete}
        onCancel={() => { setDelTarget(null); setDelError(null); }}
      />

      {assignTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAssignTarget(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-6"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-sm font-bold text-brand-near-black">{t('admin.assignTitle')}</h2>
            <p className="mt-1 text-xs text-brand-mid-grey">
              {t('admin.assignBodyPre')}{' '}
              <span className="font-medium text-brand-near-black">{assignTarget.name}</span>{' '}
              {t('admin.assignBodyPost')}
            </p>

            <input
              type="email"
              autoFocus
              value={assignEmail}
              onChange={e => setAssignEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAssign(); }}
              placeholder={t('admin.assignEmailPlaceholder')}
              aria-label={t('admin.assignEmailLabel')}
              className="mt-4 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
            />

            {assignError && (
              <p className="mt-2 text-xs text-state-alert" role="alert">{assignError}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={assigning || !assignEmail.trim()}
                className="flex-1 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {assigning ? t('admin.assigning') : t('admin.assign')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
