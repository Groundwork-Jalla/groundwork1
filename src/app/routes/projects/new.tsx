import { WizardProvider, useWizard } from '@/contexts/WizardContext';
import Step1Country        from '@/components/wizard/steps/Step1Country';
import Step2ProjectType    from '@/components/wizard/steps/Step2ProjectType';
import Step3BuildingType   from '@/components/wizard/steps/Step3BuildingType';
import Step4Floors         from '@/components/wizard/steps/Step4Floors';
import Step5Rooms          from '@/components/wizard/steps/Step5Rooms';
import Step6BoysQuarters   from '@/components/wizard/steps/Step6BoysQuarters';
import Step7RoofType       from '@/components/wizard/steps/Step7RoofType';
import Step8Details        from '@/components/wizard/steps/Step8Details';
import Step9Summary        from '@/components/wizard/steps/Step9Summary';
import Step10PlanSelection from '@/components/wizard/steps/Step10PlanSelection';

// ── Step router ───────────────────────────────────────────

const STEPS: React.ComponentType[] = [
  Step1Country,
  Step2ProjectType,
  Step3BuildingType,
  Step4Floors,
  Step5Rooms,
  Step6BoysQuarters,
  Step7RoofType,
  Step8Details,
  Step9Summary,
  Step10PlanSelection,
];

function WizardRouter() {
  const { step } = useWizard();
  const StepComponent = STEPS[step - 1];
  if (!StepComponent) return null;
  return <StepComponent />;
}

// ── Route ─────────────────────────────────────────────────

export default function NewProjectPage() {
  return (
    <WizardProvider>
      <WizardRouter />
    </WizardProvider>
  );
}
