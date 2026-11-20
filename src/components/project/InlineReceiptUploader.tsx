import { useRef, useState, type FormEvent } from 'react';
import { Camera, FileUp, Loader2, X } from 'lucide-react';
import { useLanguage, useT } from '@/lib/i18n';
import { currencyFractionDigits } from '@/lib/format';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount, MAX_RECEIPT_BYTES, RECEIPT_ACCEPT } from '@/lib/payments/receipt-reading';
import { receiptCurrencyChoices } from '@/lib/payments/receipt-currencies';
import { receiptErrorText } from '@/lib/payments/receipt-error-text';
import { uploadStagePaymentReceipt } from '@/lib/supabase/verifications';
import { compressImageForUpload } from '@/lib/mobile/compress-image';

interface InlineReceiptUploaderProps {
  projectId: string;
  stageId: string;
  substageId: string;
  substageName: string;
  /** True only when the stage is formally split by part (`stage.paid_by_part`). */
  splitByPart?: boolean;
  /** Optional pre-filled amount (e.g. from contractor's substage payment request or part remaining). */
  initialAmount?: string;
  initialCurrency?: string;
  /** Remaining due in project currency for live excess-payment warning. */
  remainingDue?: number | null;
  onUploaded: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Inline per-substage receipt uploader for Homeowners — mirrors the contractor's
 * inline Request payment dropdown so clients never have to scroll past all substages
 * to upload a payment receipt.
 */
export function InlineReceiptUploader({
  projectId,
  stageId,
  substageId,
  substageName,
  splitByPart = false,
  initialAmount = '',
  initialCurrency,
  remainingDue = null,
  onUploaded,
  onCancel,
}: InlineReceiptUploaderProps) {
  const t = useT();
  const { lang } = useLanguage();
  const money = useProjectMoneyContext();
  const projectCode = money?.code ?? 'USD';
  const projectFxRate = money?.budgetRate ?? money?.rate ?? 1;

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const [currency, setCurrency] = useState(initialCurrency || projectCode);
  const [amount, setAmount] = useState(initialAmount);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ amount: string; currency: string } | null>(null);

  const formatMoney = (value: number | null, iso: string) =>
    value == null
      ? t('project.receiptFlow.amountUnknown')
      : `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
          maximumFractionDigits: currencyFractionDigits(iso),
        }).format(value)} ${iso}`;

  const canonical = canonicalReceiptAmount(amount);
  const isOver = !!canonical && currency === projectCode && remainingDue != null && Number(canonical) > remainingDue;

  async function doUpload(pickedFile: File | null = file) {
    if (inFlight.current) return;
    if (!pickedFile) {
      fileRef.current?.click();
      return;
    }
    if (!pickedFile.size || pickedFile.size > MAX_RECEIPT_BYTES) {
      setError(t('project.receiptFlow.fileSize'));
      return;
    }
    if (!RECEIPT_ACCEPT.split(',').includes(pickedFile.type)) {
      setError(t('project.receiptFlow.fileType'));
      return;
    }
    if (!canonicalReceiptAmount(amount)) {
      setError(t('project.stages.receiptAmountInvalid'));
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      const prepared = await compressImageForUpload(pickedFile);
      await uploadStagePaymentReceipt(projectId, stageId, prepared, {
        amount,
        currency,
        fxRate: currency === projectCode ? projectFxRate : currency === 'USD' ? 1 : undefined,
        ...(splitByPart ? { substageId } : {}),
      });
      await onUploaded();
    } catch (err) {
      setError(receiptErrorText(t, err));
      const read = err as { code?: string; message?: string; amount?: string; currency?: string } | null;
      const mismatch = /amount_mismatch|currency_mismatch/.test(`${read?.code ?? ''} ${read?.message ?? ''}`);
      if (mismatch && canonicalReceiptAmount(read?.amount) && /^[A-Z]{3}$/.test(read?.currency ?? '')) {
        setSuggestion({ amount: read!.amount!, currency: read!.currency! });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void doUpload();
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-substage-receipt-form
      data-clarity-mask="true"
      className="mt-3 space-y-3 rounded-xl border border-brand-green/35 bg-brand-off-white p-3.5 text-xs dark:border-brand-green/40 dark:bg-[#141414]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-brand-near-black dark:text-white">
          {t('project.clientUi.uploadReceipt')} · {substageName}
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label={t('common.cancel')}
          className="rounded-md p-1 text-brand-mid-grey hover:bg-white hover:text-brand-near-black dark:hover:bg-[#1e1e1e] dark:hover:text-white"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <fieldset disabled={busy} className="space-y-2.5 disabled:opacity-50">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-brand-green bg-white px-3 py-2 text-xs font-semibold text-brand-green transition-colors hover:bg-brand-green/5 dark:bg-[#1e1e1e] dark:text-[#86efac]"
          >
            <FileUp className="size-3.5" aria-hidden />
            {t('project.receiptFlow.pickFile')}
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-green hover:text-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          >
            <Camera className="size-3.5" aria-hidden />
            {t('project.receiptFlow.takePhoto')}
          </button>
        </div>

        {file && (
          <p className="truncate rounded-md bg-white px-2.5 py-1.5 font-mono text-[11px] text-brand-near-black dark:bg-[#1e1e1e] dark:text-white">
            {file.name}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
          <label className="block font-medium text-brand-near-black dark:text-white">
            {t('project.receiptFlow.currencyLabel')}
            <select
              value={currency}
              onChange={e => { setCurrency(e.target.value); setError(null); }}
              className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
            >
              {receiptCurrencyChoices(projectCode).map(code => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className="block font-medium text-brand-near-black dark:text-white">
            {t('project.stages.receiptAmountLabel', { currency })}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={e => {
                const raw = e.target.value;
                setAmount(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw);
                setError(null);
              }}
              className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
            />
          </label>
        </div>

        {isOver && remainingDue != null && (
          <div role="alert" data-excess-warning className="rounded-lg border border-state-held/40 bg-state-held/10 p-2.5 text-xs leading-relaxed">
            <p className="font-semibold text-brand-near-black dark:text-white">
              {t('project.receiptFlow.excessPaymentWarningTitle')}
            </p>
            <p className="mt-0.5 text-brand-mid-grey">
              {t('project.receiptFlow.excessPaymentWarningBody', {
                amount: formatMoney(Number(canonical), projectCode),
                due: formatMoney(remainingDue, projectCode),
              })}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-state-alert">
            {error}
          </p>
        )}

        {error && suggestion && (
          <button
            type="button"
            onClick={() => {
              setAmount(suggestion.amount);
              setCurrency(suggestion.currency);
              setError(null);
              setSuggestion(null);
            }}
            className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-brand-green px-3 py-1.5 text-xs font-semibold text-brand-green dark:text-[#86efac]"
          >
            {t('project.receiptFlow.useReceiptFigures', {
              amount: `${Number(suggestion.amount).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                maximumFractionDigits: 6,
              })} ${suggestion.currency}`,
            })}
          </button>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t(busy ? 'project.receiptFlow.checking' : 'project.clientUi.uploadReceipt')}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={RECEIPT_ACCEPT}
          className="hidden"
          aria-label={t('project.receiptFlow.pickFile')}
          onChange={e => {
            const picked = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (picked) {
              setFile(picked);
              setError(null);
            }
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          aria-label={t('project.receiptFlow.takePhoto')}
          onChange={e => {
            const picked = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (picked) {
              setFile(picked);
              setError(null);
            }
          }}
        />
      </fieldset>
    </form>
  );
}
