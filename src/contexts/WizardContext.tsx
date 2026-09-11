import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { WizardFormData, ConstructionRate, CityRate } from '@/types/project';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { getCityRate, getConstructionRate } from '@/lib/supabase/construction-rates';

// =========================================================
// Types
// =========================================================
export type WizardDirection = 'forward' | 'back';

/**
 * Who the project is for, when it is not the person filling the wizard in.
 *
 * Jalla Management is the tier where Jalla runs the build, and the natural first step of
 * running it is setting the project up — which today only the client can do. With this
 * set, an admin walks the same eleven steps and the project is created as the client's:
 * their row, their dashboard, their access. The admin is recorded as its creator
 * (migration 082) and the tier is fixed to Management, which the tier guard trusts an
 * admin to set.
 */
export interface OnBehalfOf {
  userId: string;
  /** Shown in the wizard so the admin can see whose project they are building. */
  label: string;
  tier: 'jalla_management';
}

interface WizardContextValue {
  step: number;
  totalSteps: number;
  direction: WizardDirection;
  data: WizardFormData;
  constructionRate: ConstructionRate | null;
  cityRate: CityRate | null;
  rateLoading: boolean;
  update: (patch: Partial<WizardFormData>) => void;
  next: () => void;
  back: () => void;
  goTo: (n: number) => void;
  reset: () => void;
  /** Present only when an admin is creating the project for a client. */
  onBehalfOf: OnBehalfOf | null;
}

// =========================================================
// Context
// =========================================================
const WizardContext = createContext<WizardContextValue | null>(null);

// 11: …8 detail steps, 9 summary, 10 plan, 11 confirm budget (creates the project).
export const TOTAL_STEPS = 11;

// =========================================================
// Provider
// =========================================================
export function WizardProvider({
  children, onBehalfOf = null,
}: { children: ReactNode; onBehalfOf?: OnBehalfOf | null }) {
  const [step, setStep]           = useState(1);
  const [direction, setDirection] = useState<WizardDirection>('forward');
  const [data, setData]           = useState<WizardFormData>(WIZARD_DEFAULT_DATA);

  const [constructionRate, setConstructionRate] = useState<ConstructionRate | null>(null);
  const [cityRate, setCityRate]                 = useState<CityRate | null>(null);
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

  // City rates move independently of the country row — Kribi to Adamawa is a 1.45x spread
  // inside Cameroon, so the city has to be resolved every time it changes.
  useEffect(() => {
    if (!data.country) {
      setCityRate(null);
      return;
    }
    let cancelled = false;
    getCityRate(data.city, data.country).then(r => {
      if (!cancelled) setCityRate(r);
    });
    return () => { cancelled = true; };
  }, [data.country, data.city]);

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
    setCityRate(null);
  }, []);

  return (
    <WizardContext.Provider
      value={{
        step, totalSteps: TOTAL_STEPS, direction, data,
        constructionRate, cityRate, rateLoading,
        update, next, back, goTo, reset,
        onBehalfOf,
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
