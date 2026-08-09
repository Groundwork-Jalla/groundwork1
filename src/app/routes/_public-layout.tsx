import { Outlet } from 'react-router';
import { SiteNav } from '@/components/shell/SiteNav';
import { SiteFooter } from '@/components/shell/SiteFooter';

/**
 * Every signed-out page: landing, pricing, community, contractor application,
 * certificate verification, privacy, terms.
 *
 * These pages each used to supply their own chrome, or none — `contractor-apply`
 * and `community` had neither a navbar nor a footer, so a visitor arriving from
 * an ad had no way back into the site. The nav and footer now come from the
 * route rather than from each page, which is what makes that impossible to
 * forget on the next public page added.
 */
export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-white font-sans dark:bg-brand-rich-black">
      <SiteNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
