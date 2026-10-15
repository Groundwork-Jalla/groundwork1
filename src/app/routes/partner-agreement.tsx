import { useForceLight } from '@/hooks/useForceLight';
import { PARTNER_AGREEMENT } from '@/lib/legal/partner-agreement';

/**
 * The Professional Partner Referral and Network Services Agreement.
 *
 * Linked from /work/onboarding, where a contractor signs it. A signature on a document
 * somebody could not read is not a signature, so this page exists before that step does.
 *
 * ── Why this one is not translated ───────────────────────────────────────────────────
 * §24.10: "The controlling language is English. Any translation is for convenience."
 * A French rendering shown beside a signature box would imply the French text is what is
 * being agreed to, which the document itself says it is not. The onboarding step around
 * it is translated; the instrument is not.
 *
 * The text is generated from the .docx Ruth supplied — see src/lib/legal/partner-agreement.ts.
 */
export default function PartnerAgreementPage() {
  useForceLight();

  return (
    <div className="bg-white font-sans">
      <article className="mx-auto max-w-[68ch] px-5 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
          Groundwork by Jalla
        </p>
        <h1 className="mt-2 font-sans text-3xl font-black leading-tight text-brand-near-black sm:text-4xl">
          Professional Partner Referral and Network Services Agreement
        </h1>
        <p className="mt-3 text-xs tabular-nums text-brand-mid-grey">Version · 2026-10-15</p>

        <div className="my-10 h-px bg-brand-border-grey" />

        <div className="flex flex-col gap-4">
          {PARTNER_AGREEMENT.map(([kind, text], i) => {
            if (kind === 'h2') {
              return (
                <h2 key={i} className="mt-6 font-sans text-base font-bold text-brand-near-black">
                  {text}
                </h2>
              );
            }
            if (kind === 'clause') {
              // The numbered clauses are what gets cited in a dispute, so the number is
              // kept visually distinct and the text is not reflowed into a paragraph.
              const m = /^([0-9]+\.[0-9]+|D\.[0-9]+|[A-C]\.)\s+([\s\S]*)$/.exec(text);
              return (
                <p key={i} className="text-[15px] leading-relaxed text-brand-mid-grey">
                  <span className="font-semibold tabular-nums text-brand-near-black">
                    {m ? m[1] : ''}
                  </span>{' '}
                  {m ? m[2] : text}
                </p>
              );
            }
            return (
              <p key={i} className="text-[15px] leading-relaxed text-brand-mid-grey">{text}</p>
            );
          })}
        </div>
      </article>
    </div>
  );
}
