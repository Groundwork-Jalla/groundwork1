import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { useForceLight } from '@/hooks/useForceLight';
import { useLanguage } from '@/lib/i18n';
import type { LegalDoc } from '@/lib/legal/content';
import type { Lang } from '@/lib/i18n/types';

/**
 * Shared shell for the privacy policy and terms of service.
 *
 * Both documents are the same page with different prose, so they share one
 * component. Public pages are light-only (useForceLight), matching the landing
 * and pricing pages — the dark-mode work is scoped to the signed-in app.
 */
export default function LegalPage({ doc }: { doc: Record<Lang, LegalDoc> }) {
  useForceLight();
  const { lang, t } = useLanguage();
  const d = doc[lang] ?? doc.en;

  return (
    // Navbar and footer come from routes/_public-layout.tsx.
    <div className="bg-white font-sans">
      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        /* ~68ch keeps running text at a readable measure — legal prose is the
           one place on the site people actually read top to bottom. */
        className="max-w-[68ch] mx-auto px-5 sm:px-6 py-14 sm:py-20"
      >
        <h1 className="font-sans text-3xl sm:text-4xl font-black text-brand-near-black leading-tight">
          {d.title}
        </h1>
        <p className="text-xs text-brand-mid-grey mt-3 tabular-nums">
          {lang === 'fr' ? 'Dernière mise à jour' : 'Last updated'} · {d.updated}
        </p>

        <p className="text-[15px] text-brand-mid-grey leading-relaxed mt-6">
          {d.intro}
        </p>

        <div className="h-px bg-brand-border-grey my-10" />

        <div className="flex flex-col gap-9">
          {d.sections.map((s, i) => (
            <section key={s.heading}>
              <h2 className="font-sans text-base font-bold text-brand-near-black mb-3">
                <span className="text-brand-mid-grey tabular-nums mr-2">{i + 1}.</span>
                {s.heading}
              </h2>
              <div className="flex flex-col gap-3">
                {s.body.map((p, j) =>
                  p.startsWith('- ') ? (
                    <div key={j} className="flex items-start gap-2.5 pl-1">
                      <span className="mt-2 size-1 rounded-full bg-brand-mid-grey shrink-0" />
                      <p className="text-[15px] text-brand-mid-grey leading-relaxed">{p.slice(2)}</p>
                    </div>
                  ) : (
                    <p key={j} className="text-[15px] text-brand-mid-grey leading-relaxed">{p}</p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="h-px bg-brand-border-grey my-10" />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link to="/" className="text-sm text-brand-near-black underline underline-offset-4">
            ← {t('common.backToHome')}
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/privacy" className="text-brand-mid-grey hover:text-brand-near-black transition-colors">
              {lang === 'fr' ? 'Confidentialité' : 'Privacy'}
            </Link>
            <Link to="/terms" className="text-brand-mid-grey hover:text-brand-near-black transition-colors">
              {lang === 'fr' ? 'Conditions' : 'Terms'}
            </Link>
          </div>
        </div>
      </motion.article>
    </div>
  );
}
