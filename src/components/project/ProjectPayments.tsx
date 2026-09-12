import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Wallet, History, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { notifyAdmins } from '@/lib/supabase/notifications';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import { normalizeTier } from '@/lib/payments/config';
import { useT, type TKey } from '@/lib/i18n';
import EscrowWallet from '@/components/payments/EscrowWallet';
import PaymentHistory from '@/components/payments/PaymentHistory';
import MilestonePaymentModal from '@/components/payments/MilestonePaymentModal';
import PayoutStatusModal from '@/components/payments/PayoutStatusModal';
import type { ProjectRow, ProjectStageRow, ConstructionRate } from '@/types/project';

type View = 'wallet' | 'history';

export default function ProjectPayments({
  project, stages, openPayStageId, onOpenPayStageHandled,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  /**
   * Open the payment modal for this stage as soon as the tab mounts.
   *
   * How "Record payment" on a blocked stage arrives here. The button does not open its
   * own modal: a second copy would mean a second confirm path for money, and the two
   * would drift. It switches to this tab and names the stage instead, so there stays
   * exactly one place a payment is written.
   */
  openPayStageId?: string | null;
  /** Called once the request has been honoured, so it does not re-fire on every render. */
  onOpenPayStageHandled?: () => void;
}) {
  const t = useT();
  const [view, setView]   = useState<View>('wallet');
  const [rate, setRate]   = useState<ConstructionRate | null>(null);
  const [payStage, setPayStage]       = useState<ProjectStageRow | null>(null);
  const [payoutStage, setPayoutStage] = useState<ProjectStageRow | null>(null);
  const [contractor, setContractor]   = useState('Your contractor');

  const tier = normalizeTier(project.tier);

  useEffect(() => {
    if (!openPayStageId) return;
    const target = stages.find(s => s.id === openPayStageId);
    if (target) setPayStage(target);
    onOpenPayStageHandled?.();
  }, [openPayStageId, stages, onOpenPayStageHandled]);

  useEffect(() => {
    getConstructionRate(project.country).then(setRate).catch(() => {});
  }, [project.country]);

  useEffect(() => {
    supabase
      .from('contractor_invites')
      .select('email')
      .eq('project_id', project.id)
      .eq('status', 'accepted')
      .limit(1)
      .then(({ data }) => { if (data?.[0]?.email) setContractor(data[0].email); });
  }, [project.id]);

  // A client cannot mark their own stage as funded (090): received money is confirmed by
  // staff or by the provider, into the ledger, and `payment_status` follows from that.
  // Until the provider is wired, "Confirm payment" here tells Jalla the client has paid;
  // an admin confirms the tranche and the stage flips on its own (realtime, in detail.tsx).
  async function confirmPayment(stage: ProjectStageRow) {
    await notifyAdmins(
      'funding_reported',
      'Client reports a payment',
      `${project.name}: the client reports paying stage ${stage.stage_number} (${stage.name})`,
      { project_id: project.id, stage_id: stage.id, stage_number: stage.stage_number, amount_usd: stage.payment_milestone_usd ?? null },
    );
  }

  const canUpgrade = tier !== 'jalla_management';

  return (
    <div>
      {/* Header: view toggle + upgrade */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="inline-flex rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] p-1 bg-white dark:bg-[#1e1e1e]">
          {([['wallet', 'project.payments.wallet', Wallet], ['history', 'project.payments.history', History]] as [View, TKey, typeof Wallet][]).map(([id, labelKey, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors',
                view === id ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                            : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              <Icon className="size-3.5" /> {t(labelKey)}
            </button>
          ))}
        </div>
        {canUpgrade && (
          <Link
            to="/upgrade"
            className="inline-flex items-center gap-1 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-3.5 py-2 text-xs font-semibold text-brand-near-black dark:text-white hover:border-brand-near-black dark:hover:border-white transition-colors"
          >
            {t('project.payments.upgradePlan')} <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>

      {view === 'wallet' ? (
        <EscrowWallet
          project={project}
          stages={stages}
          onPay={setPayStage}
          onViewPayout={setPayoutStage}
        />
      ) : (
        <PaymentHistory
          project={project}
          stages={stages}
          tier={tier}
          rate={rate}
          onViewPayout={setPayoutStage}
        />
      )}

      <MilestonePaymentModal
        open={!!payStage}
        stage={payStage}
        tier={tier}
        rate={rate}
        projectName={project.name}
        contractorLabel={contractor}
        onConfirm={() => confirmPayment(payStage!)}
        onClose={() => setPayStage(null)}
      />

      <PayoutStatusModal
        open={!!payoutStage}
        stage={payoutStage}
        rate={rate}
        contractorLabel={contractor}
        onClose={() => setPayoutStage(null)}
      />
    </div>
  );
}
