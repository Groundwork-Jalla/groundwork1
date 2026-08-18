import { Navigate } from 'react-router';

/**
 * The community page is hidden for now — sign-up took its place as the public
 * entry point, so every "join" CTA on the site points at /auth/signup instead.
 *
 * The route stays registered rather than being removed: the waitlist welcome
 * email, existing Skool posts and printed material all carry /community links,
 * and a 404 is a worse landing than the sign-up form. `routes/community.tsx`
 * is untouched, so bringing the page back is a one-line change in routes.ts.
 *
 * `Navigate` rather than a redirecting clientLoader: this is SPA mode, so the
 * loader would not run until after hydration anyway, and the component form
 * behaves identically on a cold load and on an in-app link.
 */
export default function CommunityHidden() {
  return <Navigate to="/auth/signup" replace />;
}
