import { Outlet, Link } from 'react-router';
import { SiteNav } from '@/components/shell/SiteNav';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { useT } from '@/lib/i18n';

/**
 * Free public planning tools. Wears the same navbar and footer as the rest of
 * the public site; the breadcrumb below them is the only tools-specific chrome,
 * since these pages sit two levels down and the nav alone doesn't say where.
 */
export default function ToolsLayout() {
  const t = useT();

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans dark:bg-brand-rich-black">
      <SiteNav />

      <div className="border-b border-brand-border-grey dark:border-[#2c2c2c]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/" className="text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
            {t('nav.groundwork')}
          </Link>
          <span className="select-none text-brand-border-grey dark:text-[#444]">/</span>
          <Link to="/tools" className="text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
            {t('nav.freeTools')}
          </Link>
        </div>
      </div>

      <main className="flex-1">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}
