import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Lock, AlertCircle, BadgeCheck, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

// Typical stage durations in days (indices 0-9 = stages 1-10)
const STAGE_DAYS = [14, 21, 7, 14, 70, 14, 14, 21, 14, 7];

// ── Helpers ──────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateDiffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

interface ComputedStage {
  stage: ProjectStageRow;
  start: Date;
  end: Date;
  durationDays: number;
}

function computeTimeline(stages: ProjectStageRow[], project: ProjectRow): ComputedStage[] {
  const sorted = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  const anchor = new Date(project.target_start ?? project.created_at);

  let cursor = new Date(anchor);
  return sorted.map((stage, i) => {
    const start: Date = stage.planned_start
      ? new Date(stage.planned_start)
      : new Date(cursor);

    const durationDays = stage.planned_start && stage.planned_end
      ? dateDiffDays(new Date(stage.planned_start), new Date(stage.planned_end))
      : STAGE_DAYS[i] ?? 14;

    const end: Date = stage.planned_end
      ? new Date(stage.planned_end)
      : addDays(start, durationDays);

    if (!stage.planned_start) {
      cursor = addDays(end, 1);
    }
    return { stage, start, end, durationDays };
  });
}

// ── Status helpers ────────────────────────────────────────

function statusLabel(status: string): string {
  if (status === 'complete')       return 'Completed';
  if (status === 'active')         return 'In Progress';
  if (status === 'pending_review') return 'Awaiting Approval';
  return 'Upcoming';
}

function StatusPill({ status }: { status: string }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide';
  if (status === 'complete')
    return <span className={cn(base, 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black')}><CheckCircle2 className="size-2.5" />{statusLabel(status)}</span>;
  if (status === 'active')
    return <span className={cn(base, 'bg-brand-off-white dark:bg-[#282828] border border-brand-border-grey dark:border-[#3d3d3d] text-brand-near-black dark:text-white')}><Clock className="size-2.5" />{statusLabel(status)}</span>;
  if (status === 'pending_review')
    return <span className={cn(base, 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400')}><AlertCircle className="size-2.5" />{statusLabel(status)}</span>;
  return <span className={cn(base, 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-border-grey')}><Lock className="size-2.5" />{statusLabel(status)}</span>;
}

// ── List view ─────────────────────────────────────────────

function ListView({
  computed, project,
}: {
  computed: ComputedStage[];
  project: ProjectRow;
}) {
  const verificationLabel = project.tier === 'self_verify' || (project.tier as string) === 'starter'
    ? 'Self-verified'
    : 'Jalla Verified';
  const VerifyIcon = project.tier === 'self_verify' || (project.tier as string) === 'starter'
    ? BadgeCheck
    : ShieldCheck;

  return (
    <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
      {computed.map(({ stage, start, end, durationDays }) => {
        const completedDays = stage.completed_at
          ? dateDiffDays(start, new Date(stage.completed_at))
          : null;

        return (
          <motion.div
            key={stage.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-4 flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                {stage.status === 'complete'
                  ? <CheckCircle2 className="size-4 text-brand-near-black dark:text-white shrink-0" />
                  : stage.status === 'active' || stage.status === 'pending_review'
                    ? <Clock className="size-4 text-brand-near-black dark:text-white shrink-0" />
                    : <Lock className="size-3.5 text-brand-border-grey shrink-0" />}
                <span className={cn(
                  'text-sm font-medium truncate',
                  stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white',
                )}>
                  {stage.name}
                </span>
                <div className="flex items-center gap-1 text-[9px] text-brand-mid-grey border border-brand-border-grey dark:border-[#2c2c2c] rounded-full px-1.5 py-0.5 shrink-0">
                  <VerifyIcon className="size-2.5" />
                  {verificationLabel}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-brand-mid-grey whitespace-nowrap">
                  Est: {durationDays}d
                </span>
                <StatusPill status={stage.status} />
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
              {stage.status === 'complete' && (
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: '#22c55e' }}
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              )}
              {stage.status === 'active' && (
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: '#3b82f6', width: '50%' }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              {stage.status === 'pending_review' && (
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: '#f59e0b', width: '75%' }}
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </div>

            {/* Completion note */}
            {stage.status === 'complete' && completedDays !== null ? (
              <p className="text-[10px] text-brand-mid-grey">
                Completed in {completedDays}d · {fmtDate(start)} → {stage.completed_at ? fmtDate(new Date(stage.completed_at)) : fmtDate(end)}
              </p>
            ) : stage.status !== 'locked' ? (
              <p className="text-[10px] text-brand-mid-grey">
                {fmtDate(start)} → {fmtDate(end)}
              </p>
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Gantt view ────────────────────────────────────────────

function GanttView({
  computed, project, onGoToStages,
}: {
  computed: ComputedStage[];
  project: ProjectRow;
  onGoToStages: () => void;
}) {
  if (computed.length === 0) return null;

  const projStart = computed[0].start;
  const projEnd   = computed[computed.length - 1].end;
  const totalDays = Math.max(dateDiffDays(projStart, projEnd), 1);
  const today     = new Date();
  const todayPct  = Math.min(100, Math.max(0, (dateDiffDays(projStart, today) / totalDays) * 100));

  // Generate month labels
  const months: { label: string; pct: number }[] = [];
  const cursor = new Date(projStart);
  cursor.setDate(1);
  while (cursor <= projEnd) {
    const pct = (dateDiffDays(projStart, cursor) / totalDays) * 100;
    if (pct >= 0 && pct <= 100) {
      months.push({ label: fmtMonthYear(cursor), pct: Math.max(0, pct) });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 520 }}>
        {/* Month headers */}
        <div className="relative h-6 mb-2">
          {months.map(m => (
            <span
              key={m.label}
              className="absolute text-[9px] text-brand-mid-grey whitespace-nowrap"
              style={{ left: `calc(120px + ${m.pct}% * (100% - 120px) / 100)` }}
            >
              {m.label}
            </span>
          ))}
        </div>

        {/* Today marker label */}
        <div className="relative h-4 mb-1">
          {todayPct > 0 && todayPct < 100 && (
            <span
              className="absolute text-[9px] font-semibold text-brand-near-black dark:text-white whitespace-nowrap"
              style={{ left: `calc(120px + ${todayPct}% * (100% - 120px) / 100 - 16px)` }}
            >
              TODAY
            </span>
          )}
        </div>

        {/* Projected completion chip */}
        <div className="flex justify-end mb-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-border-grey dark:border-[#2c2c2c] px-2.5 py-1 text-[10px] font-medium text-brand-near-black dark:text-white">
            Projected completion: {fmtDate(projEnd)}
          </span>
        </div>

        {/* Stage rows */}
        <div className="flex flex-col gap-2">
          {computed.map(({ stage, start, end, durationDays }) => {
            const leftPct  = (dateDiffDays(projStart, start) / totalDays) * 100;
            const widthPct = Math.max((durationDays / totalDays) * 100, 1);
            const isComplete = stage.status === 'complete';
            const isActive   = stage.status === 'active';
            const isReview   = stage.status === 'pending_review';

            const barColor = isComplete ? '#22c55e'
              : isActive   ? '#3b82f6'
              : isReview   ? '#f59e0b'
              : '#d1d5db';

            const textColor = (isComplete || isActive || isReview) ? '#fff' : '#6b7280';

            return (
              <div key={stage.id} className="flex items-center gap-2 h-9">
                {/* Stage label */}
                <div
                  className="shrink-0 text-xs font-medium text-brand-near-black dark:text-white truncate"
                  style={{ width: 116 }}
                  title={stage.name}
                >
                  {stage.name}
                </div>

                {/* Bar track */}
                <div className="relative flex-1 h-7 bg-brand-light-grey dark:bg-[#282828] rounded-lg overflow-hidden">
                  {/* Today line */}
                  {todayPct > 0 && todayPct < 100 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 z-10 opacity-70"
                      style={{ left: `${todayPct}%`, backgroundColor: '#ef4444' }}
                    />
                  )}

                  {/* Stage bar */}
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{
                      position: 'absolute',
                      top: 3, bottom: 3,
                      left: `${Math.max(0, leftPct)}%`,
                      width: `${Math.min(widthPct, 100 - Math.max(0, leftPct))}%`,
                      originX: 0,
                      borderRadius: 5,
                      backgroundColor: barColor,
                    }}
                    onClick={onGoToStages}
                    title={`${stage.name} · ${durationDays}d`}
                    role="button"
                    tabIndex={0}
                  >
                    {durationDays > totalDays * 0.1 && (
                      <span
                        className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold"
                        style={{ color: textColor }}
                      >
                        {durationDays}d
                      </span>
                    )}
                  </motion.div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4 border-t border-brand-off-white dark:border-[#2c2c2c]">
          {[
            { color: '#22c55e', label: 'Completed' },
            { color: '#3b82f6', label: 'In progress' },
            { color: '#f59e0b', label: 'Awaiting approval' },
            { color: '#d1d5db', label: 'Upcoming' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] text-brand-mid-grey">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────

interface TimelineTabProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
  onGoToStages: () => void;
}

export default function TimelineTab({ project, stages, onGoToStages }: TimelineTabProps) {
  const [view, setView] = useState<'list' | 'gantt'>('list');
  const computed = useMemo(() => computeTimeline(stages, project), [stages, project]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-brand-near-black dark:text-white">Project Timeline</h2>
          {computed.length > 0 && (
            <p className="text-xs text-brand-mid-grey mt-0.5">
              {fmtDate(computed[0].start)} → {fmtDate(computed[computed.length - 1].end)}
            </p>
          )}
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
          {(['list', 'gantt'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                view === v
                  ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                  : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
        {view === 'list'
          ? <ListView computed={computed} project={project} />
          : <GanttView computed={computed} project={project} onGoToStages={onGoToStages} />}
      </div>
    </motion.div>
  );
}
