import type { TKey } from '@/lib/i18n';

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

// =========================================================
// What a refused receipt upload or receipt decision means, in words (18 Nov).
//
// Moved out of StagePaymentGate so the contractor's "Did this payment arrive?" dialog
// and the stage payment panel name every refusal the same way.
// =========================================================

export function receiptErrorText(t: Translate, error: unknown): string {
  const value = error as { code?: string; message?: string; amount?: string; currency?: string; reference?: string } | null;
  const reason = `${value?.code ?? ''} ${value?.message ?? ''}`;
  const support = (message: string) => value?.reference ? `${message} ${t('project.receiptFlow.checkReference', { reference: value.reference })}` : message;
  if (/project_contractor_required/.test(reason)) return t('project.contractorConnection.paymentBlocked');
  if (/amount_mismatch/.test(reason)) return t('project.receiptFlow.amountMismatch', { amount: `${value?.amount ?? ''} ${value?.currency ?? ''}` });
  if (/currency_mismatch/.test(reason)) return t('project.receiptFlow.currencyMismatch', { currency: value?.currency ?? '' });
  if (/receipt_file_size/.test(reason)) return t('project.receiptFlow.fileSize');
  if (/receipt_file_type/.test(reason)) return t('project.receiptFlow.fileType');
  if (/receipt_page_limit/.test(reason)) return t('project.receiptFlow.pageLimit');
  if (/receipt_not_receipt/.test(reason)) return t('project.receiptFlow.notReceipt');
  if (/receipt_payment_not_completed/.test(reason)) return t('project.receiptFlow.notCompleted');
  if (/unreadable/.test(reason)) return t('project.receiptFlow.unreadable');
  if (/receipt_reader_not_configured/.test(reason)) return support(t('project.receiptFlow.readerNeedsAttention'));
  if (/receipt_reader_timeout/.test(reason)) return support(t('project.receiptFlow.readerTimeout'));
  if (/receipt_reader_busy/.test(reason)) return support(t('project.receiptFlow.readerBusy'));
  if (/receipt_reader_response_invalid|receipt_verification_unavailable/.test(reason)) return support(t('project.receiptFlow.processingFailed'));
  if (/receipt_network_error/.test(reason)) return t('project.receiptFlow.connectionLost');
  if (/sign_in_required/.test(reason)) return t('project.receiptFlow.signInRequired');
  if (/receipt_access_denied/.test(reason)) return t('project.receiptFlow.receiptAccess');
  if (/rate_limit/.test(reason)) return t('project.receiptFlow.rateLimit');
  if (/reader_unavailable/.test(reason)) return support(t('project.receiptFlow.readerUnavailable'));
  if (/receipt_rate_unavailable|receipt_conversion_required|receipt_rate_mismatch/.test(reason)) return support(t('project.receiptFlow.exchangeUnavailable'));
  if (/receipt_currency_unsupported/.test(reason)) return t('project.receiptFlow.currencyUnsupported');
  if (/payment_plan_review_required|payment_plan_declined/.test(reason)) return t('project.paymentPlan.reviewFirst');
  if (/invalid_installment/.test(reason)) return t('project.paymentPlan.chooseInstallment');
  if (/part_not_payable/.test(reason)) return t('project.parts.notPayable');
  if (/substage_receipt_required|stage_not_split|stage_paid_by_part/.test(reason)) return t('project.parts.refresh');
  if (/top_up_exceeds_balance/.test(reason)) return t('project.paymentPlan.topUpLimit');
  if (/receipt_duplicate_on_stage/.test(reason)) return t('project.receiptFlow.duplicateOnStage');
  if (/receipt_already_used/.test(reason)) return t('project.receiptFlow.alreadyUsed');
  if (/stale_receipt|receipt_file_changed|receipt_reading_expired|receipt_decided|receipt_accepted|receipt_pending_review/.test(reason)) return t('project.receiptFlow.refreshReceipt');
  return t('project.receiptFlow.tryAgain');
}
