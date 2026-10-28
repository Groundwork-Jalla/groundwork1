import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { WizardFormData, ConstructionRate, CityRate } from '@/types/project';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { getCityRate, getConstructionRate } from '@/lib/supabase/construction-rates';
import { clearWizardDraft, readWizardDraft, writeWizardDraft, type WizardConfirmationDraft } from '@/lib/projects/wizard-draft';
import type { BqLineItem, BqReading } from '@/lib/budget/read-bq-total';
import type { FloorPlanFacts } from '@/lib/budget/extract-bq';

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
import type { ProjectTier } from '@/types/project';

export interface OnBehalfOf {
  userId: string;
  /** Shown in the wizard so the person running it can see whose project this is. */
  label: string;
  /**
   * The plan this project is created on, or null to ask in the wizard's own plan step.
   *
   * Admin-managed builds use Jalla Management. A partner creating a project for their
   * own client uses Self Verify automatically. Both skip the plan picker, and the final
   * step saves this fixed tier even though the skipped picker never updates data.tier.
   */
  tier: ProjectTier | null;
  /**
   * Who is running the wizard for somebody else.
   *
   * This used to be implicit: `onBehalfOf` meant "an admin", and the final step called
   * admin-only RPCs and returned to /admin/projects. Since 109 a partner contractor can
   * do it too, for a client they brought on — same wizard, different caller, different
   * place to land afterwards. Leaving it implicit would have sent a contractor to an
   * admin page they cannot open.
   */
  by: 'admin' | 'partner';
}

export interface DocumentExtraction {
  bqReading: BqReading | null;
  bqLineItems: BqLineItem[];
  floorPlans: { fileName: string; facts: FloorPlanFacts }[];
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
  /**
   * Clear persisted wizard state without mutating the currently rendered step.
   *
   * Used right before leaving the wizard after successful project creation, so we do
   * not briefly render step 1 while navigation is in flight.
   */
  clearDraft: () => void;
  /** Present when an admin or partner contractor creates the project for a client. */
  onBehalfOf: OnBehalfOf | null;
  /** Available only when this provider opts into saving a scoped contractor draft. */
  confirmationDraft?: WizardConfirmationDraft | null;
  updateConfirmationDraft?: (patch: Partial<WizardConfirmationDraft>) => void;
  persistProgress?: boolean;
  /** Leave this client's wizard while preserving its draft for later. */
  onChangeClient?: () => void;
  /** Floor plan and bill of quantities, awaiting a project to attach them to. */
  pendingDocuments?: { file: File; category: 'other' | 'boq' }[];
  /**
   * Set when the architecture-plan question is answered mid-wizard.
   *
   * Held here rather than in `data` because a `File` is not serialisable: writing one
   * into the saved draft stores `{}` and the file is silently lost. They live for as
   * long as this tab's wizard does, which is exactly until the project exists.
   */
  setPendingDocuments?: (docs: { file: File; category: 'other' | 'boq' }[]) => void;
  documentExtraction: DocumentExtraction | null;
  setDocumentExtraction: (extraction: DocumentExtraction | null) => void;
}

// =========================================================
// Context
// =========================================================
const WizardContext = createContext<WizardContextValue | null>(null);

// 9: five setup steps, roof, details, summary, and budget confirmation.
export const TOTAL_STEPS = 9;

// =========================================================
// Provider
// =========================================================
export function WizardProvider({
  children, onBehalfOf = null, persistenceKey, onReset, onChangeClient, seed, pendingDocuments,
}: {
  children: ReactNode; onBehalfOf?: OnBehalfOf | null;
  persistenceKey?: string; onReset?: () => void;
  onChangeClient?: () => void;
  /**
   * Answers collected BEFORE the wizard started — today, the architecture-plan
   * question. Applied over a restored draft, because the question is asked afresh
   * each time this flow is entered and its answer is the newer one.
   */
  seed?: Partial<WizardFormData>;
  /**
   * Files gathered before the wizard started — the floor plan and the bill of
   * quantities from the architecture-plan question.
   *
   * They travel as `File` objects rather than through `seed`, because a File cannot
   * be serialised into the saved draft, and they are uploaded only once a project id
   * exists to attach them to.
   */
  pendingDocuments?: { file: File; category: 'other' | 'boq' }[];
}) {
  // A different actor/client key must get a fresh state instance, even if the route
  // keeps the provider mounted while switching the client being worked on.
  return <WizardStateProvider key={persistenceKey ?? 'memory'} {...{ onBehalfOf, persistenceKey, onReset, onChangeClient, seed, pendingDocuments }}>
    {children}
  </WizardStateProvider>;
}

function WizardStateProvider({ children, onBehalfOf, persistenceKey, onReset, onChangeClient, seed, pendingDocuments }: {
  children: ReactNode; onBehalfOf: OnBehalfOf | null;
  persistenceKey?: string; onReset?: () => void;
  onChangeClient?: () => void;
  seed?: Partial<WizardFormData>;
  pendingDocuments?: { file: File; category: 'other' | 'boq' }[];
}) {
  const [saved] = useState(() => readWizardDraft(persistenceKey));
  const [docs, setDocs] = useState<{ file: File; category: 'other' | 'boq' }[]>(
    () => pendingDocuments ?? []);
  const [documentExtraction, setDocumentExtraction] = useState<DocumentExtraction | null>(null);
  const [step, setStep]           = useState(saved?.step ?? 1);
  const [direction, setDirection] = useState<WizardDirection>(saved?.direction ?? 'forward');
  // Seed last: it is this run's answer to a question asked a moment ago, so it wins
  // over whatever a restored draft remembers.
  //
  // Fresh wizards start with no country selected, so step 1 reflects an explicit
  // choice rather than a hidden default.
  const [data, setData]           = useState<WizardFormData>(
    { ...(saved?.data ?? { ...WIZARD_DEFAULT_DATA, country: '' }), ...(seed ?? {}) });
  const [confirmationDraft, setConfirmationDraft] = useState<WizardConfirmationDraft | null>(saved?.confirmation ?? null);
  const draftCleared = useRef(false);

  const [constructionRate, setConstructionRate] = useState<ConstructionRate | null>(null);
  const [cityRate, setCityRate]                 = useState<CityRate | null>(null);
  const [rateLoading, setRateLoading]           = useState(false);
  const planDocumentsReady = docs.some(doc => doc.category === 'boq')
    && docs.some(doc => doc.category === 'other');
  const totalSteps = data.hasArchitecturePlan === true && planDocumentsReady ? 5 : TOTAL_STEPS;

  useEffect(() => {
    if (data.hasArchitecturePlan === true && planDocumentsReady && step >= 4 && step <= 7) {
      setDirection('forward');
      setStep(8);
    }
  }, [data.hasArchitecturePlan, planDocumentsReady, step]);

  useEffect(() => {
    if (draftCleared.current) return;
    writeWizardDraft(persistenceKey, { version: 1, step, direction, data,
      ...(confirmationDraft ? { confirmation: confirmationDraft } : {}),
    });
  }, [persistenceKey, step, direction, data, confirmationDraft]);

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
    draftCleared.current = false;
    setData(prev => ({ ...prev, ...patch }));
  }, []);

  const next = useCallback(() => {
    draftCleared.current = false;
    setDirection('forward');
    setStep(prev => data.hasArchitecturePlan === true && planDocumentsReady && prev === 3
      ? 8
      : Math.min(prev + 1, totalSteps));
  }, [data.hasArchitecturePlan, planDocumentsReady, totalSteps]);

  const back = useCallback(() => {
    draftCleared.current = false;
    setDirection('back');
    setStep(prev => data.hasArchitecturePlan === true && planDocumentsReady && prev === 8
      ? 3
      : Math.max(prev - 1, 1));
  }, [data.hasArchitecturePlan, planDocumentsReady]);

  const goTo = useCallback((n: number) => {
    draftCleared.current = false;
    setDirection(n > step ? 'forward' : 'back');
    setStep(Math.max(1, Math.min(n, totalSteps)));
  }, [step, totalSteps]);

  const reset = useCallback(() => {
    // Clear before resetting state; the resulting effect must not save a blank draft
    // after successful project creation or while the route is unmounting.
    draftCleared.current = true;
    clearWizardDraft(persistenceKey);
    setConfirmationDraft(null);
    setStep(1);
    setDirection('forward');
    setData(WIZARD_DEFAULT_DATA);
    setConstructionRate(null);
    setCityRate(null);
    onReset?.();
  }, [persistenceKey, onReset]);

  const clearDraft = useCallback(() => {
    draftCleared.current = true;
    clearWizardDraft(persistenceKey);
    onReset?.();
  }, [persistenceKey, onReset]);

  const updateConfirmationDraft = useCallback((patch: Partial<WizardConfirmationDraft>) => {
    draftCleared.current = false;
    setConfirmationDraft(previous => ({
      raw: '', alreadyStarted: false, described: '', stageOverride: null, hadAttachment: false,
      ...previous, ...patch,
    }));
  }, []);

  return (
    <WizardContext.Provider
      value={{
        step, totalSteps, direction, data,
        constructionRate, cityRate, rateLoading,
        update, next, back, goTo, reset,
        clearDraft,
        onBehalfOf,
        onChangeClient,
        pendingDocuments: docs,
        setPendingDocuments: setDocs,
        documentExtraction, setDocumentExtraction,
        confirmationDraft, updateConfirmationDraft,
        ...(persistenceKey ? { persistProgress: true } : {}),
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
