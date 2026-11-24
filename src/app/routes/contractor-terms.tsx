import { Link } from 'react-router';
import { useForceLight } from '@/hooks/useForceLight';
import { useLanguage } from '@/lib/i18n';
import { CONTRACTOR_TOS, TOS_TITLE, TOS_VERSION } from '@/lib/legal/contractor-tos';
import { CONTRACTOR_TOS_FR, TOS_FR_NOTICE, TOS_TITLE_FR } from '@/lib/legal/contractor-tos.fr';

/**
 * Public, sign-in-free view of the Groundwork Contractor Platform Terms of Service —
 * the exact instrument standard contractors review and sign during onboarding.
 *
 * Mirrors /partner-agreement so prospective contractors (e.g. corporate legal teams)
 * can review the full agreement before deciding whether to create an account.
 */
export default function ContractorTermsPage() {
  useForceLight();
  const { lang } = useLanguage();
  const isFr = lang === 'fr';
  const lines = isFr ? CONTRACTOR_TOS_FR : CONTRACTOR_TOS;

  return (
    <div className="bg-white font-sans">
      <article className="mx-auto max-w-[68ch] px-5 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
          Groundwork by Jalla
        </p>
        <h1 className="mt-2 font-sans text-3xl font-black leading-tight text-brand-near-black sm:text-4xl">
          {isFr ? TOS_TITLE_FR : TOS_TITLE}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-mid-grey">
          <span className="tabular-nums">Version · {TOS_VERSION}</span>
          <span>·</span>
          <Link to="/privacy" className="font-semibold text-brand-green underline underline-offset-4 hover:text-brand-green-hover">
            {isFr ? 'Politique de confidentialité' : 'Privacy Policy'}
          </Link>
        </div>

        {isFr && (
          <p className="mt-6 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-xs leading-relaxed text-brand-mid-grey">
            {TOS_FR_NOTICE}
          </p>
        )}

        <div className="my-10 h-px bg-brand-border-grey" />

        <div className="flex flex-col gap-4">
          {lines.map(([kind, text], i) => {
            if (kind === 'h2') {
              return (
                <h2 key={i} className="mt-6 font-sans text-base font-bold text-brand-near-black">
                  {text}
                </h2>
              );
            }
            if (kind === 'clause') {
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
