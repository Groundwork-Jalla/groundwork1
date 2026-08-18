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
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
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
      <body>
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
  return <p className="p-8 text-sm text-brand-mid-grey">{t('errors.generic')}</p>;
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
