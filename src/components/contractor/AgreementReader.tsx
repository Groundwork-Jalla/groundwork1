import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage, useT } from '@/lib/i18n';
import { PARTNER_AGREEMENT } from '@/lib/legal/partner-agreement';
import { ACCEPTANCE_STATEMENT, CONTRACTOR_TOS } from '@/lib/legal/contractor-tos';
import { TERMS } from '@/lib/legal/content';
import type { AgreementDocument } from '@/lib/supabase/contractor-onboarding';
import { cn } from '@/lib/utils';

// =========================================================
// Reading an agreement, and signing it, without leaving the page.
//
// The documents used to open in a new tab. That is the wrong shape for something you
// have to sign: the signature box was on one page and the text on another, so the honest
// answer to "have you read this?" was "I clicked a link that went somewhere else".
//
// Here the whole document is in front of the signature. The accept control stays
// disabled until the reader has actually reached the end of the text — not a legal
// requirement, but the difference between a signature and a reflex.
// =========================================================

type Block = ['h2' | 'clause' | 'p', string];

/**
 * Both documents, flattened to the same shape.
 *
 * `terms_of_service` is the CONTRACTOR Platform Terms of Service (160), not the public
 * /terms page — that one is the client's contract and a contractor is not that person.
 * `TERMS` is still imported for the public page and deliberately not read here.
 *
 * Neither document is translated. Both state that the English version controls, so a
 * French rendering beside an English signature would be a second text nobody signed.
 */
function blocksFor(doc: AgreementDocument, _lang: 'en' | 'fr'): Block[] {
  return doc === 'partner_agreement' ? PARTNER_AGREEMENT : [...CONTRACTOR_TOS];
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
  const [readToEnd, setReadToEnd] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const blocks = blocksFor(doc, lang);

  /**
   * Have they reached the end?
   *
   * Also true when the text is short enough not to scroll — otherwise a document that
   * fits on screen could never be accepted, which is the kind of dead end that looks
   * like a broken page rather than a rule.
   */
  const checkEnd = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const fits = el.scrollHeight <= el.clientHeight + 4;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (fits || atEnd) setReadToEnd(true);
  }, []);

  // Run once on mount for the short-document case, and whenever the language flips the
  // text out from under them.
  useEffect(() => { setReadToEnd(false); queueMicrotask(checkEnd); }, [doc, lang, checkEnd]);

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
        <div
          ref={scroller} onScroll={checkEnd}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
        >
          <div className="mx-auto flex max-w-[68ch] flex-col gap-3.5">
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
          {!readToEnd && (
            <p className="flex items-center gap-1.5 text-xs text-brand-mid-grey">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-brand-mid-grey" />
              {t('contractorOnboarding.scrollToEnd')}
            </p>
          )}

          <label className={cn(
            'flex cursor-pointer items-start gap-2 text-xs',
            readToEnd ? 'text-brand-near-black dark:text-white' : 'cursor-not-allowed text-brand-mid-grey opacity-60',
          )}>
            <input
              type="checkbox" className="mt-0.5" disabled={!readToEnd || busy}
              checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            />
            {doc === 'terms_of_service'
              ? ACCEPTANCE_STATEMENT
              : t('contractorOnboarding.confirmRead')}
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
