import { useEffect } from 'react';
import { notificationFocus } from '@/lib/notification-destination';

/** Wait for the selected stage/tab and its async content before focusing the action. */
export function useProjectNotificationFocus(projectId: string | undefined, search: string) {
  useEffect(() => {
    if (!projectId) return;
    const target = notificationFocus(Object.fromEntries(new URLSearchParams(search)));
    if (!target) return;
    let finished = false;
    const focus = () => {
      const node = document.getElementById(target.id);
      if (!node || finished) return;
      finished = true; node.setAttribute('tabindex', '-1');
      node.scrollIntoView({ block: 'center', behavior: 'auto' }); node.focus({ preventScroll: true });
      observer.disconnect(); clearTimeout(timeout);
    };
    const observer = new MutationObserver(focus);
    const timeout = setTimeout(() => observer.disconnect(), 20_000);
    observer.observe(document.body, { childList: true, subtree: true }); focus();
    return () => { finished = true; observer.disconnect(); clearTimeout(timeout); };
  }, [projectId, search]);
}
