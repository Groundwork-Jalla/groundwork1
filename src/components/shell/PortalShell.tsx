import { useEffect, useState, type ReactNode } from 'react';
import { Form, Link, useLocation, useSearchParams } from 'react-router';
import { Menu, X, LogOut, Search, CircleHelp, type LucideIcon } from 'lucide-react';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface PortalLink { to: string; label: TKey; icon: LucideIcon; matchPrefix?: boolean }

export function PortalShell({ children, displayName, onLogout, home, links, roleKey, searchKey, scopeKey, helpTo }: {
  children: ReactNode;
  displayName: string;
  onLogout: () => void;
  home: string;
  links: PortalLink[];
  roleKey: TKey;
  searchKey: TKey;
  scopeKey: TKey;
  helpTo?: string;
}) {
  const t = useT();
  const location = useLocation();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <div className="min-h-screen bg-brand-off-white text-brand-near-black dark:bg-[#141414] dark:text-white">
      <a href="#portal-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3 focus:text-black">{t('nav.skipToContent')}</a>
      <header className="sticky top-0 z-30 flex h-20 items-center border-b border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="flex items-center gap-3 px-5 md:w-60 md:shrink-0 md:border-r md:border-brand-border-grey dark:md:border-[#2c2c2c]">
          <button type="button" aria-label={t(open ? 'common.close' : 'nav.mainNavigation')} aria-expanded={open} aria-controls="portal-navigation" onClick={() => setOpen(!open)} className="p-2 md:hidden">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <span className="dark:hidden"><GroundworkLogo linkTo={home} size="lg" /></span>
          <span className="hidden dark:block"><GroundworkLogo linkTo={home} size="lg" variant="light" /></span>
        </div>
        <Form action={home} method="get" className="relative mx-6 hidden max-w-lg flex-1 lg:block">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-brand-mid-grey" />
          <input key={params.get('q')} type="search" name="q" defaultValue={params.get('q') ?? ''} aria-label={t(searchKey)} placeholder={t(searchKey)} className="w-full rounded-xl border border-brand-border-grey bg-brand-off-white py-2.5 pl-10 pr-4 text-xs outline-none focus:ring-2 focus:ring-brand-mid-grey dark:border-[#444] dark:bg-[#141414]" />
        </Form>
        <div className="ml-auto flex min-w-0 items-center gap-3 px-4 sm:px-6">
          <LanguageToggle compact /><ThemeToggle compact />
          <div className="hidden border-l border-brand-border-grey pl-4 sm:block dark:border-[#2c2c2c]">
            <p className="max-w-48 truncate text-sm font-semibold">{displayName}</p>
            <p className="text-xs text-brand-mid-grey">{t(roleKey)}</p>
          </div>
          <button type="button" onClick={onLogout} aria-label={t('common.logOut')} className="rounded-lg p-2 hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]"><LogOut className="size-4" /></button>
        </div>
      </header>
      {open && <button aria-label={t('common.close')} onClick={() => setOpen(false)} className="fixed inset-0 top-20 z-30 bg-black/30 md:hidden" />}
      <aside id="portal-navigation" className={cn('fixed bottom-0 left-0 top-20 z-40 w-60 flex-col overflow-y-auto border-r border-brand-border-grey bg-[#ffffff] p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] md:flex', open ? 'flex' : 'hidden')}>
        <nav aria-label={t('nav.mainNavigation')} className="space-y-2">
          {links.map(({ to, label, icon: Icon, matchPrefix }) => {
            const active = to === home ? location.pathname === home && !location.hash : matchPrefix ? location.pathname.startsWith(to) : `${location.pathname}${location.hash}` === to;
            return <Link key={to} to={to} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium', active ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black' : 'text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]')}><Icon className="size-5" />{t(label)}</Link>;
          })}
        </nav>
        <div className="mt-auto pt-12">
          {helpTo && <Link to={helpTo!} onClick={() => setOpen(false)} className="flex items-center gap-3 border-t border-brand-border-grey pt-5 text-sm font-medium dark:border-[#2c2c2c]"><CircleHelp className="size-5" />{t('nav.help')}</Link>}
          <p className="mt-3 text-xs leading-relaxed text-brand-mid-grey">{t(scopeKey)}</p>
        </div>
      </aside>
      <main id="portal-content" className="min-w-0 px-4 py-6 sm:px-6 md:ml-60 lg:px-8"><div className="mx-auto max-w-[1500px]">{children}</div></main>
    </div>
  );
}
