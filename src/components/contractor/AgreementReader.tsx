import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage, useT } from '@/lib/i18n';
import { PARTNER_AGREEMENT } from '@/lib/legal/partner-agreement';
import { ACCEPTANCE_STATEMENT, CONTRACTOR_TOS } from '@/lib/legal/contractor-tos';
import { CONTRACTOR_TOS_FR, TOS_FR_NOTICE, ACCEPTANCE_STATEMENT_FR } from '@/lib/legal/contractor-tos.fr';
import { TERMS } from '@/lib/legal/content';
import type { AgreementDocument } from '@/lib/supabase/contractor-onboarding';

// =========================================================
// Reading an agreement, and signing it, without leaving the page.
//
// The documents used to open in a new tab. That is the wrong shape for something you
// have to sign: the signature box was on one page and the text on another, so the honest
// answer to "have you read this?" was "I clicked a link that went somewhere else".
//
// Here the whole document is in front of the signature.
//
// The accept control used to stay disabled until the reader reached the end of the text.
// Philip, 9 Nov 2026: that gate was costing sign-ups and it is not what makes the
// signature binding. What does is already recorded server-side — `accept_agreement`
// (116) writes the signer, the DOCUMENT VERSION the database chose (never one the
// browser claimed), the typed name and a timestamped activity row. The document is
// still rendered in full above the signature, so acceptance is still given in front of
// the text rather than through a link to it.
// =========================================================

type Block = ['h2' | 'clause' | 'p', string];

/**
 * Both documents, flattened to the same shape.
 *
 * `terms_of_service` is the CONTRACTOR Platform Terms of Service (160), not the public
 * /terms page — that one is the client's contract and a contractor is not that person.
 * `TERMS` is still imported for the public page and deliberately not read here.
 *
 * Only the contractor Terms have a French rendering, and it is a courtesy translation:
 * §27 says the English version controls, and the signature below is still given against
 * the English statement. The reader says so above the French text. The partner agreement
 * stays English.
 */
function blocksFor(doc: AgreementDocument, lang: 'en' | 'fr'): Block[] {
  if (doc === 'partner_agreement') return PARTNER_AGREEMENT;
  return lang === 'fr' ? [...CONTRACTOR_TOS_FR] : [...CONTRACTOR_TOS];
}

export function AgreementReader({ doc, onAccept, onClose, busy, error }: {
  doc: AgreementDocument;
  onAccept: (signedName: string) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState('');

  const blocks = blocksFor(doc, lang);
  const translated = doc === 'terms_of_service' && lang === 'fr';

  // Swapping the document or the language replaces the text under the signature, so the
  // tick and the typed name are cleared: what was agreed to is no longer what is on
  // screen, and a carried-over signature would be given against text nobody read.
  useEffect(() => { setConfirmed(false); setName(''); }, [doc, lang]);

  // Escape closes, and the page behind does not scroll while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      role="dialog" aria-modal="true" aria-label={t(`contractorOnboarding.doc.${doc}` as never)}
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl dark:bg-[#1e1e1e] sm:h-[90vh] sm:rounded-2xl">

        {/* ── Header ── */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c] sm:px-7">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
              {t('contractorOnboarding.readerEyebrow')}
            </p>
            <h2 className="mt-0.5 text-base font-bold leading-snug text-brand-near-black dark:text-white sm:text-lg">
              {t(`contractorOnboarding.doc.${doc}` as never)}
            </h2>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy}
            aria-label={t('contractorOnboarding.readerClose')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white disabled:opacity-40 dark:hover:bg-[#2c2c2c]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {/* ── The document ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="mx-auto flex max-w-[68ch] flex-col gap-3.5">
            {translated && (
              <p className="rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-2 text-xs text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#141414]">
                {TOS_FR_NOTICE}
              </p>
            )}
            {blocks.map(([kind, text], i) => {
              if (kind === 'h2') {
                return (
                  <h3 key={i} className="mt-5 text-sm font-bold text-brand-near-black dark:text-white">
                    {text}
                  </h3>
                );
              }
              if (kind === 'clause') {
                // The numbered clauses are what gets cited in a dispute, so the number
                // stays visually distinct rather than reflowed into the sentence.
                const m = /^([0-9]+\.[0-9]+|D\.[0-9]+|[A-C]\.)\s+([\s\S]*)$/.exec(text);
                return (
                  <p key={i} className="text-[14px] leading-relaxed text-brand-mid-grey">
                    <span className="font-semibold tabular-nums text-brand-near-black dark:text-white">
                      {m ? m[1] : ''}
                    </span>{' '}
                    {m ? m[2] : text}
                  </p>
                );
              }
              return (
                <p key={i} className="text-[14px] leading-relaxed text-brand-mid-grey">{text}</p>
              );
            })}
            <div className="h-2" />
          </div>
        </div>

        {/* ── Sign ── */}
        <form
          onSubmit={e => { e.preventDefault(); onAccept(name); }}
          className="shrink-0 space-y-3 border-t border-brand-border-grey bg-brand-off-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#141414] sm:px-7"
        >
          <label className="flex cursor-pointer items-start gap-2 text-xs text-brand-near-black dark:text-white">
            <input
              type="checkbox" className="mt-0.5" disabled={busy}
              checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            />
            {doc === 'terms_of_service' ? (
              <span>
                {ACCEPTANCE_STATEMENT}
                {translated && (
                  <span className="mt-1 block text-brand-mid-grey">{ACCEPTANCE_STATEMENT_FR}</span>
                )}
              </span>
            ) : t('contractorOnboarding.confirmRead')}
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label htmlFor={`sign-${doc}`}>{t('contractorOnboarding.typeName')}</Label>
              {/* Never prefilled from the profile: §24.9 permits an electronic signature,
                  and what makes it one is that they typed their own name. */}
              <Input
                id={`sign-${doc}`} autoComplete="off" disabled={!confirmed || busy}
                value={name} onChange={e => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!confirmed || busy || name.trim().length < 2}>
              {busy
                ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />{t('contractorOnboarding.saving')}</>
                : <><Check className="mr-1.5 size-3.5" />{t('contractorOnboarding.iAccept')}</>}
            </Button>
          </div>

          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
        </form>
      </div>
    </div>
  );
}
