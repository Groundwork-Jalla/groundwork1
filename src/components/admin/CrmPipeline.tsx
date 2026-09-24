import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Search, AlertTriangle, ExternalLink } from 'lucide-react';
import { loadPipeline } from '@/lib/supabase/crm-pipeline';
import { LANES, laneCounts, daysIn, type Lane, type Lead, type Source, type SyncState } from '@/lib/admin/crm-pipeline';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Acquisition → CRM, the pipeline half (01 §3).
//
// The other half of /admin/crm answers "is GoHighLevel configured and is it keeping up".
// This answers the different question: who is in acquisition, where, and did the CRM
// hear about them. It reads no configuration and shows no secret.
//
// Every lane is a key already present in `ghl_stage_map`; every row is one real record
// from `profiles`, `contractor_applications`, `waitlist_emails` or `projects`. There is
// no score, no temperature, no conversion rate and no value, because no column holds any
// of them. See src/lib/admin/crm-pipeline.ts for why nothing is merged across tables.
// =========================================================

const LANE_KEY: Record<Lane, TKey> = {
  'waitlist':                      'admin.crm.pipeline.lane.waitlist',
  'user_signup':                   'admin.crm.pipeline.lane.signup',
  'contractor_application':        'admin.crm.pipeline.lane.application',
  'application_decision:accepted': 'admin.crm.pipeline.lane.accepted',
  'application_decision:rejected': 'admin.crm.pipeline.lane.rejected',
  'project_created':               'admin.crm.pipeline.lane.building',
};
const SOURCE_KEY: Record<Source, TKey> = {
  waitlist:    'admin.crm.pipeline.source.waitlist',
  signup:      'admin.crm.pipeline.source.signup',
  application: 'admin.crm.pipeline.source.application',
};
const SYNC_KEY: Record<SyncState, TKey> = {
  mirrored: 'admin.crm.pipeline.sync.mirrored',
  pending:  'admin.crm.pipeline.sync.pending',
  failed:   'admin.crm.pipeline.sync.failed',
  none:     'admin.crm.pipeline.sync.none',
  unknown:  'admin.crm.pipeline.sync.unknown',
};

export function CrmPipeline() {
  const t = useT();
  const [state, setState] = useState<{ leads: Lead[]; unreadable: string[] } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lane, setLane]   = useState<Lane | 'all'>('all');
  const [source, setSource] = useState<Source | 'all'>('all');

  useEffect(() => {
    let alive = true;
    loadPipeline()
      .then(r => { if (alive) { setState(r); setError(null); } })
      .catch(err => { if (alive) { setState(null); setError(errorMessage(err, t('common.somethingWrong'))); } });
    return () => { alive = false; };
  }, [t]);

  const counts = useMemo(() => (state ? laneCounts(state.leads) : null), [state]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    return state.leads
      .filter(l => lane === 'all' || l.lane === lane)
      .filter(l => source === 'all' || l.source === source)
      .filter(l => !q || (l.email ?? '').toLowerCase().includes(q) || (l.name ?? '').toLowerCase().includes(q));
  }, [state, query, lane, source]);

  if (state === undefined) {
    return <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
  }
  if (state === null) {
    return <p role="alert" className="rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-3 text-sm text-state-alert">{error}</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-brand-mid-grey">{t('admin.crm.pipeline.unit')}</p>

      {/* A domain that could not be read is named. Its rows are missing, not zero. */}
      {state.unreadable.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-state-held/40 bg-state-held/5 px-4 py-2.5 text-xs text-brand-near-black">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-state-held" aria-hidden />
          {t('admin.crm.pipeline.unreadable', { domains: state.unreadable.join(', ') })}
        </p>
      )}

      {/* ── The lanes, as counts of real rows ─────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {LANES.map(l => (
          <button
            key={l} type="button"
            onClick={() => setLane(lane === l ? 'all' : l)}
            aria-pressed={lane === l}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-left transition-colors',
              lane === l ? 'border-brand-near-black bg-brand-off-white' : 'border-brand-border-grey hover:border-brand-dark-grey',
            )}
          >
            <p className="text-lg font-bold tabular-nums text-brand-near-black">{counts![l]}</p>
            <p className="mt-0.5 text-[11px] leading-tight text-brand-mid-grey">{t(LANE_KEY[l])}</p>
          </button>
        ))}
      </div>

      {/* ── Filters, over real values only ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={lane === 'all'} onClick={() => setLane('all')}>{t('admin.crm.pipeline.allLanes')}</Chip>
        {(['waitlist', 'signup', 'application'] as Source[]).map(s => (
          <Chip key={s} active={source === s} onClick={() => setSource(source === s ? 'all' : s)}>
            {t(SOURCE_KEY[s])}
          </Chip>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.crm.pipeline.search')} aria-label={t('admin.crm.pipeline.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-brand-mid-grey">
          {state.leads.length === 0 ? t('admin.crm.pipeline.empty') : t('admin.crm.pipeline.emptyFiltered')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-border-grey">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="border-b border-brand-border-grey bg-brand-off-white/60 text-[11px] uppercase tracking-wide text-brand-mid-grey">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colWho')}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colLane')}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colSource')}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colAge')}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colSync')}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t('admin.crm.pipeline.colOpen')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(l => {
                const age = daysIn(l);
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-brand-near-black">{l.name ?? l.email ?? t('admin.crm.pipeline.noName')}</p>
                      {l.name && l.email && <p className="text-brand-mid-grey">{l.email}</p>}
                      {l.country && <p className="text-brand-mid-grey">{l.country}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-brand-near-black">{t(LANE_KEY[l.lane])}</td>
                    <td className="px-4 py-2.5 text-brand-mid-grey">{t(SOURCE_KEY[l.source])}</td>
                    <td className="px-4 py-2.5 tabular-nums text-brand-mid-grey">
                      {/* A decided application has no decision timestamp, so no age. */}
                      {age === null ? <span title={t('admin.crm.pipeline.ageUnknownHint')}>—</span> : t('admin.crm.pipeline.days', { n: age })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        l.sync === 'failed' ? 'bg-state-alert/10 text-state-alert'
                        : l.sync === 'mirrored' ? 'bg-state-complete/10 text-state-complete'
                        : 'bg-brand-light-grey text-brand-mid-grey',
                      )}>
                        {t(SYNC_KEY[l.sync])}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Only where a real key points somewhere. No link is guessed. */}
                      <div className="flex flex-wrap gap-2">
                        {l.projectId && (
                          <Link to={`/admin/projects/${l.projectId}`} className="inline-flex items-center gap-1 font-medium text-brand-near-black underline-offset-2 hover:underline">
                            {t('admin.crm.pipeline.openProject')}<ExternalLink className="size-3" />
                          </Link>
                        )}
                        {l.personId && l.email && (
                          <Link to={`/admin/clients?q=${encodeURIComponent(l.email)}`} className="inline-flex items-center gap-1 font-medium text-brand-near-black underline-offset-2 hover:underline">
                            {t('admin.crm.pipeline.openClient')}<ExternalLink className="size-3" />
                          </Link>
                        )}
                        {l.source === 'application' && (
                          <Link to="/admin/applications" className="inline-flex items-center gap-1 font-medium text-brand-near-black underline-offset-2 hover:underline">
                            {t('admin.crm.pipeline.openApplication')}<ExternalLink className="size-3" />
                          </Link>
                        )}
                        {!l.projectId && !l.personId && l.source === 'waitlist' && (
                          <span className="text-brand-mid-grey">{t('admin.crm.pipeline.noAccount')}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-near-black bg-brand-near-black text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
      )}
    >
      {children}
    </button>
  );
}
