import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { Analytics } from "@vercel/analytics/react";
import * as Sentry from "@sentry/react";

import type { Route } from "./+types/root";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "@/lib/sentry";
import { GA_ID } from "@/lib/analytics";
import "../styles/globals.css";
import { useT } from '@/lib/i18n';

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
  // iOS ignores SVG for apple-touch-icon and falls back to a screenshot of the
  // page, so this slot needs a real raster. 512 is the size iOS prefers to
  // downscale from for home-screen icons.
  { rel: "apple-touch-icon", sizes: "512x512", href: "/logo-512.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    // IBM Plex Mono carries every figure (Foundations: figures are mono and tabular).
    // Spectral is loaded for issued artefacts only — certificates, receipts, PDFs.
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Spectral:wght@400;500;600&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // Both pre-paint scripts below deliberately mutate this element before React
    // hydrates — the theme script adds `class="dark"`, the language script rewrites
    // `lang`. React compares the prerendered markup against the mutated DOM and
    // warns on every route. The mutation is the point (it prevents a flash of the
    // wrong theme and gives screen readers the right language immediately), so the
    // warning is suppressed here rather than the behaviour being changed.
    /**
     * `translate="no"` is load-bearing, not a preference.
     *
     * Chrome's page translation rewrites text nodes in place. React then tries to insert
     * or remove a sibling of a node the translator has already replaced, and throws
     * `NotFoundError: Failed to execute 'insertBefore' on 'Node'` — which takes down the
     * whole tree into the error boundary. Reported as "Something went wrong. Please
     * refresh the page." on /work/projects with every frame of the stack inside React
     * itself and none in our code, which is the signature of this.
     *
     * Groundwork translates itself: the EN/FR switch is the supported way, and the
     * `lang` set below drives it. Browser translation on top of that is redundant and
     * costs the page.
     */
    <html lang="en" translate="no" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        {/* The older signal, which some Chrome versions honour where the attribute
            alone is ignored. Both, because one of them silently not applying is how
            this reached production in the first place. */}
        <meta name="google" content="notranslate" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Groundwork by Jalla</title>
        <Meta />
        {/* Apply saved theme class before first paint — prevents flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();` }} />
        {/* Resolve language before first paint so <html lang> is correct for
            screen readers and browser translate prompts. Mirrors detectLang(). */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem('lang');if(l!=='en'&&l!=='fr'){var c=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];l='en';for(var i=0;i<c.length;i++){if(typeof c[i]==='string'&&c[i].toLowerCase().indexOf('fr')===0){l='fr';break;}}}document.documentElement.lang=l;}catch(e){}})();` }} />
        <Links />
        {GA_ID && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
            <script dangerouslySetInnerHTML={{ __html: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
` }} />
          </>
        )}
      </head>
      {/* Belt and braces: the subtree React actually reconciles. */}
      <body translate="no">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-9999 focus:rounded-md focus:bg-brand-near-black focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:shadow-lg"
        >
          Skip to main content
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

/**
 * Rendered as the error-boundary fallback, which sits inside LanguageProvider —
 * so it can translate. AppInner itself cannot: it *renders* the provider, so a
 * hook called there runs outside its own context and throws.
 */
function ErrorFallback() {
  const t = useT();
  /**
   * A way out, not just a sentence.
   *
   * This was a bare line of grey text, which is what a contractor saw after pressing
   * Submit work — with no indication that the submission had in fact succeeded and
   * nothing to press. Reported twice as "it takes me to an empty page".
   *
   * The reload is not cosmetic: the commonest cause here is a DOM mutated from outside
   * React (a browser translating the page), and React cannot recover from that in place
   * — only a fresh document can. So the honest instruction is also the working one.
   */
  return (
    <div className="p-8 space-y-3" role="alert">
      <p className="text-sm text-brand-near-black dark:text-white">{t('errors.generic')}</p>
      <p className="text-xs text-brand-mid-grey">{t('errors.workMayBeSaved')}</p>
      <button
        type="button"
        onClick={() => { window.location.reload(); }}
        className="rounded-lg bg-brand-near-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
      >
        {t('errors.reload')}
      </button>
    </div>
  );
}

function AppInner() {
  return (
    <LanguageProvider>
      <AuthProvider>
        {/* Inside AuthProvider: the theme is stored on the user's profile, so the
            provider needs the session to read it back on a new device. */}
        <ThemeProvider>
          <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
            <div id="main-content">
              <Outlet />
            </div>
          </Sentry.ErrorBoundary>
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default Sentry.withProfiler(AppInner, { name: "App" });

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
