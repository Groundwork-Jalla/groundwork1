import { Outlet, Link } from 'react-router';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function ToolsLayout() {
  return (
    <div className="min-h-screen bg-white dark:bg-brand-rich-black font-sans">
      {/* Slim branded header */}
      <header className="sticky top-0 z-30 border-b border-brand-border-grey dark:border-[#2c2c2c] bg-white/80 dark:bg-brand-rich-black/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="Groundwork home">
              <GroundworkLogo size="sm" />
            </Link>
            <span className="text-brand-border-grey dark:text-[#444] select-none">/</span>
            <Link to="/tools" className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
              Free Tools
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/auth/login"
              className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors hidden sm:block"
            >
              Sign in
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-brand-off-white dark:border-[#1f1f1f] mt-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-brand-mid-grey">
            Groundwork by Jalla · Free planning tools for African construction
          </p>
          <div className="flex items-center gap-4 text-xs text-brand-mid-grey">
            <Link to="/tools" className="hover:text-brand-near-black dark:hover:text-white transition-colors">Tools</Link>
            <Link to="/pricing" className="hover:text-brand-near-black dark:hover:text-white transition-colors">Pricing</Link>
            <Link to="/auth/signup" className="hover:text-brand-near-black dark:hover:text-white transition-colors">Create account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
