import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Wallet, History, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { updatePaymentStatus } from '@/lib/supabase/projects';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import { normalizeTier } from '@/lib/payments/config';
import { useT, type TKey } from '@/lib/i18n';
import EscrowWallet from '@/components/payments/EscrowWallet';
import PaymentHistory from '@/components/payments/PaymentHistory';
import MilestonePaymentModal from '@/components/payments/MilestonePaymentModal';
import PayoutStatusModal from '@/components/payments/PayoutStatusModal';
import type { ProjectRow, ProjectStageRow, PaymentStatus, ConstructionRate } from '@/types/project';

type View = 'wallet' | 'history';

export default function ProjectPayments({
  project, stages, onPaymentUpdated,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  onPaymentUpdated: (stageId: string, status: PaymentStatus) => void;
}) {
  const t = useT();
  const [view, setView]   = useState<View>('wallet');
  const [rate, setRate]   = useState<ConstructionRate | null>(null);
  const [payStage, setPayStage]       = useState<ProjectStageRow | null>(null);
  const [payoutStage, setPayoutStage] = useState<ProjectStageRow | null>(null);
  const [contractor, setContractor]   = useState('Your contractor');

  const tier = normalizeTier(project.tier);

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

  async function confirmPayment(stage: ProjectStageRow) {
    await updatePaymentStatus(stage.id, 'paid');
    onPaymentUpdated(stage.id, 'paid');
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
        tier={tier}
        rate={rate}
        contractorLabel={contractor}
        onClose={() => setPayoutStage(null)}
      />
    </div>
  );
}
