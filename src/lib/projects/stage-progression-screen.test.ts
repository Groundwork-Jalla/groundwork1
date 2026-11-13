import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { ApproveStageResult, StagePayment } from '@/lib/supabase/verifications';

const h = vi.hoisted(() => ({
  scope: 'tracker', index: 0, hooks: new Map<string, any[]>(), pendingEffects: [] as (() => void)[],
  approve: vi.fn(), mark: vi.fn(), changed: vi.fn(), certificates: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const values = h.hooks.get(h.scope) ?? []; h.hooks.set(h.scope, values);
    const index = h.index++;
    if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
    return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const values = h.hooks.get(h.scope) ?? []; h.hooks.set(h.scope, values);
    const index = h.index++;
    return values[index] ?? (values[index] = { current: initial });
  },
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const values = h.hooks.get(h.scope) ?? []; h.hooks.set(h.scope, values);
    const index = h.index++, previous = values[index];
    if (previous && dependencies.every((value, at) => Object.is(value, previous.dependencies[at]))) return;
    h.pendingEffects.push(() => { previous?.cleanup?.(); values[index] = { dependencies, cleanup: effect() }; });
  },
}));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, AnimatePresence: 'presence' }));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => key + (values ? JSON.stringify(values) : ''),
  useLanguage: () => ({ lang: 'en' }),
}));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({
  stageLabel: (stage: ProjectStageRow) => `Stage ${stage.stage_number}`, substageLabel: (sub: ProjectSubstageRow) => sub.id,
}) }));
vi.mock('@/lib/budget/project-money-context', () => ({ useMoney: () => String,
  useProjectMoneyContext: () => ({ code: 'USD', rate: 1 }) }));
vi.mock('@/lib/supabase/verifications', () => ({
  uploadStagePaymentReceipt: vi.fn(), confirmStagePayment: vi.fn(), signReceiptUrl: vi.fn(),
}));
vi.mock('@/lib/supabase/certificates', () => ({ fetchProjectCertificates: h.certificates }));
vi.mock('@/components/project/DocumentViewer', () => ({ DocumentViewer: 'document-viewer' }));
vi.mock('@/components/project/EvidenceThumbs', () => ({ EvidenceThumbs: () => null }));

import { StageTracker, type StageTrackerProps } from '@/components/project/StageTracker';
import { StagePaymentGate } from '@/components/project/StagePaymentGate';
import { SubstageRow } from '@/components/project/SubstageRow';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

type Element = { type: any; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Element).props.children);
  return typeof value === 'string' ? value : '';
}
function component(fn: (props: any) => unknown, props: any, scope: string): Element[] {
  h.scope = scope; h.index = 0; h.pendingEffects = [];
  const result = nodes(fn(props));
  for (const effect of h.pendingEffects) effect();
  return result;
}
const stage = (number: number, status: ProjectStageRow['status'] = 'locked', extra: Partial<ProjectStageRow> = {}): ProjectStageRow => ({
  id: `s${number}`, project_id: 'project', stage_number: number, status, payment_status: 'paid',
  payment_milestone_usd: 100, milestone_amount: 100, budget_pct: 10, pre_existing: false, ...extra,
} as ProjectStageRow);
const payment = (stageId = 's1', state: StagePayment['state'] = 'funded'): StagePayment => ({
  id: `pay-${stageId}`, stageId, state, amount: 100, receiptPath: null, receiptUploadedAt: null,
});
const substage = (status: ProjectSubstageRow['status'] = 'complete'): ProjectSubstageRow => ({
  id: 'sub-one', stage_id: 's1', project_id: 'project', status, evidence_urls: ['evidence.png'], approved_by: 'client',
} as ProjectSubstageRow);
const result = (extra: Partial<ApproveStageResult> = {}): ApproveStageResult => ({
  projectId: 'project', stageId: 's1', stageNumber: 1, isFinal: false,
  nextStageId: 's2', nextStageNumber: 2, verificationId: null, awaitingPayment: true, ...extra,
});
let props: StageTrackerProps;
function tracker(): Element[] { return component(StageTracker, props, 'tracker'); }
function detailElement(elements = tracker()): Element {
  return elements.find(node => node.type?.name === 'StageDetail')!;
}
function detail(): Element[] {
  const selected = detailElement();
  return component(selected.type, selected.props, `${props.projectId}:detail:${selected.props.stage.id}`);
}
function modal(elements = detail()): Element { return elements.find(node => node.type === ConfirmModal)!; }
function chooseStage(number: number) {
  const button = tracker().find(node => node.type === 'button'
    && nodes(node.props.children).some(child => child.type?.name === 'StageCircle' && child.props.number === number));
  button!.props.onClick();
}
function openNextStage(number: number) {
  const button = tracker().find(node => node.type === 'button' && text(node).includes(`project.receiptFlow.openStage{"n":${number}}`));
  expect(button).toBeDefined();
  button!.props.onClick();
}
beforeEach(() => {
  vi.clearAllMocks(); h.scope = 'tracker'; h.index = 0; h.hooks.clear(); h.pendingEffects = [];
  h.certificates.mockResolvedValue(new Map());
  h.approve.mockResolvedValue(result()); h.mark.mockResolvedValue(undefined); h.changed.mockResolvedValue(undefined);
  props = { stages: [stage(1, 'active'), stage(2), stage(3)], substages: [substage()], tier: 'self_verify',
    canApprove: true,
    userId: 'client', projectId: 'project', projectName: 'Build', projectCountry: 'US', projectCity: null, ownerName: 'Client',
    payments: new Map([['s1', payment()], ['s2', payment('s2', 'expected')], ['s3', payment('s3', 'expected')]]),
    onMarkSubstageComplete: h.mark, onEvidenceUploaded() {}, onApproveStage: h.approve,
    onPaymentChanged: h.changed, renderEvidenceUpload: () => null };
});

describe('approval explains the next action before opening the next stage', () => {
  it('requests payment for the reviewed first contractor-created stage before advancing', async () => {
    props.workflowOrigin = 'contractor'; props.payments!.set('s1', payment('s1', 'expected'));
    h.approve.mockResolvedValue(result({ nextStageId: 's1', nextStageNumber: 1, nextStageStatus: 'pending_review', awaitingReviewedStagePayment: true }));
    await detailElement().props.onApproveStage('s1', 1);
    const selected = detailElement();
    expect(selected.props.stage).toMatchObject({ id: 's1', status: 'pending_review', review_payment_pending: true });
    expect(selected.props.workAllowed).toBe(false);
    const gate = detail().find(node => node.type === StagePaymentGate)!;
    expect(gate.props).toMatchObject({ stageId: 's1', canUpload: true, workReviewed: true });
    expect(detail().some(node => node.type?.name === 'ApproveButton')).toBe(false);
    chooseStage(2);
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(false);
    props.stages = [stage(1, 'complete'), stage(2)];
    chooseStage(1); // Payment confirmation arrives through realtime/full project refresh.
    expect(detailElement().props.stage.status).toBe('complete');
  });
  it('keeps reviewed work visible and opens the next receipt form on request before refresh', async () => {
    props.substages = [substage('pending_review')]; h.mark.mockResolvedValue(result());
    const before = detailElement();
    await before.props.onMarkSubstageComplete('sub-one');
    expect(detailElement().props.stage.id).toBe('s1');
    openNextStage(2);
    const next = detailElement();
    expect(next.props.stage.id).toBe('s2'); expect(next.props.canAct).toBe(true);
    const gate = detail().find(node => node.type === StagePaymentGate)!;
    expect(gate.props.stageId).toBe('s2'); expect(gate.props.payment.state).toBe('expected');
  });

  it('stays on the stage when approving an earlier substage does not complete it', async () => {
    await detailElement().props.onMarkSubstageComplete('sub-one');
    expect(detailElement().props.stage.id).toBe('s1');
  });

  it('uses the exact server successor when the screen was several stages out of date', async () => {
    h.approve.mockResolvedValue(result({ nextStageId: 's3', nextStageNumber: 3 }));
    await detailElement().props.onApproveStage('s1', 1);
    openNextStage(3);
    expect(detailElement().props.stage.id).toBe('s3');
    expect(detailElement().props.canAct).toBe(true);
  });

  it('shows the prefunded successor open without asking for another receipt', async () => {
    h.approve.mockResolvedValue(result({ awaitingPayment: false }));
    props.payments!.set('s2', { ...payment('s2'), receiptAmount: 100, receiptCurrency: 'USD', receiptAmountUsd: 100 });
    await detailElement().props.onApproveStage('s1', 1);
    openNextStage(2);
    expect(detailElement().props.stage.status).toBe('active');
    const gate = detail().find(node => node.type === StagePaymentGate)!;
    expect(component(StagePaymentGate, gate.props, 'gate').some(node => node.type === 'form')).toBe(false);
  });

  it('shows final completion without a new payment prompt', async () => {
    h.mark.mockResolvedValue(result({ stageId: 's3', stageNumber: 3, isFinal: true,
      nextStageId: null, nextStageNumber: null, awaitingPayment: false }));
    await detailElement().props.onMarkSubstageComplete('sub-one');
    expect(detailElement().props.stage.status).toBe('complete');
    expect(tracker().some(node => node.type === 'button' && text(node).includes('project.receiptFlow.openStage'))).toBe(false);
    expect(detail().some(node => node.type?.name === 'ApproveButton')).toBe(false);
  });

  it('follows a realtime transition when the user is viewing the current stage', () => {
    expect(detailElement().props.stage.id).toBe('s1');
    props.stages = [stage(1, 'complete'), stage(2, 'active'), stage(3)];
    expect(detailElement().props.stage.id).toBe('s2');
  });

  it('preserves intentional history browsing across unrelated refreshes and external progression', () => {
    props.stages = [stage(1, 'complete'), stage(2, 'active'), stage(3)];
    chooseStage(1);
    props.stages = [stage(1, 'complete'), stage(2, 'complete'), stage(3, 'active')];
    expect(detailElement().props.stage.id).toBe('s1');
  });

  it('does not override a navigation made while approval was in flight', async () => {
    let finish!: (value: ApproveStageResult) => void;
    h.approve.mockReturnValue(new Promise<ApproveStageResult>(resolve => { finish = resolve; }));
    const pending = detailElement().props.onApproveStage('s1', 1);
    chooseStage(3); finish(result()); await pending;
    expect(detailElement().props.stage.id).toBe('s3');
    expect(detailElement().props.canAct).toBe(false);
  });

  it('does not apply an old approval result to a newly opened project', async () => {
    let finish!: (value: ApproveStageResult) => void;
    h.mark.mockReturnValue(new Promise<ApproveStageResult>(resolve => { finish = resolve; }));
    const pending = detailElement().props.onMarkSubstageComplete('sub-one');
    props = { ...props, projectId: 'another-project', stages: [stage(4, 'active')], substages: [] };
    expect(detailElement().props.stage.id).toBe('s4');
    finish(result()); await pending;
    expect(detailElement().props.stage.id).toBe('s4');
  });
});

describe('only the current stage offers actions', () => {
  it('lets observers read stage updates without approval or receipt controls', () => {
    props.canApprove = false;
    props.substages = [substage('pending_review')];
    const elements = detail();
    expect(elements.find(node => node.type === StagePaymentGate)?.props.readOnly).toBe(true);
    expect(elements.find(node => node.type === SubstageRow)!.props.onMarkComplete).toBeUndefined();
    expect(elements.some(node => node.type?.name === 'ApproveButton')).toBe(false);
    props.substages = [substage()];
    expect(detail().some(node => node.type?.name === 'ApproveButton')).toBe(false);
  });
  it('shows payment disabled on a future locked stage', () => {
    chooseStage(3);
    expect(detailElement().props.canAct).toBe(false);
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(false);
    expect(detail().some(node => text(node).includes('project.stages.lockedBody'))).toBe(true);
  });

  it('starts contractor-created projects with evidence while leaving payment facts unpaid', () => {
    props.workflowOrigin = 'contractor'; props.payments!.set('s1', payment('s1', 'expected'));
    expect(detailElement().props.workAllowed).toBe(true);
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(false);
    props.stages[0].status = 'complete';
    expect(detailElement().props.stage.id).toBe('s2');
    expect(detailElement().props.workAllowed).toBe(false);
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(true);
  });

  it('exposes funding on an initially active unpaid stage and keeps its work blocked', () => {
    props.stages[0].payment_status = 'unpaid'; props.payments!.set('s1', payment('s1', 'receipt_submitted'));
    const elements = detail();
    expect(elements.some(node => node.type === StagePaymentGate && node.props.stageId === 's1')).toBe(true);
    const sub = elements.find(node => node.type === SubstageRow)!;
    expect(sub.props.stagePaid).toBe(false);
    expect(elements.some(node => node.type?.name === 'ApproveButton')).toBe(false);
  });

  it('offers retry guidance when a billed stage has no readable incoming row', () => {
    props.payments!.delete('s1');
    expect(detail().some(node => text(node).includes('project.stages.paymentDetailsMissing'))).toBe(true);
    expect(detail().some(node => node.type?.name === 'ApproveButton')).toBe(false);
  });

  it('collects a completed stage’s outstanding balance without enabling archived project writes', () => {
    props.stages = [stage(1, 'complete')]; props.projectPaused = true;
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(true);
    props.projectArchived = true;
    expect(detail().find(node => node.type === StagePaymentGate)?.props.canUpload).toBe(false);
  });

  it('shows the number of outstanding approvals instead of silently hiding progression', () => {
    props.substages = [substage('pending_review')];
    expect(detail().some(node => text(node).includes('"count":1'))).toBe(true);
  });

  it.each(['self_verify', 'jalla_verify', 'jalla_management', 'starter', 'pro', 'enterprise'])('permits direct client approval for legacy tier %s', tier => {
    props.tier = tier;
    props.stages[0].status = 'pending_review';
    expect(detail().some(node => node.type?.name === 'ApproveButton')).toBe(true);
  });

  it('lets a zero-cost stage with no substages finish without inventing a receipt', () => {
    props.stages = [stage(1, 'active', { payment_milestone_usd: 0, payment_status: 'unpaid' })];
    props.substages = []; props.payments = new Map();
    const elements = detail();
    expect(elements.some(node => node.type?.name === 'ApproveButton')).toBe(true);
    expect(elements.some(node => node.type === StagePaymentGate)).toBe(false);
  });
});

describe('stage approval can fail and retry safely', () => {
  function openApproval() {
    detail().find(node => node.type?.name === 'ApproveButton')!.props.onApprove();
    return modal();
  }

  it('keeps the modal open with a visible error after failure, then permits retry', async () => {
    h.approve.mockRejectedValueOnce(new Error('offline'));
    await openApproval().props.onConfirm();
    const failed = modal();
    expect(failed.props.open).toBe(true); expect(failed.props.loading).toBe(false);
    expect(failed.props.error).toBe('project.stages.approvalFailed');
    expect(component(ConfirmModal, failed.props, 'modal').some(node => node.props.role === 'alert')).toBe(true);
    await failed.props.onConfirm();
    expect(h.approve).toHaveBeenCalledTimes(2);
    expect(detailElement().props.stage.id).toBe('s1');
    openNextStage(2);
    expect(detailElement().props.stage.id).toBe('s2');
  });

  it('blocks a double confirmation while the first approval is in flight', async () => {
    let finish!: (value: ApproveStageResult) => void;
    h.approve.mockReturnValue(new Promise<ApproveStageResult>(resolve => { finish = resolve; }));
    const dialog = openApproval();
    const pending = dialog.props.onConfirm(); await dialog.props.onConfirm();
    expect(h.approve).toHaveBeenCalledOnce();
    finish(result()); await pending;
  });
});

describe('client review of pending legacy updates', () => {
  it.each([false, true])('clients can review pending evidence without upload or removal controls (global contractor=%s)', hasContractorRole => {
    props.isContractor = hasContractorRole;
    props.canUploadEvidence = false;
    const editor = vi.fn(() => 'evidence-uploader');
    props.renderEvidenceUpload = editor;
    const row = detail().find(node => node.type === SubstageRow)!;
    const elements = component(SubstageRow, { ...row.props, substage: substage('pending') }, 'substage');
    expect(row.props.canUploadEvidence).toBe(false);
    expect(editor).not.toHaveBeenCalled();
    expect(elements.some(node => node.type?.name === 'EvidencePills')).toBe(true);
    expect(elements.some(node => node.type === 'button' && text(node).includes('approveEvidence'))).toBe(true);
  });

  it('keeps a client’s empty substage as a waiting-for-contractor message', () => {
    props.renderEvidenceUpload = vi.fn(() => 'evidence-uploader');
    const row = detail().find(node => node.type === SubstageRow)!;
    const elements = component(SubstageRow, { ...row.props, substage: { ...substage('pending'), evidence_urls: [] } }, 'substage');
    expect(elements.some(node => text(node).includes('project.review.updatesWillAppear'))).toBe(true);
    expect(props.renderEvidenceUpload).not.toHaveBeenCalled();
    expect(elements.some(node => node.type === 'button')).toBe(false);
  });

  it('offers evidence authoring only to an assigned contractor on an open funded stage', () => {
    props.canApprove = false; props.isContractor = true; props.canUploadEvidence = true;
    const editor = vi.fn(() => 'evidence-uploader'); props.renderEvidenceUpload = editor;
    const row = detail().find(node => node.type === SubstageRow)!;
    const elements = component(SubstageRow, { ...row.props, substage: substage('pending') }, 'substage');
    expect(row.props.canUploadEvidence).toBe(true);
    expect(editor).toHaveBeenCalledOnce();
    expect(elements.some(node => node.type === 'button' && text(node).includes('approveEvidence'))).toBe(false);
    props.payments!.set('s1', payment('s1', 'expected'));
    expect(detail().find(node => node.type === SubstageRow)!.props.canUploadEvidence).toBe(false);
    props.payments!.set('s1', payment('s1'));
    props.projectPaused = true;
    expect(detail().find(node => node.type === SubstageRow)!.props.canUploadEvidence).toBe(false);
  });

  it('allows pending_review evidence to be approved and guards double clicks', async () => {
    const el = detail().find(node => node.type === SubstageRow)!;
    const subProps = { ...el.props, substage: substage('pending_review') };
    let finish!: () => void;
    h.mark.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const elements = component(SubstageRow, subProps, 'substage');
    const button = elements.find(node => node.type === 'button' && node.props.onClick?.name === 'handleMarkComplete')!;
    expect(text(button).trim()).toBe('project.stages.approveEvidence');
    const pending = button.props.onClick(); await button.props.onClick();
    expect(h.mark).toHaveBeenCalledOnce(); finish(); await pending;
  });

  it('does not approve an update before payment acknowledgment', () => {
    const el = detail().find(node => node.type === SubstageRow)!;
    const elements = component(SubstageRow, { ...el.props, substage: substage('pending_review'), stagePaid: false }, 'substage');
    expect(elements.some(node => node.type === 'button' && node.props.onClick?.name === 'handleMarkComplete')).toBe(false);
  });
});


describe('stage certificates reflect actual issuance', () => {
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  it.each(['self_verify', 'jalla_verify', 'jalla_management'])('completion in %s never invents a certificate', async tier => {
    props.tier = tier as typeof props.tier;
    props.stages = [stage(1, 'complete', { pre_existing: true }), stage(2, 'complete'), stage(3, 'active')];
    tracker(); await flush();
    expect(tracker().filter(node => node.type === 'button' && text(node).includes('project.stages.certificate'))).toHaveLength(0);
  });
  it('opens the formally issued PDF rather than generating one from stage status', async () => {
    props.stages = [stage(1, 'complete'), stage(2, 'active')];
    h.certificates.mockResolvedValue(new Map([['s1', { id: 'cert', stageId: 's1', pdfUrl: 'https://files.test/certificate.pdf' }]]));
    tracker(); await flush();
    const button = tracker().find(node => node.type === 'button' && text(node).includes('project.stages.certificate'))!;
    expect(button).toBeDefined(); button.props.onClick();
    expect(tracker().find(node => node.type === 'document-viewer')?.props.url).toBe('https://files.test/certificate.pdf');
    props.projectId = 'other-project';
    expect(tracker().find(node => node.type === 'document-viewer')).toBeUndefined();
  });
});

it('a historical stage keeps its allocation and says completed before tracking', () => {
  props.stages = [stage(1, 'complete', { pre_existing: true, milestone_amount: 300.025, payment_milestone_usd: 60.005 }), stage(2, 'active')];
  chooseStage(1);
  const elements = detail();
  const badge = elements.find(node => node.type?.name === 'StageBadge')!;
  expect(text(badge.type(badge.props))).toBe('project.costing.completedBeforeTracking');
  const amount = elements.find(node => node.type?.name === 'MoneyValue')!;
  expect(amount.props).toMatchObject({ amount: 300.025, usd: 60.005 });
  expect(elements.find(node => node.type === StagePaymentGate)).toBeUndefined();
});
