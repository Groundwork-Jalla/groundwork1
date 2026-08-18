import { useEffect } from 'react';
import { usePushForceLight } from '@/contexts/ThemeContext';

/**
 * Pin a page to light mode for as long as it is mounted.
 *
 * The public marketing pages — landing, pricing, community, contractor-apply and
 * the legal pages — carry no `dark:` styling at all. Rendering them under a dark
 * `<html>` does not make them dark, it makes them a white page inside a dark
 * shell. So they opt out rather than being half-converted.
 *
 * This does NOT change the user's preference: it is suspended, not overwritten,
 * and the moment the page unmounts the chosen theme comes back. Previously this
 * hook wrote to the DOM class directly and reasoned about localStorage to undo
 * itself, which meant two writers fighting over one class.
 */
export function useForceLight() {
  const pushForceLight = usePushForceLight();
  useEffect(() => pushForceLight(), [pushForceLight]);
}
