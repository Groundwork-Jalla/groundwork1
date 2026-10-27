import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { mustChangePassword, FORCED_PASSWORD_PATH } from '@/lib/auth/provisioned';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { WizardProvider, useWizard } from '@/contexts/WizardContext';
import { PlanQuestionStep } from '@/components/wizard/PlanQuestionStep';
import Step1Country        from '@/components/wizard/steps/Step1Country';
import Step2ProjectType    from '@/components/wizard/steps/Step2ProjectType';
import Step3BuildingType   from '@/components/wizard/steps/Step3BuildingType';
import Step4Floors         from '@/components/wizard/steps/Step4Floors';
import Step5Rooms          from '@/components/wizard/steps/Step5Rooms';
import Step7RoofType       from '@/components/wizard/steps/Step7RoofType';
import Step8Details        from '@/components/wizard/steps/Step8Details';
import Step9Summary        from '@/components/wizard/steps/Step9Summary';
import Step10PlanSelection from '@/components/wizard/steps/Step10PlanSelection';
import Step11ConfirmBudget from '@/components/wizard/steps/Step11ConfirmBudget';

// ── Step router ───────────────────────────────────────────

const STEPS: React.ComponentType[] = [
  Step1Country,
  Step2ProjectType,
  Step3BuildingType,
  Step4Floors,
  Step5Rooms,
  Step7RoofType,
  Step8Details,
  Step9Summary,
  Step10PlanSelection,
  Step11ConfirmBudget,
];

function WizardRouter() {
  const { step } = useWizard();
  const StepComponent = STEPS[step - 1];
  if (!StepComponent) return null;
  // The architecture-plan question sits between step 1 and step 2: after they have
  // said where they are building, before the eight questions its answer may make
  // unnecessary.
  return <PlanQuestionStep><StepComponent /></PlanQuestionStep>;
}

// ── Route ─────────────────────────────────────────────────

export default function NewProjectPage() {
  const navigate = useNavigate();
  const t = useT();
  const { session, loading } = useAuth();
  const [passwordCheck, setPasswordCheck] = useState<{ userId: string; cleared: boolean } | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const userId = session?.user.id;

  useEffect(() => {
    if (!loading && !session) navigate('/auth/login', { replace: true });
  }, [loading, session, navigate]);

  // This full-screen route sits outside the client shell, so it must enforce the
  // same password setup requirement before mounting any project creation state.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setPasswordCheck(null);
    mustChangePassword(userId).then(forced => {
      if (!alive) return;
      if (forced) navigate(FORCED_PASSWORD_PATH, { replace: true });
      else setPasswordCheck({ userId, cleared: true });
    }).catch(() => {
      if (alive) setPasswordCheck({ userId, cleared: false });
    });
    return () => { alive = false; };
  }, [userId, navigate, checkAttempt]);

  const checkedCurrentUser = passwordCheck?.userId === userId;
  if (!loading && session && checkedCurrentUser && passwordCheck?.cleared === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center dark:bg-brand-near-black">
        <p role="alert" className="text-sm text-brand-mid-grey">{t('errors.generic')}</p>
        <Button onClick={() => { setPasswordCheck(null); setCheckAttempt(attempt => attempt + 1); }}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (loading || !session || !checkedCurrentUser || !passwordCheck?.cleared) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-brand-near-black">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  return (
    <WizardProvider>
      <WizardRouter />
    </WizardProvider>
  );
}
