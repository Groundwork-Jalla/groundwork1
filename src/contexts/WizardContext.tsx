import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { WizardFormData, ConstructionRate } from '@/types/project';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { getConstructionRate } from '@/lib/supabase/construction-rates';

// =========================================================
// Types
// =========================================================
export type WizardDirection = 'forward' | 'back';

interface WizardContextValue {
  step: number;
  totalSteps: number;
  direction: WizardDirection;
  data: WizardFormData;
  constructionRate: ConstructionRate | null;
  rateLoading: boolean;
  update: (patch: Partial<WizardFormData>) => void;
  next: () => void;
  back: () => void;
  goTo: (n: number) => void;
  reset: () => void;
}

// =========================================================
// Context
// =========================================================
const WizardContext = createContext<WizardContextValue | null>(null);

export const TOTAL_STEPS = 9;

// =========================================================
// Provider
// =========================================================
export function WizardProvider({ children }: { children: ReactNode }) {
  const [step, setStep]           = useState(1);
  const [direction, setDirection] = useState<WizardDirection>('forward');
  const [data, setData]           = useState<WizardFormData>(WIZARD_DEFAULT_DATA);

  const [constructionRate, setConstructionRate] = useState<ConstructionRate | null>(null);
  const [rateLoading, setRateLoading]           = useState(false);

  // Fetch rate once whenever the selected country changes
  useEffect(() => {
    if (!data.country) {
      setConstructionRate(null);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    getConstructionRate(data.country).then(rate => {
      if (!cancelled) {
        setConstructionRate(rate);
        setRateLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [data.country]);

  const update = useCallback((patch: Partial<WizardFormData>) => {
    setData(prev => ({ ...prev, ...patch }));
  }, []);

  const next = useCallback(() => {
    setDirection('forward');
    setStep(prev => Math.min(prev + 1, TOTAL_STEPS));
  }, []);

  const back = useCallback(() => {
    setDirection('back');
    setStep(prev => Math.max(prev - 1, 1));
  }, []);

  const goTo = useCallback((n: number) => {
    setDirection(n > step ? 'forward' : 'back');
    setStep(Math.max(1, Math.min(n, TOTAL_STEPS)));
  }, [step]);

  const reset = useCallback(() => {
    setStep(1);
    setDirection('forward');
    setData(WIZARD_DEFAULT_DATA);
    setConstructionRate(null);
  }, []);

  return (
    <WizardContext.Provider
      value={{
        step, totalSteps: TOTAL_STEPS, direction, data,
        constructionRate, rateLoading,
        update, next, back, goTo, reset,
      }}
    >
      {children}
    </WizardContext.Provider>
  );
}

// =========================================================
// Hook
// =========================================================
export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside <WizardProvider>');
  return ctx;
}
