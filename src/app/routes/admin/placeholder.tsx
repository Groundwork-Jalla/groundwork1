import { Link, useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';
import { EmptyState } from '@/components/ui/EmptyState';
import { useT } from '@/lib/i18n';

// =========================================================
// TEMPORARY. The honest empty state behind a sidebar item whose page is not built yet
// (IA 01 §2, amended 13 Sep 2026): the item exists in the navigation because the product
// has that concept; the page shows nothing invented, says so, and points at where the
// information lives today when it lives anywhere. Each entry leaves ADMIN_PLACEHOLDERS
// — and this route stops answering for it — the day its real page ships.
// =========================================================
export default function AdminPlaceholder() {
  const t = useT();
  const { section = '' } = useParams();
  const entry = ADMIN_PLACEHOLDERS[section];
  if (!entry) {
    return (
      <div className="p-8">
        <EmptyState title={t('admin.placeholder.notFound')} description="" />
      </div>
    );
  }
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t(entry.labelKey)}</h1>
      <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.placeholder.body')}</p>
      {entry.existingTo && entry.existingKey && (
        <Link
          to={entry.existingTo}
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-2.5 text-sm font-medium text-brand-near-black dark:text-white hover:border-brand-near-black dark:hover:border-white transition-colors"
        >
          {t('admin.placeholder.existing', { where: t(entry.existingKey) })}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
